import { deepStrictEqual as assertEquals } from 'node:assert/strict';
import type { DebtRecord } from '../_shared/finance/finance.ts';
import type { AgentAction, StoredAction } from '../_shared/agentTypes.ts';
import { type AgentStore, type RunLog, runAgent } from '../_shared/orchestrator.ts';
import type { EmailMessage, EmailSender } from '../_shared/notify.ts';

/** Base de datos en memoria que imita la restricción única (user_id, dedupe_key). */
function memoryStore(debtsByUser: Record<string, DebtRecord[]>) {
  const actions: (StoredAction & { userId: string; emailed: boolean })[] = [];
  const runs: RunLog[] = [];
  let nextId = 1;

  const store: AgentStore = {
    listUserIds: (only) => Promise.resolve(Object.keys(debtsByUser).filter((id) => !only || id === only)),
    loadDebts: (userId) => {
      if (userId === 'roto') return Promise.reject(new Error('fallo de prueba'));
      return Promise.resolve(debtsByUser[userId] ?? []);
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
  return { store, actions, runs };
}

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

Deno.test('ejecutar dos veces el mismo día no duplica alertas ni correos', async () => {
  const { store, actions } = memoryStore({ ana: [debt] });
  const sent: EmailMessage[] = [];
  const sender: EmailSender = (message) => {
    sent.push(message);
    return Promise.resolve({ sent: true });
  };

  const first = await runAgent('2026-11-08', store, sender);
  const second = await runAgent('2026-11-08', store, sender);

  assertEquals(first[0].newActions, 1);
  assertEquals(second[0].newActions, 0);
  assertEquals(actions.length, 1);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].to, 'ana@correo.test');
  assertEquals(actions[0].emailed, true);
});

Deno.test('sin clave de Resend la alerta queda en la app y no se marca como enviada', async () => {
  const { store, actions, runs } = memoryStore({ ana: [debt] });
  const noEmail: EmailSender = () => Promise.resolve({ sent: false, reason: 'sin clave' });

  await runAgent('2026-11-10', store, noEmail);

  assertEquals(actions.length, 1);
  assertEquals(actions[0].emailed, false);
  assertEquals(runs[0].status, 'ok');
  assertEquals(runs[0].emailsSent, 0);
});

Deno.test('un usuario con error no detiene a los demás y queda en la bitácora', async () => {
  const { store, runs } = memoryStore({ roto: [], ana: [debt] });
  const sender: EmailSender = () => Promise.resolve({ sent: true });

  const results = await runAgent('2026-11-08', store, sender);

  assertEquals(results.map((result) => result.status), ['error', 'ok']);
  assertEquals(runs.find((run) => run.userId === 'roto')?.error, 'fallo de prueba');
});
