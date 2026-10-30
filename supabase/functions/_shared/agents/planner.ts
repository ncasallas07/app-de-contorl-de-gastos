// CAPA 3 · Agente basado en objetivos: "Planificador sin deudas".
//
// Objetivo: quedar sin deudas en N meses (lo fija el usuario en agent_goals).
// El agente simula hacia adelante (búsqueda sobre el abono extra mensual) y
// elige el plan que cumple la meta con el menor esfuerzo. Si la meta no cabe
// en la capacidad de pago, arma el mejor plan posible y propone alternativas.
// Cada día replanifica con los datos nuevos y solo avisa cuando el plan cambia.
//
// La simulación vive en finance/debtPlanner.ts (la misma que usa la app).

import type { DebtRecord, ExpenseRecord, SalaryProfile, StrategyMethod } from '../finance/finance.ts';
import { buildDebtPlan, type DebtPlan, monthName } from '../finance/debtPlanner.ts';
import { type AgentAction, formatCOP } from '../agentTypes.ts';

export const DEFAULT_TARGET_MONTHS = 12;

/** Filas del plan que se guardan (los primeros 10 años). */
export const STORED_PLAN_MONTHS = 120;

export interface Goal {
  targetMonths: number;
  active: boolean;
  /** Colchón de emergencia que quiere tener (0 = un mes de gastos). Lo usa la capa 4. */
  emergencyFundMin: number;
}

export interface PlannerInput {
  salary: SalaryProfile;
  debts: DebtRecord[];
  expenses: Pick<ExpenseRecord, 'date' | 'amount'>[];
  method: StrategyMethod;
  /** null = el usuario no ha fijado meta: se usa la de 12 meses. */
  goal: Goal | null;
  todayIso: string;
}

export interface PlannerResult {
  plan: DebtPlan | null;
  actions: AgentAction[];
}

/** Redondea para que cambios pequeños del día a día no generen avisos nuevos. */
const bucket = (value: number) => Math.round(value / 50_000) * 50_000;

export function runPlanner(input: PlannerInput): PlannerResult {
  if (input.goal && !input.goal.active) return { plan: null, actions: [] };

  const targetMonths = input.goal?.targetMonths ?? DEFAULT_TARGET_MONTHS;
  const plan = buildDebtPlan({
    salary: input.salary,
    debts: input.debts,
    expenses: input.expenses,
    method: input.method,
    targetMonths,
    todayIso: input.todayIso,
  });

  const goalNote = input.goal ? '' : ' (meta por defecto; cámbiala en Estrategia)';
  const methodName = plan.method === 'avalancha' ? 'avalancha' : 'bola de nieve';
  const actions: AgentAction[] = [];
  const data = {
    status: plan.status,
    targetMonths,
    requiredExtra: plan.requiredExtra,
    extraCapacity: plan.extraCapacity,
    months: plan.months,
    endMonth: plan.endMonth,
    interestSaved: plan.interestSaved,
    priorityDebtId: plan.priorityDebt?.id ?? null,
  };

  switch (plan.status) {
    case 'sin_deudas':
      if (input.goal) {
        actions.push({
          layer: 3,
          kind: 'meta_cumplida',
          severity: 'positiva',
          title: 'No tienes deudas activas',
          message: 'Tu meta está cumplida. Lo que antes iba a cuotas ahora puede ir a ahorro.',
          data,
          dedupeKey: 'planner:sin_deudas',
          notify: false,
        });
      }
      break;

    case 'alcanzable': {
      const extra = plan.requiredExtra > 0
        ? `abona ${formatCOP(plan.requiredExtra)} extra al mes a ${plan.priorityDebt?.title}`
        : 'con las cuotas mínimas ya alcanzas';
      actions.push({
        layer: 3,
        kind: 'plan_listo',
        severity: 'positiva',
        title: `Plan sin deudas: terminas en ${monthName(plan.endMonth!)}`,
        message: `Para cumplir tu meta de ${targetMonths} meses${goalNote}, ${extra} (método ${methodName}). `
          + (plan.interestSaved > 0
            ? `Ahorras ${formatCOP(plan.interestSaved)} en intereses frente a pagar solo las cuotas.`
            : `Pagarás ${formatCOP(plan.totalInterest)} en intereses.`),
        data,
        dedupeKey: `planner:ok:${targetMonths}:${plan.endMonth}:${plan.priorityDebt?.id}:${bucket(plan.requiredExtra)}`,
        notify: false,
      });
      break;
    }

    case 'inalcanzable': {
      const gap = plan.requiredExtra - plan.extraCapacity;
      actions.push({
        layer: 3,
        kind: 'meta_inalcanzable',
        severity: 'alta',
        title: `Tu meta de ${targetMonths} meses no alcanza`,
        message: `Necesitas abonar ${formatCOP(plan.requiredExtra)} extra al mes y hoy te quedan `
          + `${formatCOP(plan.extraCapacity)}. Con eso terminas en ${monthName(plan.endMonth!)} `
          + `(${plan.months} meses). Opciones: ampliar la meta a ${plan.months} meses o recortar `
          + `${formatCOP(gap)} al mes en gastos.`,
        data,
        dedupeKey: `planner:no:${targetMonths}:${plan.endMonth}`,
        notify: true,
      });
      break;
    }

    case 'sin_capacidad':
      actions.push({
        layer: 3,
        kind: 'deuda_sin_salida',
        severity: 'urgente',
        title: 'Tus deudas no están bajando',
        message: plan.stuckDebts.length > 0
          ? `La cuota de ${plan.stuckDebts.join(', ')} no alcanza ni para los intereses y no te queda `
            + 'dinero para abonar extra. Revisa tus gastos o renegocia la cuota con la entidad.'
          : 'Con tus ingresos y gastos actuales no te queda dinero para abonar a las deudas. '
            + 'Revisa tus gastos o renegocia las cuotas.',
        data: { ...data, stuckDebts: plan.stuckDebts },
        dedupeKey: `planner:stuck:${targetMonths}:${plan.stuckDebts.join('|')}`,
        notify: true,
      });
      break;
  }

  return { plan, actions };
}
