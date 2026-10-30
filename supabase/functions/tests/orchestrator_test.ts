import { deepStrictEqual as assertEquals, ok } from 'node:assert/strict';
import type { DebtRecord, SalaryProfile } from '../_shared/finance/finance.ts';
import type { AgentAction, StoredAction } from '../_shared/agentTypes.ts';
import {
  type AgentStore,
  type CycleCommit,
  type RunLog,
  runAgent,
  type UserState,
} from '../_shared/orchestrator.ts';
import type { EmailMessage, EmailSender } from '../_shared/notify.ts';
import type { PlanRow } from '../_shared/finance/debtPlanner.ts';

const salary: SalaryProfile = {
  contractType: 'indefinido',
  payMode: 'mensual',
  monthlySalary: 3_000_000,
  dailyRate: 136_364,
  hourlyRate: 17_045,
  workDaysPerWeek: 5,
  paymentWeekday: 5,
  defaultShift: 'diurno',
  hoursPerShift: 8,
  paymentPeriod: 'quincenal',
  paymentDayOfMonth: 30,
  workDaysPerMonthTarget: 22,
  currentBalance: 500_000,
  currency: 'COP',
};

const debt: DebtRecord = {
  id: 'd1',
  title: 'Préstamo carro',
  category: 'prestamo_auto',
  totalAmount: 5_000_000,
  monthlyPayment: 400_000,
  annualInterestRate: 18,
  dueDate: '2026-11-10',
  paymentStatus: 'pendiente',
  minimumPaymentOnly: false,
};

interface MemoryUser {
  state: UserState;
  /** Si se define, simula que la app guardó justo antes de que el agente aplique. */
  concurrentSave?: boolean;
}

/** Base de datos en memoria que imita las reglas de Postgres que usa el agente. */
function memoryStore(users: Record<string, MemoryUser>) {
  const actions: (StoredAction & { userId: string; emailed: boolean })[] = [];
  const runs: RunLog[] = [];
  const plans: Record<string, PlanRow[]> = {};
  let nextId = 1;

  const store: AgentStore = {
    listUserIds: (only) => Promise.resolve(Object.keys(users).filter((id) => !only || id === only)),
    loadUserState: (userId) => {
      if (userId === 'roto') return Promise.reject(new Error('fallo de prueba'));
      return Promise.resolve(structuredClone(users[userId].state));
    },
    applyCycle: (userId, commit: CycleCommit) => {
      const user = users[userId];
      if (user.concurrentSave) user.state.stateVersion += 1;
      if (user.state.stateVersion !== commit.expectedVersion) return Promise.resolve(null);

      const changes = commit.balanceDelta !== 0 || commit.debtUpdates.length > 0;
      if (changes) {
        user.state.stateVersion += 1;
        user.state.salary.currentBalance += commit.balanceDelta;
        for (const update of commit.debtUpdates) {
          const target = user.state.debts.find((item) => item.id === update.id);
          if (target) Object.assign(target, { dueDate: update.dueDate, paymentStatus: update.paymentStatus });
        }
      }
      user.state.lastPaymentApplied = commit.lastPaymentApplied;
      return Promise.resolve(user.state.stateVersion);
    },
    replacePlan: (userId, rows) => {
      plans[userId] = rows;
      return Promise.resolve();
    },
    saveActions: (userId, list: AgentAction[]) => {
      const created: StoredAction[] = [];
      for (const action of list) {
        if (actions.some((saved) => saved.userId === userId && saved.dedupeKey === action.dedupeKey)) continue;
        const stored = { ...action, id: String(nextId++) };
        actions.push({ ...stored, userId, emailed: false });
        created.push(stored);
      }
      return Promise.resolve(created);
    },
    markEmailed: (ids) => {
      for (const action of actions) if (ids.includes(action.id)) action.emailed = true;
      return Promise.resolve();
    },
    getUserEmail: (userId) => Promise.resolve(`${userId}@correo.test`),
    logRun: (entry) => {
      runs.push(entry);
      return Promise.resolve();
    },
  };
  return { store, actions, runs, users, plans };
}

const user = (overrides: Partial<UserState> = {}): MemoryUser => ({
  state: {
    salary: { ...salary },
    debts: [{ ...debt }],
    workDays: [],
    expenses: [],
    feedback: [],
    strategyMode: 'avalancha',
    goal: null,
    stateVersion: 1,
    lastPaymentApplied: '2026-11-01',
    ...overrides,
  },
});

