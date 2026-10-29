import { deepStrictEqual as assertEquals } from 'node:assert/strict';
import type { DebtRecord } from '../_shared/finance/finance.ts';
import { runWatcher } from '../_shared/agents/watcher.ts';

const debt = (overrides: Partial<DebtRecord>): DebtRecord => ({
  id: 'd1',
  title: 'Tarjeta Visa',
  category: 'tarjeta_credito',
  totalAmount: 1_000_000,
  monthlyPayment: 150_000,
  annualInterestRate: 28,
  dueDate: '2026-11-10',
  paymentStatus: 'pendiente',
  minimumPaymentOnly: false,
  ...overrides,
});

const TODAY = '2026-11-08';

Deno.test('avisa cuando la cuota vence dentro de 3 días', () => {
  const [action] = runWatcher([debt({ dueDate: '2026-11-10' })], TODAY);
  assertEquals(action.kind, 'deuda_por_vencer');
  assertEquals(action.severity, 'alta');
  assertEquals(action.data.daysLeft, 2);
  assertEquals(action.notify, true);
});

Deno.test('no hace nada si faltan más de 3 días', () => {
  assertEquals(runWatcher([debt({ dueDate: '2026-11-12' })], TODAY), []);
});

Deno.test('a 1 día la alerta pasa a urgente', () => {
  const [action] = runWatcher([debt({ dueDate: '2026-11-09' })], TODAY);
  assertEquals(action.severity, 'urgente');
});

Deno.test('detecta la cuota que vence hoy', () => {
  const [action] = runWatcher([debt({ dueDate: TODAY })], TODAY);
  assertEquals(action.title, 'Tarjeta Visa: vence hoy');
  assertEquals(action.severity, 'urgente');
});

Deno.test('detecta cuotas vencidas', () => {
  const [action] = runWatcher([debt({ dueDate: '2026-11-05' })], TODAY);
  assertEquals(action.kind, 'deuda_vencida');
  assertEquals(action.data.daysLeft, -3);
});

Deno.test('ignora deudas liquidadas, ya pagadas este mes o sin saldo', () => {
  const debts = [
    debt({ id: 'a', paymentStatus: 'liquidada', dueDate: TODAY }),
    debt({ id: 'b', paymentStatus: 'pagado_mes', dueDate: TODAY }),
    debt({ id: 'c', totalAmount: 0, dueDate: TODAY }),
  ];
  assertEquals(runWatcher(debts, TODAY), []);
});

Deno.test('la clave cambia de nivel para escalar el aviso, pero no se repite el mismo día', () => {
  const near = runWatcher([debt({})], '2026-11-08')[0].dedupeKey;
  const nearNextDay = runWatcher([debt({})], '2026-11-09')[0].dedupeKey;
  const dueDay = runWatcher([debt({})], '2026-11-10')[0].dedupeKey;
  assertEquals(near, nearNextDay);
  assertEquals(dueDay === near, false);
});

Deno.test('el monto avisado nunca supera el saldo', () => {
  const [action] = runWatcher([debt({ totalAmount: 80_000, monthlyPayment: 150_000, dueDate: TODAY })], TODAY);
  assertEquals(action.data.payment, 80_000);
});

Deno.test('ordena de más urgente a menos urgente', () => {
  const actions = runWatcher([
    debt({ id: 'x', dueDate: '2026-11-10' }),
    debt({ id: 'y', dueDate: '2026-11-01' }),
    debt({ id: 'z', dueDate: TODAY }),
  ], TODAY);
  assertEquals(actions.map((action) => action.data.debtId), ['y', 'z', 'x']);
});
