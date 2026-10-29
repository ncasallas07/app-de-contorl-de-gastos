import { SalaryProfile, WorkDayType, WorkShift } from '../types/finance';
import { parseLocalDate, startOfDay, toIsoDate } from './date';

export const CONTRACT_TYPE_LABELS = {
  indefinido: 'Término indefinido',
  obra_labor: 'Obra o labor',
} as const;

export const PAY_MODE_LABELS = {
  mensual: 'Mensual',
  dia: 'Por día',
  hora: 'Por hora',
} as const;

export const SHIFT_LABELS = {
  diurno: 'Diurno',
  nocturno: 'Nocturno',
  mixto: 'Mixto',
} as const;

export const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' },
];

export function getMonthlyIncome(salary: SalaryProfile): number {
  if (salary.contractType === 'indefinido') return salary.monthlySalary;

  if (salary.payMode === 'hora') {
    return salary.hourlyRate * salary.hoursPerShift * salary.workDaysPerMonthTarget;
  }

  return salary.dailyRate * salary.workDaysPerMonthTarget;
}

export function getWorkDayEarnings(
  salary: SalaryProfile,
  type: WorkDayType,
  hoursWorked = salary.hoursPerShift
): number {
  if (type === 'descanso') return 0;

  if (salary.contractType === 'obra_labor') {
    if (salary.payMode === 'hora') {
      return salary.hourlyRate * hoursWorked;
    }

    return type === 'medio_dia' ? salary.dailyRate / 2 : salary.dailyRate;
  }

  const base = salary.monthlySalary / Math.max(1, salary.workDaysPerMonthTarget);
  return type === 'medio_dia' ? base / 2 : base;
}

export function getDailyEarningReference(salary: SalaryProfile): number {
  if (salary.contractType === 'obra_labor') {
    return salary.payMode === 'hora'
      ? salary.hourlyRate * salary.hoursPerShift
      : salary.dailyRate;
  }

  return salary.monthlySalary / Math.max(1, salary.workDaysPerMonthTarget);
}

export function getWeeklyTarget(salary: SalaryProfile): number {
  if (salary.contractType === 'obra_labor') {
    return getDailyEarningReference(salary) * Math.max(1, salary.workDaysPerWeek);
  }

  return getDailyEarningReference(salary) * Math.max(1, salary.workDaysPerWeek);
}

export function getMonthlyTargetFromWeekly(daysPerWeek: number): number {
  return Math.max(1, Math.round(daysPerWeek * 52 / 12));
}

export function getWeekRange(base: Date = new Date()) {
  const start = startOfDay(base);
  const jsWeekday = start.getDay();
  const offset = jsWeekday === 0 ? -6 : 1 - jsWeekday;
  start.setDate(start.getDate() + offset);

  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return {
    start,
    end,
    startIso: toIsoDate(start),
    endIso: toIsoDate(end),
    days: Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(day.getDate() + index);
      return day;
    }),
  };
}

/** Fechas de pago quincenal de un mes: el 15 y el último día (a mediodía, hora local). */
export function getQuincenalPaymentDates(year: number, monthIndex: number): Date[] {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return [new Date(year, monthIndex, 15, 12), new Date(year, monthIndex, lastDay, 12)];
}

/** Cuántos pagos recibe la persona en un mes típico. */
export function getPaymentsPerMonth(salary: SalaryProfile): number {
  if (salary.contractType === 'obra_labor') return 52 / 12;
  return salary.paymentPeriod === 'quincenal' ? 2 : 1;
}

export function getNextPaymentDate(salary: SalaryProfile, from: Date = new Date()): Date {
  const base = startOfDay(from);

  if (salary.contractType === 'obra_labor') {
    const target = salary.paymentWeekday % 7;
    const next = new Date(base);
    const diff = (target - next.getDay() + 7) % 7;
    next.setDate(next.getDate() + diff);
    return next;
  }

  if (salary.paymentPeriod === 'quincenal') {
    // Quincenal: se paga el día 15 y el último día de cada mes.
    for (let monthOffset = 0; monthOffset < 2; monthOffset += 1) {
      for (const date of getQuincenalPaymentDates(base.getFullYear(), base.getMonth() + monthOffset)) {
        if (date >= base) return date;
      }
    }
  }

  const day = Math.max(1, Math.min(31, salary.paymentDayOfMonth));
  const next = new Date(base.getFullYear(), base.getMonth(), 1, 12);
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));

  if (next < base) {
    const nextMonth = new Date(base.getFullYear(), base.getMonth() + 1, 1, 12);
    const nextMonthLastDay = new Date(base.getFullYear(), base.getMonth() + 2, 0).getDate();
    nextMonth.setDate(Math.min(day, nextMonthLastDay));
    return nextMonth;
  }

  return next;
}

export function getShiftLabel(shift: WorkShift | undefined, fallback: WorkShift = 'diurno'): string {
  return SHIFT_LABELS[shift ?? fallback];
}

export function getWorkDayRateLabel(salary: SalaryProfile): string {
  if (salary.contractType !== 'obra_labor') return 'Tarifa diaria';
  return salary.payMode === 'hora' ? 'Valor por hora' : 'Tarifa diaria';
}

export function getWorkDayRate(salary: SalaryProfile): number {
  if (salary.contractType === 'obra_labor') {
    return salary.payMode === 'hora' ? salary.hourlyRate : salary.dailyRate;
  }

  return getDailyEarningReference(salary);
}

export function getWorkdayHours(recordHours: number | undefined, salary: SalaryProfile): number {
  return recordHours ?? salary.hoursPerShift;
}

export function getWeekdayLabel(weekday: number): string {
  return WEEKDAY_OPTIONS.find((option) => option.value === weekday)?.label ?? 'Lunes';
}

export function getPaymentDescription(salary: SalaryProfile): string {
  if (salary.contractType === 'obra_labor') {
    return `Semanal · ${getWeekdayLabel(salary.paymentWeekday)}`;
  }

  if (salary.paymentPeriod === 'quincenal') {
    return 'Quincenal · días 15 y último del mes';
  }

  return `Mensual · día ${salary.paymentDayOfMonth}`;
}

export function getWeekExpenses(expenses: { date: string; amount: number }[], startIso: string, endIso: string): number {
  return expenses
    .filter((expense) => expense.date >= startIso && expense.date <= endIso)
    .reduce((sum, expense) => sum + expense.amount, 0);
}

export function formatWeekRange(start: Date, end: Date): string {
  const startLabel = start.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const endLabel = end.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return `${startLabel} — ${endLabel}`;
}

export function getWeekdayFromIso(isoDate: string): number {
  const day = parseLocalDate(isoDate).getDay();
  return day === 0 ? 7 : day;
}
