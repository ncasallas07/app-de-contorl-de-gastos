// Planificador "sin deudas" (capa 3 del agente, basada en objetivos).
//
// Lógica pura y compartida: la usa la app para mostrar el plan en vivo y el
// agente (supabase/functions) para guardarlo y avisar cuando cambia.
// Se copia a las Edge Functions con `npm run agent:sync`.
//
// Modelo:
// - Cada mes, cada deuda genera interés: saldo × (tasa anual / 12).
// - Se paga la cuota mínima de cada deuda y el abono extra va a la deuda
//   prioritaria según el método (avalancha: mayor tasa; bola de nieve: menor
//   saldo). Cuando una deuda termina, su cuota se suma al abono ("efecto bola").
// - Objetivo: el menor abono extra mensual que deja todo pagado en N meses.

import type { DebtRecord, ExpenseRecord, SalaryProfile, StrategyMethod } from '../types/finance';
import { getMonthlyIncome } from './contract';

/** Tope de la simulación: 50 años. */
export const MAX_PLAN_MONTHS = 600;

export type PlanStatus = 'sin_deudas' | 'alcanzable' | 'inalcanzable' | 'sin_capacidad';

export interface PlanRow {
  /** Mes del plan en formato YYYY-MM. */
  month: string;
  debtId: string;
  payment: number;
  interest: number;
  remaining: number;
}

export interface DebtPayoff {
  debtId: string;
  title: string;
  /** YYYY-MM en que queda en cero, o null si no termina. */
  month: string | null;
}

export interface DebtPlan {
  status: PlanStatus;
  method: StrategyMethod;
  targetMonths: number;
  monthlyIncome: number;
  monthlySpending: number;
  spendingSource: 'gastos' | 'estimado';
  totalMinimums: number;
  /** Lo que queda cada mes para abonar extra a deudas. */
  extraCapacity: number;
  /** Abono extra mensual que cumple la meta (puede superar la capacidad). */
  requiredExtra: number;
  /** Abono extra con el que se armó el calendario. */
  planExtra: number;
  months: number | null;
  endMonth: string | null;
  totalInterest: number;
  baselineMonths: number | null;
  baselineInterest: number;
  /** Intereses que se ahorran frente a pagar solo las cuotas mínimas. */
  interestSaved: number;
  priorityDebt: { id: string; title: string } | null;
  payoffOrder: DebtPayoff[];
  /** Deudas cuya cuota mínima no alcanza ni para los intereses. */
  stuckDebts: string[];
  schedule: PlanRow[];
}

export interface PlanInput {
  salary: SalaryProfile;
  debts: DebtRecord[];
  expenses: Pick<ExpenseRecord, 'date' | 'amount'>[];
  method: StrategyMethod;
  targetMonths: number;
  /** Hoy, YYYY-MM-DD. El plan empieza el mes siguiente. */
  todayIso: string;
}

// ---------- Fechas como texto (igual en el navegador y en el servidor) ----------

