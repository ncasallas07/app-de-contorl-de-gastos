import { deepStrictEqual as assertEquals } from 'node:assert/strict';
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
  return { store, actions, runs, users };
}

const user = (overrides: Partial<UserState> = {}): MemoryUser => ({
  state: {
    salary: { ...salary },
    debts: [{ ...debt }],
    workDays: [],
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
  assertEquals(memory.runs[0].layers, ['ciclo:conflicto', 'vigilante']);
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

  const kinds = actions.map((action) => action.kind).sort();
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
