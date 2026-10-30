import { deepStrictEqual as assertEquals, ok } from 'node:assert/strict';
import type { DebtRecord, SalaryProfile } from '../_shared/finance/finance.ts';
import {
  buildDebtPlan,
  estimateMonthlySpending,
  monthLabel,
  type PlanInput,
  remainingByMonth,
} from '../_shared/finance/debtPlanner.ts';

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
  currentBalance: 0,
  currency: 'COP',
};

const debt = (overrides: Partial<DebtRecord>): DebtRecord => ({
  id: 'd',
  title: 'Deuda',
  category: 'tarjeta_credito',
  totalAmount: 1_000_000,
  monthlyPayment: 100_000,
  annualInterestRate: 24,
  dueDate: '2026-11-30',
  paymentStatus: 'pendiente',
  minimumPaymentOnly: false,
  ...overrides,
});

const tarjeta = debt({ id: 'tarjeta', title: 'Tarjeta', totalAmount: 2_000_000, monthlyPayment: 150_000, annualInterestRate: 30 });
const moto = debt({ id: 'moto', title: 'Moto', totalAmount: 600_000, monthlyPayment: 100_000, annualInterestRate: 12 });

const input = (overrides: Partial<PlanInput>): PlanInput => ({
  salary,
  debts: [tarjeta, moto],
  expenses: [],
  method: 'avalancha',
  targetMonths: 12,
  todayIso: '2026-10-30',
  ...overrides,
});

Deno.test('monthLabel cruza años', () => {
  assertEquals(monthLabel('2026-10-30', 1), '2026-11');
  assertEquals(monthLabel('2026-10-30', 3), '2027-01');
});

Deno.test('interés mensual = saldo × tasa anual / 12 (caso calculado a mano)', () => {
  // 1.000.000 al 12 % anual = 1 % mensual, cuota 510.000:
  // mes 1: 1.010.000 − 510.000 = 500.000; mes 2: 505.000 − 505.000 = 0.
  const plan = buildDebtPlan(input({
    debts: [debt({ totalAmount: 1_000_000, monthlyPayment: 510_000, annualInterestRate: 12 })],
    targetMonths: 2,
  }));
  assertEquals(plan.status, 'alcanzable');
  assertEquals(plan.requiredExtra, 0);
  assertEquals(plan.months, 2);
  assertEquals(plan.totalInterest, 15_000);
  assertEquals(plan.schedule.map((row) => row.remaining), [500_000, 0]);
  assertEquals(plan.endMonth, '2026-12');
});

Deno.test('el abono extra encontrado cumple la meta y uno menor no', () => {
  const plan = buildDebtPlan(input({ targetMonths: 8 }));
  assertEquals(plan.status, 'alcanzable');
  ok(plan.months !== null && plan.months <= 8);

  const less = buildDebtPlan(input({ targetMonths: 8, salary: { ...salary, monthlySalary: 0 } }));
  // Sin ingreso no hay capacidad: el calendario con 0 extra tarda más que la meta.
  ok(less.months === null || less.months > 8);
  assertEquals(plan.requiredExtra % 1000, 0);
});

Deno.test('meta más corta exige más abono extra', () => {
  const doce = buildDebtPlan(input({ targetMonths: 12 }));
  const seis = buildDebtPlan(input({ targetMonths: 6 }));
  ok(seis.requiredExtra > doce.requiredExtra);
});

Deno.test('avalancha ataca primero la tasa más alta; bola de nieve el saldo más bajo', () => {
  const avalancha = buildDebtPlan(input({ method: 'avalancha' }));
  const bola = buildDebtPlan(input({ method: 'bola_de_nieve' }));
  assertEquals(avalancha.priorityDebt?.id, 'tarjeta');
  assertEquals(bola.priorityDebt?.id, 'moto');
  assertEquals(bola.payoffOrder[0].debtId, 'moto');
});

Deno.test('pagar con plan ahorra intereses frente a pagar solo mínimos', () => {
  const plan = buildDebtPlan(input({ targetMonths: 6 }));
  ok(plan.interestSaved > 0);
  ok(plan.baselineMonths !== null && plan.months !== null && plan.baselineMonths > plan.months);
});

Deno.test('si la meta no cabe en la capacidad, arma el mejor plan posible', () => {
  // Gasta casi todo el ingreso: capacidad extra de 50.000.
  const plan = buildDebtPlan(input({
    targetMonths: 3,
    expenses: [{ date: '2026-10-01', amount: 2_700_000 }],
  }));
  assertEquals(plan.status, 'inalcanzable');
  assertEquals(plan.spendingSource, 'gastos');
  assertEquals(plan.planExtra, plan.extraCapacity);
  ok(plan.requiredExtra > plan.extraCapacity);
  ok(plan.months !== null && plan.months > 3);
});

Deno.test('sin capacidad y con una cuota que no cubre los intereses: sin_capacidad', () => {
  const plan = buildDebtPlan(input({
    debts: [debt({ title: 'Préstamo', totalAmount: 5_000_000, monthlyPayment: 50_000, annualInterestRate: 24 })],
    salary: { ...salary, monthlySalary: 100_000 },
  }));
  assertEquals(plan.status, 'sin_capacidad');
  assertEquals(plan.stuckDebts, ['Préstamo']);
  assertEquals(plan.months, null);
  assertEquals(plan.baselineMonths, null);
});

Deno.test('sin deudas activas no hay plan', () => {
  const plan = buildDebtPlan(input({ debts: [{ ...tarjeta, paymentStatus: 'liquidada' }] }));
  assertEquals(plan.status, 'sin_deudas');
  assertEquals(plan.schedule, []);
});

Deno.test('el gasto mensual se estima con los últimos 90 días', () => {
  // 600.000 en 45 días → 400.000 al mes.
  const spent = estimateMonthlySpending(
    [{ date: '2026-09-16', amount: 300_000 }, { date: '2026-10-30', amount: 300_000 }, { date: '2026-01-01', amount: 9_000_000 }],
    3_000_000,
    '2026-10-30'
  );
  assertEquals(spent, { amount: 400_000, source: 'gastos' });
  assertEquals(estimateMonthlySpending([], 3_000_000, '2026-10-30'), { amount: 1_500_000, source: 'estimado' });
});

Deno.test('el saldo total del calendario baja hasta cero', () => {
  const series = remainingByMonth(buildDebtPlan(input({})));
  ok(series.length > 0);
  assertEquals(series.at(-1)?.remaining, 0);
  ok(series.every((point, i) => i === 0 || point.remaining <= series[i - 1].remaining));
});
