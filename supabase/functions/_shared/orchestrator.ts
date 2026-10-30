// Orquestador del agente: ejecuta las capas para un usuario.
//
//   Percibir → 2. Modelo (ciclo) → 3. Objetivos (planificador)
//            → 1. Reactivo (vigilante) → Actuar
//   4. Utilidad (asesor)           ← versión completa
//   5. Aprendizaje (hormiga)       ← versión completa
//
// Primero el agente actualiza su modelo del mundo (pagos, cuotas renovadas),
// luego replanifica hacia su meta con ese estado y al final las reglas
// reactivas revisan los vencimientos.
//
// No depende de Supabase: recibe un `AgentStore` (base de datos) y un
// `EmailSender`. Así se puede probar con datos falsos (ver tests/).

import type {
  DebtRecord,
  ExpenseRecord,
  SalaryProfile,
  StrategyMethod,
  WorkDayRecord,
} from './finance/finance.ts';
import type { PlanRow } from './finance/debtPlanner.ts';
import type { AgentAction, StoredAction } from './agentTypes.ts';
import { runWatcher } from './agents/watcher.ts';
import { applyDebtUpdates, type DebtUpdate, runCycle } from './agents/cycle.ts';
import { type Goal, runPlanner, STORED_PLAN_MONTHS } from './agents/planner.ts';
import { buildAlertEmail, type EmailSender } from './notify.ts';

/** Lo que el agente percibe de un usuario. */
export interface UserState {
  salary: SalaryProfile;
  debts: DebtRecord[];
  workDays: WorkDayRecord[];
  expenses: Pick<ExpenseRecord, 'date' | 'amount'>[];
  strategyMode: StrategyMethod;
  goal: Goal | null;
  stateVersion: number;
  lastPaymentApplied: string | null;
}

export interface CycleCommit {
  expectedVersion: number;
  balanceDelta: number;
  debtUpdates: DebtUpdate[];
  lastPaymentApplied: string;
  runDate: string;
}

export interface AgentStore {
  listUserIds(onlyUserId?: string): Promise<string[]>;
  loadUserState(userId: string): Promise<UserState>;
  /** Aplica el ciclo de forma atómica. Devuelve la nueva versión, o null si hubo conflicto. */
  applyCycle(userId: string, commit: CycleCommit): Promise<number | null>;
  /** Reemplaza el plan sin deudas guardado (tabla debt_plans). */
  replacePlan(userId: string, rows: PlanRow[]): Promise<void>;
  /** Guarda las acciones y devuelve SOLO las nuevas (las repetidas se ignoran). */
  saveActions(userId: string, actions: AgentAction[]): Promise<StoredAction[]>;
  markEmailed(actionIds: string[]): Promise<void>;
  getUserEmail(userId: string): Promise<string | null>;
  logRun(entry: RunLog): Promise<void>;
}

export interface RunLog {
  userId: string;
  runDate: string;
  layers: string[];
  actionsCreated: number;
  emailsSent: number;
  status: 'ok' | 'error';
  error?: string;
}

export interface UserRunResult {
  userId: string;
  status: 'ok' | 'error';
  newActions: number;
  balanceDelta: number;
  emailSent: boolean;
  error?: string;
}

export async function runAgentForUser(
  userId: string,
  todayIso: string,
  store: AgentStore,
  sendEmail: EmailSender
): Promise<UserRunResult> {
  const layers: string[] = [];
  try {
    // Percepción.
    const state = await store.loadUserState(userId);
    let debts = state.debts;
    const decided: AgentAction[] = [];
    let balanceDelta = 0;

    // Capa 2: basado en modelo.
    const cycle = runCycle({
      salary: state.salary,
      debts,
      workDays: state.workDays,
      todayIso,
      lastPaymentApplied: state.lastPaymentApplied,
    });
    const applied = await store.applyCycle(userId, {
      expectedVersion: state.stateVersion,
      balanceDelta: cycle.balanceDelta,
      debtUpdates: cycle.debtUpdates,
      lastPaymentApplied: cycle.lastPaymentApplied,
      runDate: todayIso,
    });

    if (applied === null) {
      // La app guardó mientras el agente pensaba: no se pisa nada.
      // Como la memoria no avanzó, mañana lo vuelve a intentar.
      layers.push('ciclo:conflicto');
    } else {
      layers.push('ciclo');
      debts = applyDebtUpdates(debts, cycle.debtUpdates);
      balanceDelta = cycle.balanceDelta;
      decided.push(...cycle.actions);
    }

    // Capa 3: basada en objetivos, sobre el estado ya actualizado.
    layers.push('planificador');
    const planner = runPlanner({
      salary: { ...state.salary, currentBalance: state.salary.currentBalance + balanceDelta },
      debts,
      expenses: state.expenses,
      method: state.strategyMode,
      goal: state.goal,
      todayIso,
    });
    if (planner.plan) {
      const months = new Set(planner.plan.schedule.map((row) => row.month));
      const keep = new Set([...months].sort().slice(0, STORED_PLAN_MONTHS));
      await store.replacePlan(userId, planner.plan.schedule.filter((row) => keep.has(row.month)));
    }
    decided.push(...planner.actions);

    // Capa 1: reactivo simple, sobre el estado ya actualizado.
    layers.push('vigilante');
    decided.push(...runWatcher(debts, todayIso));

    // Actuar: registrar en la app.
    const created = await store.saveActions(userId, decided);

    // Actuar: avisar por correo solo lo nuevo que lo requiere.
    let emailSent = false;
    const toNotify = created.filter((action) => action.notify);
    if (toNotify.length > 0) {
      const email = await store.getUserEmail(userId);
      if (email) {
        const result = await sendEmail(buildAlertEmail(email, toNotify));
        if (result.sent) {
          emailSent = true;
          await store.markEmailed(toNotify.map((action) => action.id));
        }
      }
    }

    await store.logRun({
      userId,
      runDate: todayIso,
      layers,
      actionsCreated: created.length,
      emailsSent: emailSent ? 1 : 0,
      status: 'ok',
    });

    return { userId, status: 'ok', newActions: created.length, balanceDelta, emailSent };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Un error con un usuario no detiene a los demás.
    await store.logRun({
      userId,
      runDate: todayIso,
      layers,
      actionsCreated: 0,
      emailsSent: 0,
      status: 'error',
      error: message,
    }).catch(() => undefined);
    return { userId, status: 'error', newActions: 0, balanceDelta: 0, emailSent: false, error: message };
  }
}

export async function runAgent(
  todayIso: string,
  store: AgentStore,
  sendEmail: EmailSender,
  onlyUserId?: string
): Promise<UserRunResult[]> {
  const userIds = await store.listUserIds(onlyUserId);
  const results: UserRunResult[] = [];
  // Secuencial a propósito: pocos usuarios y respeta los límites de Resend.
  for (const userId of userIds) {
    results.push(await runAgentForUser(userId, todayIso, store, sendEmail));
  }
  return results;
}
