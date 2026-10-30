import { deepStrictEqual as assertEquals, ok } from 'node:assert/strict';
import type { DebtRecord, SalaryProfile } from '../_shared/finance/finance.ts';
import { buildDebtPlan } from '../_shared/finance/debtPlanner.ts';
import { advisePayroll, estimatePaycheck, type PayrollInput } from '../_shared/finance/payrollAdvisor.ts';

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
  paymentPeriod: 'mensual',
  paymentDayOfMonth: 30,
  workDaysPerMonthTarget: 22,
  currentBalance: 0,
  currency: 'COP',
};

const tarjeta: DebtRecord = {
  id: 'tarjeta',
  title: 'Tarjeta',
  category: 'tarjeta_credito',
  totalAmount: 5_000_000,
  monthlyPayment: 200_000,
  annualInterestRate: 30,
  dueDate: '2026-11-30',
  paymentStatus: 'pendiente',
  minimumPaymentOnly: false,
};

// Gasta 1.800.000 al mes; con 200.000 de cuota quedan 1.000.000 disponibles por pago mensual.
const expenses = [{ date: '2026-10-15', amount: 1_800_000 }];

const input = (overrides: Partial<PayrollInput> & { debts?: DebtRecord[] } = {}): PayrollInput => {
  const debts = overrides.debts ?? [tarjeta];
  const plan = buildDebtPlan({ salary, debts, expenses, method: 'avalancha', targetMonths: 24, todayIso: '2026-10-30' });
  return { salary, debts, plan, paycheck: 3_000_000, cushionNow: 0, emergencyFundMin: null, ...overrides };
};

const yearly = (rate: number) => (1 + rate / 100 / 12) ** 12 - 1;

Deno.test('disponible = pago − (gastos + cuotas mínimas) del periodo', () => {
  const advice = advisePayroll(input());
  assertEquals(advice.periodNeeds, 2_000_000);
  assertEquals(advice.available, 1_000_000);
  assertEquals(advice.toDebt + advice.toSavings, 1_000_000);
});

Deno.test('la utilidad de cada opción sigue la fórmula (caso calculado a mano)', () => {
  // 100 % a deuda: intereses = 1.000.000 × ((1 + 0,30/12)^12 − 1) ≈ 344.889.
  // Colchón meta = 2.000.000 (un mes), sin ahorro: costo = K × 2.000.000² ÷ 2.000.000 = K × 2.000.000.
  const advice = advisePayroll(input());
  const allDebt = advice.options.find((option) => option.toDebt === 1_000_000)!;
  assertEquals(allDebt.interestSaved, Math.round(1_000_000 * yearly(30)));
  assertEquals(allDebt.riskCost, Math.round(yearly(30) * 2_000_000));
  assertEquals(allDebt.utility, allDebt.interestSaved - allDebt.riskCost);
});

Deno.test('sin colchón reparte: el óptimo deja el colchón a la mitad cuando las tasas son iguales', () => {
  // Con costo cuadrático, el óptimo cumple 2K·faltante/C = K → faltante = C/2 = 1.000.000.
  // Pero solo hay 1.000.000 disponible: ahorrar todo deja faltante 1.000.000 → justo el óptimo.
  const advice = advisePayroll(input());
  assertEquals(advice.toSavings, 1_000_000);
  // Con la mitad del colchón ya ahorrado, lo mejor es ir todo a la deuda.
  const half = advisePayroll(input({ cushionNow: 1_000_000 }));
  assertEquals(half.toDebt, 1_000_000);
});

Deno.test('con colchón parcial divide el disponible entre deuda y ahorro', () => {
  const advice = advisePayroll(input({ cushionNow: 500_000 }));
  ok(advice.toDebt > 0 && advice.toSavings > 0);
  // Óptimo teórico: faltante 1.000.000 → ahorrar 500.000.
  assertEquals(advice.toSavings, 500_000);
});

Deno.test('elige la opción de mayor utilidad entre las comparadas', () => {
  const advice = advisePayroll(input({ cushionNow: 300_000 }));
  const best = Math.max(...advice.options.map((option) => option.utility));
  assertEquals(advice.utility, best);
});

Deno.test('una deuda barata pesa menos que el colchón', () => {
  const cheap = { ...tarjeta, annualInterestRate: 6 };
  const advice = advisePayroll(input({ debts: [cheap], cushionNow: 1_500_000 }));
  // A 6 % anual conviene completar más colchón que con la tarjeta al 30 %.
  const expensive = advisePayroll(input({ cushionNow: 1_500_000 }));
  ok(advice.toSavings > expensive.toSavings);
});

Deno.test('respeta el colchón que fija el usuario', () => {
  const advice = advisePayroll(input({ emergencyFundMin: 500_000, cushionNow: 500_000 }));
  assertEquals(advice.cushionTarget, 500_000);
  assertEquals(advice.toDebt, 1_000_000);
});

Deno.test('nunca abona más de lo que se debe', () => {
  const small = { ...tarjeta, totalAmount: 300_000 };
  const advice = advisePayroll(input({ debts: [small], cushionNow: 5_000_000 }));
  assertEquals(advice.toDebt, 300_000);
  assertEquals(advice.toSavings, 700_000);
});

Deno.test('si el pago no alcanza para gastos y cuotas, no hay nada que repartir', () => {
  const advice = advisePayroll(input({ paycheck: 1_500_000 }));
  assertEquals(advice.available, 0);
  assertEquals(advice.toDebt, 0);
});

Deno.test('sin deudas, todo va al ahorro', () => {
  const advice = advisePayroll(input({ debts: [] }));
  assertEquals(advice.priorityDebt, null);
  assertEquals(advice.toDebt, 0);
  assertEquals(advice.planPerPayment, null);
});

Deno.test('quincenal: el pago típico es medio salario y las necesidades se dividen en dos', () => {
  const quincenal = { ...salary, paymentPeriod: 'quincenal' as const };
  const plan = buildDebtPlan({ salary: quincenal, debts: [tarjeta], expenses, method: 'avalancha', targetMonths: 24, todayIso: '2026-10-30' });
  assertEquals(estimatePaycheck(plan, quincenal), 1_500_000);
  const advice = advisePayroll({ salary: quincenal, debts: [tarjeta], plan, paycheck: 1_500_000, cushionNow: 0, emergencyFundMin: null });
  assertEquals(advice.periodNeeds, 1_000_000);
  assertEquals(advice.available, 500_000);
});
