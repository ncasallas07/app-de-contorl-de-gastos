import { deepStrictEqual as assertEquals } from 'node:assert/strict';
import type { DebtRecord, SalaryProfile, WorkDayRecord } from '../_shared/finance/finance.ts';
import {
  addOneMonth,
  type CycleInput,
  isPayday,
  MAX_CATCH_UP_DAYS,
  paymentAmount,
  runCycle,
} from '../_shared/agents/cycle.ts';

const indefinido: SalaryProfile = {
  contractType: 'indefinido',
  payMode: 'mensual',
  monthlySalary: 3_000_000,
  dailyRate: 136_364,
  hourlyRate: 17_045,
  workDaysPerWeek: 5,
  paymentWeekday: 5,
  defaultShift: 'diurno',
  hoursPerShift: 8,
  paymentPeriod: 'mensual',
  paymentDayOfMonth: 30,
  workDaysPerMonthTarget: 22,
  currentBalance: 500_000,
  currency: 'COP',
};

const quincenal: SalaryProfile = { ...indefinido, paymentPeriod: 'quincenal' };

const obra: SalaryProfile = {
  ...indefinido,
  contractType: 'obra_labor',
  payMode: 'dia',
  dailyRate: 120_000,
  paymentPeriod: 'semanal',
  paymentWeekday: 5, // viernes
};

const input = (overrides: Partial<CycleInput>): CycleInput => ({
  salary: indefinido,
  debts: [],
  workDays: [],
  todayIso: '2026-11-01',
  lastPaymentApplied: '2026-10-31',
  ...overrides,
});

// ---------- Fechas de pago ----------

Deno.test('mensual: el día 30; en febrero, el último día', () => {
  assertEquals(isPayday(indefinido, '2026-11-30'), true);
  assertEquals(isPayday(indefinido, '2026-11-29'), false);
  assertEquals(isPayday(indefinido, '2027-02-28'), true);
});

Deno.test('quincenal: el 15 y el último día del mes', () => {
  assertEquals(isPayday(quincenal, '2026-11-15'), true);
  assertEquals(isPayday(quincenal, '2026-10-31'), true);
  assertEquals(isPayday(quincenal, '2026-10-30'), false);
});

Deno.test('obra o labor: el día de la semana configurado', () => {
  assertEquals(isPayday(obra, '2026-11-06'), true); // viernes
  assertEquals(isPayday(obra, '2026-11-07'), false);
});

Deno.test('addOneMonth conserva el día y lo ajusta al final del mes', () => {
  assertEquals(addOneMonth('2026-10-28'), '2026-11-28');
  assertEquals(addOneMonth('2026-01-31'), '2026-02-28');
  assertEquals(addOneMonth('2026-12-15'), '2027-01-15');
});

// ---------- Montos ----------

Deno.test('obra o labor cobra lo ganado en las jornadas de esa semana', () => {
  const days: WorkDayRecord[] = [
    { date: '2026-10-30', type: 'laboral', dailyEarnings: 120_000 }, // semana anterior
    { date: '2026-11-02', type: 'laboral', dailyEarnings: 120_000 },
    { date: '2026-11-03', type: 'medio_dia' }, // sin valor guardado: se calcula (60.000)
    { date: '2026-11-04', type: 'descanso' },
    { date: '2026-11-06', type: 'extra', dailyEarnings: 120_000 },
  ];
  assertEquals(paymentAmount(obra, days, '2026-11-06'), 300_000);
});

// ---------- El agente ----------

Deno.test('primera ejecución: no suma pagos pasados, solo empieza a seguirlos', () => {
  const result = runCycle(input({ todayIso: '2026-10-31', lastPaymentApplied: null, salary: quincenal }));
  assertEquals(result.balanceDelta, 0);
  assertEquals(result.lastPaymentApplied, '2026-10-31');
  assertEquals(result.actions[0].kind, 'seguimiento_activado');
  assertEquals(result.actions[0].data.nextPayday, '2026-11-15');
});

Deno.test('suma el salario mensual el día de pago', () => {
  const result = runCycle(input({ todayIso: '2026-11-30', lastPaymentApplied: '2026-11-29' }));
  assertEquals(result.balanceDelta, 3_000_000);
  assertEquals(result.actions.map((action) => action.kind), ['pago_aplicado']);
});

Deno.test('no repite un pago que ya aplicó', () => {
  const result = runCycle(input({ todayIso: '2026-11-30', lastPaymentApplied: '2026-11-30' }));
  assertEquals(result.balanceDelta, 0);
  assertEquals(result.actions, []);
});

Deno.test('si el cron estuvo apagado, se pone al día con todos los pagos perdidos', () => {
  const result = runCycle(input({ salary: quincenal, todayIso: '2026-12-02', lastPaymentApplied: '2026-11-10' }));
  // 15 nov y 30 nov.
  assertEquals(result.balanceDelta, 3_000_000);
  assertEquals(result.lastPaymentApplied, '2026-12-02');
});

Deno.test(`no revisa más de ${MAX_CATCH_UP_DAYS} días hacia atrás`, () => {
  const result = runCycle(input({ todayIso: '2026-12-31', lastPaymentApplied: '2026-01-01' }));
  // 62 días antes del 31 dic es el 30 oct: solo cuentan 30 oct, 30 nov y 30 dic.
  assertEquals(result.balanceDelta, 9_000_000);
});

Deno.test('simular una fecha pasada no retrocede la memoria', () => {
  const result = runCycle(input({ todayIso: '2026-11-05', lastPaymentApplied: '2026-11-20' }));
  assertEquals(result.lastPaymentApplied, '2026-11-20');
  assertEquals(result.balanceDelta, 0);
});

Deno.test('obra o labor sin jornadas: avisa y no suma nada', () => {
  const result = runCycle(input({ salary: obra, todayIso: '2026-11-06', lastPaymentApplied: '2026-11-05' }));
  assertEquals(result.balanceDelta, 0);
  assertEquals(result.actions[0].kind, 'pago_sin_jornadas');
});

const paidDebt: DebtRecord = {
  id: 'd1',
  title: 'Tarjeta',
  category: 'tarjeta_credito',
  totalAmount: 800_000,
  monthlyPayment: 120_000,
  annualInterestRate: 28,
  dueDate: '2026-10-30',
  paymentStatus: 'pagado_mes',
  minimumPaymentOnly: false,
};

Deno.test('renueva la cuota pagada cuando pasa su fecha', () => {
  const result = runCycle(input({ todayIso: '2026-10-31', debts: [paidDebt] }));
  assertEquals(result.debtUpdates, [{ id: 'd1', dueDate: '2026-11-30', paymentStatus: 'pendiente' }]);
  assertEquals(result.actions.find((action) => action.kind === 'cuota_renovada')?.dedupeKey, 'cycle:roll:d1:2026-10-30');
});

Deno.test('no renueva si la fecha no ha pasado, ni deudas pendientes o liquidadas', () => {
  const debts: DebtRecord[] = [
    { ...paidDebt, id: 'a', dueDate: '2026-10-31' },                      // vence hoy
    { ...paidDebt, id: 'b', paymentStatus: 'pendiente' },                 // sin pagar: la vigila la capa 1
    { ...paidDebt, id: 'c', paymentStatus: 'liquidada', totalAmount: 0 }, // terminada
  ];
  assertEquals(runCycle(input({ todayIso: '2026-10-31', debts })).debtUpdates, []);
});
