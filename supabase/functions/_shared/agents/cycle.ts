// CAPA 2 · Agente basado en modelo: "Cierre de ciclo".
//
// A diferencia del vigilante, este agente guarda un MODELO INTERNO del mundo
// (tabla agent_state): la última fecha de pago que ya aplicó. Con ese modelo
// y lo que percibe hoy decide:
//   1. Si desde la última vez hubo días de pago → suma la nómina al balance
//      (mensual, quincenal o, en obra o labor, lo ganado en las jornadas
//      registradas de esa semana). Nunca aplica dos veces el mismo pago.
//   2. Si una cuota marcada como "pagado_mes" ya pasó su fecha → la renueva:
//      la fecha avanza un mes y vuelve a quedar "pendiente".
//
// Es una función pura: no toca la base de datos. El orquestador aplica el
// resultado de forma atómica (agent_apply_cycle).

import type { DebtRecord, SalaryProfile, WorkDayRecord } from '../finance/finance.ts';
import { getWorkDayEarnings } from '../finance/contract.ts';
import { type AgentAction, formatCOP } from '../agentTypes.ts';
import { daysBetween } from '../zone.ts';

/** Días hacia atrás que el agente revisa si el cron estuvo apagado. */
export const MAX_CATCH_UP_DAYS = 62;

export interface CycleInput {
  salary: SalaryProfile;
  debts: DebtRecord[];
  workDays: WorkDayRecord[];
  todayIso: string;
  /** Memoria del agente: último día de pago ya aplicado (null = primera vez). */
  lastPaymentApplied: string | null;
}

export interface DebtUpdate {
  id: string;
  dueDate: string;
  paymentStatus: DebtRecord['paymentStatus'];
}

export interface CycleResult {
  balanceDelta: number;
  debtUpdates: DebtUpdate[];
  lastPaymentApplied: string;
  actions: AgentAction[];
}

// ---------- Fechas en formato YYYY-MM-DD (sin zonas horarias) ----------

const parts = (iso: string) => iso.split('-').map(Number) as [number, number, number];

const fromUtc = (date: Date) => date.toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  return fromUtc(new Date(Date.UTC(y, m - 1, d + days)));
}

const lastDayOfMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Mismo día del mes siguiente; si no existe (31 → noviembre), el último día. */
export function addOneMonth(iso: string): string {
  const [y, m, d] = parts(iso);
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  const day = Math.min(d, lastDayOfMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 1 = lunes … 7 = domingo (igual que paymentWeekday en la app). */
function weekday(iso: string): number {
  const [y, m, d] = parts(iso);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

// ---------- Modelo de pagos ----------

export type PayPeriod = 'mensual' | 'quincenal' | 'semanal';

export function payPeriodOf(salary: SalaryProfile): PayPeriod {
  if (salary.contractType === 'obra_labor') return 'semanal';
  return salary.paymentPeriod === 'quincenal' ? 'quincenal' : 'mensual';
}

export function isPayday(salary: SalaryProfile, iso: string): boolean {
  const period = payPeriodOf(salary);
  if (period === 'semanal') return weekday(iso) === salary.paymentWeekday;

  const [y, m, d] = parts(iso);
  const last = lastDayOfMonth(y, m);
  if (period === 'quincenal') return d === 15 || d === last;
  return d === Math.min(Math.max(1, salary.paymentDayOfMonth), last);
}

export function nextPayday(salary: SalaryProfile, afterIso: string): string | null {
  for (let i = 1; i <= 40; i += 1) {
    const candidate = addDays(afterIso, i);
    if (isPayday(salary, candidate)) return candidate;
  }
  return null;
}

/** Cuánto recibe la persona en ese día de pago. */
export function paymentAmount(
  salary: SalaryProfile,
  workDays: WorkDayRecord[],
  paydayIso: string
): number {
  const period = payPeriodOf(salary);
  if (period === 'mensual') return Math.round(salary.monthlySalary);
  if (period === 'quincenal') return Math.round(salary.monthlySalary / 2);

  // Obra o labor: lo ganado en las jornadas de los 7 días que cierran en el pago.
  const from = addDays(paydayIso, -7);
  const earned = workDays
    .filter((day) => day.date > from && day.date <= paydayIso)
    .reduce((sum, day) => sum + (day.dailyEarnings
      ?? getWorkDayEarnings(salary, day.type, day.hoursWorked ?? salary.hoursPerShift)), 0);
  return Math.round(earned);
}

const PERIOD_LABEL: Record<PayPeriod, string> = {
  mensual: 'mensual',
  quincenal: 'quincenal',
  semanal: 'semanal',
};

// ---------- El agente ----------

export function runCycle(input: CycleInput): CycleResult {
  const { salary, debts, workDays, todayIso } = input;
  const actions: AgentAction[] = [];
  let balanceDelta = 0;
  let lastPaymentApplied: string;

  if (!input.lastPaymentApplied) {
    // Primera vez: el balance que el usuario escribió ya es su punto de
    // partida, así que no se suman pagos pasados. Desde hoy empieza a seguirlos.
    lastPaymentApplied = todayIso;
    const next = nextPayday(salary, todayIso);
    actions.push({
      layer: 2,
      kind: 'seguimiento_activado',
      severity: 'info',
      title: 'El agente empezó a seguir tu nómina',
      message: next
        ? `Tu próximo pago ${PERIOD_LABEL[payPeriodOf(salary)]} es el ${next}. Ese día lo sumaré a tu balance.`
        : 'Desde hoy sumaré tus pagos al balance automáticamente.',
      data: { nextPayday: next },
      dedupeKey: 'cycle:start',
      notify: false,
    });
  } else {
    lastPaymentApplied = input.lastPaymentApplied;

    // Revisa los días desde el último pago aplicado hasta hoy (con tope).
    const earliest = addDays(todayIso, -MAX_CATCH_UP_DAYS);
    let day = addDays(input.lastPaymentApplied, 1);
    if (day < earliest) day = earliest;

    for (; day <= todayIso; day = addDays(day, 1)) {
      if (!isPayday(salary, day)) continue;
      const amount = paymentAmount(salary, workDays, day);
      const period = PERIOD_LABEL[payPeriodOf(salary)];

      if (amount > 0) {
        balanceDelta += amount;
        actions.push({
          layer: 2,
          kind: 'pago_aplicado',
          severity: 'positiva',
          title: `Pago ${period} sumado: +${formatCOP(amount)}`,
          message: `El ${day} es tu día de pago, así que sumé ${formatCOP(amount)} a tu balance.`,
          data: { payday: day, amount, period },
          dedupeKey: `cycle:pay:${day}`,
          notify: false,
        });
      } else {
        actions.push({
          layer: 2,
          kind: 'pago_sin_jornadas',
          severity: 'moderada',
          title: 'Día de pago sin jornadas registradas',
          message: `El ${day} es tu día de pago, pero no hay jornadas registradas en los 7 días anteriores. `
            + 'Márcalas en la Agenda para que el agente sume lo ganado.',
          data: { payday: day, amount: 0, period },
          dedupeKey: `cycle:pay:${day}`,
          notify: false,
        });
      }
    }

    // La memoria solo avanza (simular una fecha pasada no la retrocede).
    if (todayIso > lastPaymentApplied) lastPaymentApplied = todayIso;
  }

  // Renovar cuotas ya pagadas cuya fecha pasó.
  const debtUpdates: DebtUpdate[] = [];
  for (const debt of debts) {
    if (debt.paymentStatus !== 'pagado_mes' || debt.totalAmount <= 0) continue;
    if (daysBetween(todayIso, debt.dueDate) >= 0) continue;

    const nextDue = addOneMonth(debt.dueDate);
    debtUpdates.push({ id: debt.id, dueDate: nextDue, paymentStatus: 'pendiente' });
    actions.push({
      layer: 2,
      kind: 'cuota_renovada',
      severity: 'info',
      title: `${debt.title}: nueva cuota pendiente`,
      message: `La cuota anterior ya estaba pagada. La siguiente vence el ${nextDue}.`,
      data: { debtId: debt.id, previousDueDate: debt.dueDate, dueDate: nextDue },
      dedupeKey: `cycle:roll:${debt.id}:${debt.dueDate}`,
      notify: false,
    });
  }

  return { balanceDelta, debtUpdates, lastPaymentApplied, actions };
}

/** Aplica las renovaciones a la lista en memoria (para que el vigilante vea el estado nuevo). */
export function applyDebtUpdates(debts: DebtRecord[], updates: DebtUpdate[]): DebtRecord[] {
  if (updates.length === 0) return debts;
  const byId = new Map(updates.map((update) => [update.id, update]));
  return debts.map((debt) => {
    const update = byId.get(debt.id);
    return update ? { ...debt, dueDate: update.dueDate, paymentStatus: update.paymentStatus } : debt;
  });
}