const okSender: EmailSender = () => Promise.resolve({ sent: true });

Deno.test('ejecutar dos veces el mismo día no duplica alertas, correos ni pagos', async () => {
  const { store, actions, users } = memoryStore({ ana: user() });
  const sent: EmailMessage[] = [];
  const sender: EmailSender = (message) => {
    sent.push(message);
    return Promise.resolve({ sent: true });
  };

  await runAgent('2026-11-08', store, sender);
  const second = await runAgent('2026-11-08', store, sender);

  assertEquals(second[0].newActions, 0);
  assertEquals(actions.filter((action) => action.kind === 'deuda_por_vencer').length, 1);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].to, 'ana@correo.test');
  assertEquals(users.ana.state.salary.currentBalance, 500_000);
});

Deno.test('el día de pago quincenal suma medio salario al balance una sola vez', async () => {
  const { store, actions, users } = memoryStore({ ana: user({ lastPaymentApplied: '2026-11-14' }) });

  const first = await runAgent('2026-11-15', store, okSender);
  await runAgent('2026-11-15', store, okSender);

  assertEquals(first[0].balanceDelta, 1_500_000);
  assertEquals(users.ana.state.salary.currentBalance, 2_000_000);
  assertEquals(users.ana.state.lastPaymentApplied, '2026-11-15');
  assertEquals(actions.filter((action) => action.kind === 'pago_aplicado').length, 1);
});

Deno.test('si la app guardó mientras el agente pensaba, no pisa nada y lo reintenta', async () => {
  const memory = memoryStore({ ana: { ...user({ lastPaymentApplied: '2026-11-14' }), concurrentSave: true } });

  const [result] = await runAgent('2026-11-15', memory.store, okSender);

  assertEquals(result.status, 'ok');
  assertEquals(result.balanceDelta, 0);
  assertEquals(memory.users.ana.state.salary.currentBalance, 500_000);
  assertEquals(memory.users.ana.state.lastPaymentApplied, '2026-11-14');
  assertEquals(memory.runs[0].layers, ['ciclo:conflicto', 'planificador', 'aprendizaje', 'vigilante']);
  assertEquals(memory.actions.some((action) => action.kind === 'pago_aplicado'), false);

  // Al día siguiente, sin conflicto, el pago del 15 sí se aplica.
  memory.users.ana.concurrentSave = false;
  const [retry] = await runAgent('2026-11-16', memory.store, okSender);
  assertEquals(retry.balanceDelta, 1_500_000);
});

Deno.test('el vigilante ve la cuota renovada por el ciclo en la misma ejecución', async () => {
  const paid: DebtRecord = { ...debt, dueDate: '2026-10-28', paymentStatus: 'pagado_mes' };
  const { store, actions } = memoryStore({ ana: user({ debts: [paid], lastPaymentApplied: '2026-11-24' }) });

  // 2026-11-25: la cuota pagada del 28 oct se renueva al 28 nov, que vence en 3 días.
  await runAgent('2026-11-25', store, okSender);

  const kinds = actions.filter((action) => action.layer !== 3).map((action) => action.kind).sort();
  assertEquals(kinds, ['cuota_renovada', 'deuda_por_vencer']);
});

Deno.test('sin clave de Resend la alerta queda en la app y no se marca como enviada', async () => {
  const { store, actions, runs } = memoryStore({ ana: user() });
  const noEmail: EmailSender = () => Promise.resolve({ sent: false, reason: 'sin clave' });

  await runAgent('2026-11-10', store, noEmail);

  const alert = actions.find((action) => action.layer === 1);
  assertEquals(alert?.emailed, false);
  assertEquals(runs[0].status, 'ok');
  assertEquals(runs[0].emailsSent, 0);
});

Deno.test('un usuario con error no detiene a los demás y queda en la bitácora', async () => {
  const { store, runs } = memoryStore({ roto: user(), ana: user() });

  const results = await runAgent('2026-11-08', store, okSender);

  assertEquals(results.map((result) => result.status), ['error', 'ok']);
  assertEquals(runs.find((run) => run.userId === 'roto')?.error, 'fallo de prueba');
});