const toUtc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** YYYY-MM, `offset` meses después del mes de `iso`. */
export function monthLabel(iso: string, offset: number): string {
  const [y, m] = iso.split('-').map(Number);
  const index = y * 12 + (m - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "2027-08" → "agosto de 2027". */
export function monthName(label: string): string {
  const [year, month] = label.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} de ${year}`;
}

const roundUp = (value: number, step: number) => Math.ceil(value / step) * step;

// ---------- Gasto mensual ----------

/**
 * Promedio mensual de gastos de los últimos 90 días. Si no hay gastos, se
 * estima con la regla 50/30/20 de la app: 50 % del ingreso para necesidades.
 */
export function estimateMonthlySpending(
  expenses: Pick<ExpenseRecord, 'date' | 'amount'>[],
  monthlyIncome: number,
  todayIso: string
): { amount: number; source: 'gastos' | 'estimado' } {
  const today = toUtc(todayIso);
  const windowStart = today - 90 * 86_400_000;
  const recent = expenses.filter((expense) => {
    const time = toUtc(expense.date);
    return time > windowStart && time <= today;
  });

  if (recent.length === 0) {
    return { amount: Math.round(monthlyIncome * 0.5), source: 'estimado' };
  }

  const total = recent.reduce((sum, expense) => sum + expense.amount, 0);
  const earliest = Math.min(...recent.map((expense) => toUtc(expense.date)));
  // Si la persona empezó a registrar hace poco, no se divide entre 3 meses.
  const days = Math.max(30, Math.round((today - earliest) / 86_400_000) + 1);
  return { amount: Math.round((total / days) * 30), source: 'gastos' };
}

// ---------- Simulación ----------

interface SimDebt {
  id: string;
  title: string;
  balance: number;
  rate: number;
  minimum: number;
}

interface Simulation {
  months: number | null;
  totalInterest: number;
  schedule: PlanRow[];
  payoffMonth: Map<string, number>;
}

export function activeDebts(debts: DebtRecord[]): DebtRecord[] {
  return debts.filter((debt) => debt.paymentStatus !== 'liquidada' && debt.totalAmount > 0);
}

function orderFor(method: StrategyMethod, list: SimDebt[]): SimDebt[] {
  return [...list].sort((a, b) => (method === 'avalancha'
    ? b.rate - a.rate || a.balance - b.balance
    : a.balance - b.balance || b.rate - a.rate));
}

function simulate(
  debts: DebtRecord[],
  method: StrategyMethod,
  extra: number,
  options: { rollover: boolean; startIso: string; record: boolean }
): Simulation {
  const list: SimDebt[] = activeDebts(debts).map((debt) => ({
    id: debt.id,
    title: debt.title,
    balance: debt.totalAmount,
    rate: debt.annualInterestRate / 100 / 12,
    minimum: Math.max(0, debt.monthlyPayment),
  }));
  const totalMinimums = list.reduce((sum, debt) => sum + debt.minimum, 0);
  const schedule: PlanRow[] = [];
  const payoffMonth = new Map<string, number>();
  let totalInterest = 0;

  for (let month = 1; month <= MAX_PLAN_MONTHS; month += 1) {
    const open = list.filter((debt) => debt.balance > 0.5);
    if (open.length === 0) {
      return { months: month - 1, totalInterest: Math.round(totalInterest), schedule, payoffMonth };
    }

    const interest = new Map<string, number>();
    for (const debt of open) {
      const value = debt.balance * debt.rate;
      debt.balance += value;
      totalInterest += value;
      interest.set(debt.id, value);
    }

    // Con "efecto bola" el presupuesto total se mantiene aunque las deudas terminen.
    let budget = options.rollover
      ? totalMinimums + extra
      : open.reduce((sum, debt) => sum + debt.minimum, 0) + extra;
    const paid = new Map<string, number>();

    for (const debt of open) {
      const pay = Math.min(debt.minimum, debt.balance, budget);
      debt.balance -= pay;
      budget -= pay;
      paid.set(debt.id, pay);
    }
    for (const debt of orderFor(method, open)) {
      if (budget <= 0) break;
      const pay = Math.min(debt.balance, budget);
      debt.balance -= pay;
      budget -= pay;
      paid.set(debt.id, (paid.get(debt.id) ?? 0) + pay);
    }

    for (const debt of open) {
      if (debt.balance <= 0.5) {
        debt.balance = 0;
        if (!payoffMonth.has(debt.id)) payoffMonth.set(debt.id, month);
      }
      if (options.record) {
        schedule.push({
          month: monthLabel(options.startIso, month),
          debtId: debt.id,
          payment: Math.round(paid.get(debt.id) ?? 0),
          interest: Math.round(interest.get(debt.id) ?? 0),
          remaining: Math.round(debt.balance),
        });
      }
    }
  }

  return { months: null, totalInterest: Math.round(totalInterest), schedule, payoffMonth };
}

/** Menor abono extra (múltiplo de $1.000) que termina en `targetMonths` o menos. */
function findRequiredExtra(debts: DebtRecord[], method: StrategyMethod, targetMonths: number): number {
  const fits = (extra: number) => {
    const result = simulate(debts, method, extra, { rollover: true, startIso: '2000-01-01', record: false });
    return result.months !== null && result.months <= targetMonths;
  };
  if (fits(0)) return 0;

  // Con el saldo total como abono extra todo se paga en el primer mes.
  let low = 0;
  let high = roundUp(activeDebts(debts).reduce((sum, debt) => sum + debt.totalAmount * 1.1, 0), 1000);
  while (high - low > 1000) {
    const middle = roundUp((low + high) / 2, 1000);
    if (fits(middle)) high = middle;
    else low = middle;
  }
  return high;
}

// ---------- Plan ----------

export function buildDebtPlan(input: PlanInput): DebtPlan {
  const requested = Number.isFinite(input.targetMonths) ? Math.round(input.targetMonths) : 12;
  const targetMonths = Math.min(120, Math.max(1, requested));
  const monthlyIncome = Math.round(getMonthlyIncome(input.salary));
  const spending = estimateMonthlySpending(input.expenses, monthlyIncome, input.todayIso);
  const open = activeDebts(input.debts);
  const totalMinimums = open.reduce((sum, debt) => sum + Math.max(0, debt.monthlyPayment), 0);
  const extraCapacity = Math.max(0, Math.round(monthlyIncome - spending.amount - totalMinimums));

  const base = {
    method: input.method,
    targetMonths,
    monthlyIncome,
    monthlySpending: spending.amount,
    spendingSource: spending.source,
    totalMinimums,
    extraCapacity,
  };

  if (open.length === 0) {
    return {
      ...base,
      status: 'sin_deudas',
      requiredExtra: 0,
      planExtra: 0,
      months: 0,
      endMonth: null,
      totalInterest: 0,
      baselineMonths: 0,
      baselineInterest: 0,
      interestSaved: 0,
      priorityDebt: null,
      payoffOrder: [],
      stuckDebts: [],
      schedule: [],
    };
  }

  const stuckDebts = open
    .filter((debt) => debt.monthlyPayment <= debt.totalAmount * (debt.annualInterestRate / 100 / 12))
    .map((debt) => debt.title);

  const baseline = simulate(input.debts, input.method, 0, { rollover: false, startIso: input.todayIso, record: false });
  const requiredExtra = findRequiredExtra(input.debts, input.method, targetMonths);
  const reachable = requiredExtra <= extraCapacity;
  const planExtra = reachable ? requiredExtra : extraCapacity;
  const plan = simulate(input.debts, input.method, planExtra, { rollover: true, startIso: input.todayIso, record: true });

  let status: PlanStatus = reachable ? 'alcanzable' : 'inalcanzable';
  if (!reachable && plan.months === null) status = 'sin_capacidad';

  const priority = orderFor(input.method, open.map((debt) => ({
    id: debt.id,
    title: debt.title,
    balance: debt.totalAmount,
    rate: debt.annualInterestRate,
    minimum: debt.monthlyPayment,
  })))[0];

  const payoffOrder: DebtPayoff[] = open
    .map((debt) => {
      const month = plan.payoffMonth.get(debt.id);
      return { debtId: debt.id, title: debt.title, month: month ? monthLabel(input.todayIso, month) : null, n: month ?? Infinity };
    })
    .sort((a, b) => a.n - b.n)
    .map(({ debtId, title, month }) => ({ debtId, title, month }));

  return {
    ...base,
    status,
    requiredExtra,
    planExtra,
    months: plan.months,
    endMonth: plan.months === null ? null : monthLabel(input.todayIso, plan.months),
    totalInterest: plan.totalInterest,
    baselineMonths: baseline.months,
    baselineInterest: baseline.totalInterest,
    interestSaved: baseline.months === null ? 0 : Math.max(0, baseline.totalInterest - plan.totalInterest),
    priorityDebt: priority ? { id: priority.id, title: priority.title } : null,
    payoffOrder,
    stuckDebts,
    schedule: plan.schedule,
  };
}

/** Saldo total de deudas al final de cada mes del plan (para graficar). */
export function remainingByMonth(plan: DebtPlan): { month: string; remaining: number }[] {
  const totals = new Map<string, number>();
  for (const row of plan.schedule) totals.set(row.month, (totals.get(row.month) ?? 0) + row.remaining);
  return [...totals.entries()].map(([month, remaining]) => ({ month, remaining }));
}
