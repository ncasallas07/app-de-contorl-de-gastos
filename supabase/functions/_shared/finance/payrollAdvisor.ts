// ARCHIVO GENERADO desde src/utils/payrollAdvisor.ts con "npm run agent:sync". No editar aquí.

// Asesor de nómina (capa 4 del agente, basada en utilidad).
//
// El día de pago, después de separar gastos y cuotas mínimas, queda un
// "disponible". El asesor compara varias formas de repartirlo entre
//   - abono extra a la deuda prioritaria, y
//   - colchón de emergencia (ahorro)
// y elige la de MAYOR UTILIDAD, medida en pesos a 12 meses:
//
//   U = intereses que te ahorras − costo esperado de quedarte sin colchón
//
//   intereses ahorrados = abono × ((1 + tasa mensual de la deuda)^12 − 1)
//   costo del riesgo    = K × faltante² ÷ colchón meta
//     faltante = lo que le falta al colchón después del ahorro
//     K = costo a un año del crédito caro con que se cubre un imprevisto
//
// El costo del riesgo es cuadrático: el primer peso de colchón vale mucho
// (sin ahorro, cualquier imprevisto termina en la tarjeta) y cada peso extra
// vale menos. Por eso el óptimo suele repartir entre ambas cosas.
//
// Lógica pura y compartida (app y agente). Se copia con `npm run agent:sync`.

import type { DebtRecord, SalaryProfile } from './finance.ts';
import { getPaymentsPerMonth } from './contract.ts';
import { activeDebts, type DebtPlan } from './debtPlanner.ts';

/** Tasa anual mínima del crédito de emergencia (avance de tarjeta, crédito rápido). */
export const EMERGENCY_CREDIT_RATE = 30;

export interface PayrollOption {
  toDebt: number;
  toSavings: number;
  interestSaved: number;
  riskCost: number;
  utility: number;
}

export interface PayrollAdvice {
  paycheck: number;
  /** Lo que queda de este pago tras gastos y cuotas mínimas del periodo. */
  available: number;
  periodNeeds: number;
  cushionNow: number;
  cushionTarget: number;
  priorityDebt: { id: string; title: string; annualRate: number } | null;
  toDebt: number;
  toSavings: number;
  utility: number;
  /** Abono por pago que pide el plan de la capa 3 (null si no hay plan). */
  planPerPayment: number | null;
  /** Si el abono elegido cumple lo que pide el plan. */
  meetsPlan: boolean | null;
  /** Opciones comparadas (0 %, 25 %, 50 %, 75 %, 100 % a deuda y la elegida). */
  options: PayrollOption[];
}

export interface PayrollInput {
  salary: SalaryProfile;
  debts: DebtRecord[];
  /** Plan de la capa 3: gasto mensual, cuotas mínimas, deuda prioritaria y abono requerido. */
  plan: DebtPlan;
  /** Monto del pago que se va a repartir. */
  paycheck: number;
  /** Ahorro que ya existía antes de este pago. */
  cushionNow: number;
  /** Colchón que quiere tener el usuario (0 o null = un mes de gastos y cuotas). */
  emergencyFundMin: number | null;
}

const yearly = (annualRatePercent: number) => (1 + annualRatePercent / 100 / 12) ** 12 - 1;
const floorTo = (value: number, step: number) => Math.floor(value / step) * step;

/** Monto típico de un pago (mensual, quincenal o semanal) según el contrato. */
export function estimatePaycheck(plan: DebtPlan, salary: SalaryProfile): number {
  return Math.round(plan.monthlyIncome / getPaymentsPerMonth(salary));
}

export function advisePayroll(input: PayrollInput): PayrollAdvice {
  const { plan, salary } = input;
  const perMonth = getPaymentsPerMonth(salary);
  const periodNeeds = Math.round((plan.monthlySpending + plan.totalMinimums) / perMonth);
  const available = Math.max(0, floorTo(input.paycheck - periodNeeds, 1000));
  const cushionNow = Math.max(0, Math.round(input.cushionNow));
  const cushionTarget = input.emergencyFundMin && input.emergencyFundMin > 0
    ? Math.round(input.emergencyFundMin)
    : Math.round(plan.monthlySpending + plan.totalMinimums);

  const open = activeDebts(input.debts);
  const debtRoom = open.reduce((sum, debt) => sum + debt.totalAmount, 0);
  const priority = plan.priorityDebt ? open.find((debt) => debt.id === plan.priorityDebt?.id) ?? null : null;

  const debtValue = priority ? yearly(priority.annualInterestRate) : 0;
  const maxRate = Math.max(EMERGENCY_CREDIT_RATE, ...open.map((debt) => debt.annualInterestRate));
  const riskValue = yearly(maxRate);

  const evaluate = (toDebtRaw: number): PayrollOption => {
    const toDebt = Math.max(0, Math.min(toDebtRaw, available, debtRoom));
    const toSavings = available - toDebt;
    const shortfall = Math.max(0, cushionTarget - cushionNow - toSavings);
    const interestSaved = Math.round(toDebt * debtValue);
    const riskCost = cushionTarget > 0 ? Math.round((riskValue * shortfall * shortfall) / cushionTarget) : 0;
    return { toDebt, toSavings, interestSaved, riskCost, utility: interestSaved - riskCost };
  };

  const planPerPayment = plan.status === 'sin_deudas'
    ? null
    : Math.round(Math.min(plan.requiredExtra, plan.extraCapacity) / perMonth);

  // Se prueba en pasos de 5 % del disponible, más el abono exacto que pide el plan.
  const candidates = new Map<number, PayrollOption>();
  for (let step = 0; step <= 20; step += 1) {
    const option = evaluate(floorTo((available * step) / 20, 1000));
    candidates.set(option.toDebt, option);
  }
  if (planPerPayment !== null) {
    const option = evaluate(planPerPayment);
    candidates.set(option.toDebt, option);
  }

  // Mayor utilidad; en empate, más a deuda (termina antes el plan).
  const best = [...candidates.values()].sort((a, b) => b.utility - a.utility || b.toDebt - a.toDebt)[0];

  const shown = new Map<number, PayrollOption>();
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const option = evaluate(floorTo(available * fraction, 1000));
    shown.set(option.toDebt, option);
  }
  shown.set(best.toDebt, best);

  return {
    paycheck: Math.round(input.paycheck),
    available,
    periodNeeds,
    cushionNow,
    cushionTarget,
    priorityDebt: priority
      ? { id: priority.id, title: priority.title, annualRate: priority.annualInterestRate }
      : null,
    toDebt: best.toDebt,
    toSavings: best.toSavings,
    utility: best.utility,
    planPerPayment,
    meetsPlan: planPerPayment === null ? null : best.toDebt >= Math.min(planPerPayment, available),
    options: [...shown.values()].sort((a, b) => a.toDebt - b.toDebt),
  };
}