Deno.test('capa 3: guarda el plan y solo avisa de nuevo cuando el plan cambia', async () => {
  const memory = memoryStore({ ana: user({ goal: { targetMonths: 12, active: true, emergencyFundMin: 0 } }) });

  await runAgent('2026-11-01', memory.store, okSender);
  await runAgent('2026-11-02', memory.store, okSender);

  const planActions = memory.actions.filter((action) => action.layer === 3);
  assertEquals(planActions.length, 1);
  assertEquals(planActions[0].kind, 'plan_listo');
  assertEquals(memory.plans.ana.length > 0, true);
  assertEquals(memory.plans.ana.at(-1)?.remaining, 0);

  // El usuario acorta la meta a 3 meses: ya no cabe en su capacidad → aviso nuevo por correo.
  memory.users.ana.state.goal = { targetMonths: 3, active: true, emergencyFundMin: 0 };
  memory.users.ana.state.expenses = [
    { id: 'e1', date: '2026-11-01', amount: 2_000_000, title: 'Arriendo', category: 'vivienda', isAntExpense: false },
  ];
  await runAgent('2026-11-03', memory.store, okSender);
  const latest = memory.actions.filter((action) => action.layer === 3).at(-1);
  assertEquals(latest?.kind, 'meta_inalcanzable');
  assertEquals(latest?.emailed, true);
});

Deno.test('capa 3: con la meta desactivada no planifica', async () => {
  const memory = memoryStore({ ana: user({ goal: { targetMonths: 12, active: false, emergencyFundMin: 0 } }) });
  await runAgent('2026-11-01', memory.store, okSender);
  assertEquals(memory.plans.ana, undefined);
  assertEquals(memory.actions.some((action) => action.layer === 3), false);
});

Deno.test('capa 4: el día de pago recomienda cómo repartirlo y lo envía por correo', async () => {
  const memory = memoryStore({ ana: user({ lastPaymentApplied: '2026-11-14' }) });

  const [result] = await runAgent('2026-11-15', memory.store, okSender);

  assertEquals(memory.runs[0].layers, ['ciclo', 'planificador', 'asesor', 'aprendizaje', 'vigilante']);
  assertEquals(result.balanceDelta, 1_500_000);
  const advice = memory.actions.find((action) => action.layer === 4);
  assertEquals(advice?.kind, 'reparto_nomina');
  assertEquals(advice?.dedupeKey, 'payroll:2026-11-15');
  assertEquals(advice?.emailed, true);
  const data = advice?.data as { available: number; toDebt: number; toSavings: number };
  assertEquals(data.toDebt + data.toSavings, data.available);
});

Deno.test('capa 4: en un día sin pago no se activa', async () => {
  const memory = memoryStore({ ana: user({ lastPaymentApplied: '2026-11-15' }) });
  await runAgent('2026-11-16', memory.store, okSender);
  assertEquals(memory.runs[0].layers.includes('asesor'), false);
  assertEquals(memory.actions.some((action) => action.layer === 4), false);
});

Deno.test('capa 5: pronostica los gastos hormiga del mes y señala los no marcados', async () => {
  const ant = (id: string, date: string, amount: number, isAntExpense = true) => ({
    id, date, amount, title: 'Tinto y empanada', category: 'cafe_snacks' as const, isAntExpense,
  });
  const memory = memoryStore({
    ana: user({
      expenses: [
        ant('a', '2026-11-02', 60_000),
        ant('b', '2026-11-05', 90_000),
        ant('c', '2026-11-08', 9_000, false),
      ],
    }),
  });

  await runAgent('2026-11-10', memory.store, okSender);

  const forecast = memory.actions.find((action) => action.kind === 'pronostico_hormiga');
  // Marcados: 150.000 en 10 días → 450.000 en noviembre (30 días), 15 % del ingreso → alerta alta.
  assertEquals(forecast?.severity, 'alta');
  assertEquals((forecast!.data as { projected: number }).projected, 450_000);
  assertEquals(forecast?.emailed, true);
  const suspect = memory.actions.find((action) => action.kind === 'posible_hormiga');
  ok(suspect, 'debería señalar el gasto no marcado');
  assertEquals((suspect.data as { expenses: { id: string }[] }).expenses.map((item) => item.id), ['c']);

  // Al día siguiente no repite la misma alerta.
  const before = memory.actions.length;
  await runAgent('2026-11-11', memory.store, okSender);
  assertEquals(memory.actions.filter((action) => action.kind === 'pronostico_hormiga').length, 1);
  ok(memory.actions.length >= before);
});
