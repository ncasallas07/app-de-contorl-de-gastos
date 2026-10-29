import { ContractType, PayMode, SalaryProfile, WorkShift } from '../../types/finance';
import { getMonthlyTargetFromWeekly } from '../../utils/contract';

export interface ContractFormState {
  contractType: ContractType;
  payMode: PayMode;
  monthlySalary: string;
  dailyRate: string;
  hourlyRate: string;
  workDaysPerWeek: string;
  paymentWeekday: string;
  defaultShift: WorkShift;
  hoursPerShift: string;
  paymentPeriod: 'mensual' | 'quincenal';
  paymentDayOfMonth: string;
  workDaysPerMonthTarget: string;
  currentBalance: string;
}

export function createContractFormState(salary: Partial<SalaryProfile>): ContractFormState {
  const monthlySalary = salary.monthlySalary ?? 0;
  const workDays = salary.workDaysPerMonthTarget ?? 22;
  const hours = salary.hoursPerShift ?? 8;

  return {
    contractType: salary.contractType ?? 'indefinido',
    payMode: salary.payMode ?? 'mensual',
    monthlySalary: String(monthlySalary || ''),
    dailyRate: String(salary.dailyRate || (monthlySalary > 0 ? Math.round(monthlySalary / workDays) : '') || ''),
    hourlyRate: String(salary.hourlyRate || (monthlySalary > 0 ? Math.round(monthlySalary / workDays / hours) : '') || ''),
    workDaysPerWeek: String(salary.workDaysPerWeek ?? 5),
    paymentWeekday: String(salary.paymentWeekday ?? 5),
    defaultShift: salary.defaultShift ?? 'diurno',
    hoursPerShift: String(salary.hoursPerShift ?? 8),
    paymentPeriod: salary.paymentPeriod === 'quincenal' ? 'quincenal' : 'mensual',
    paymentDayOfMonth: String(salary.paymentDayOfMonth ?? 28),
    workDaysPerMonthTarget: String(salary.workDaysPerMonthTarget ?? 22),
    currentBalance: String(salary.currentBalance ?? 0),
  };
}

export function parseContractForm(values: ContractFormState): { data?: Partial<SalaryProfile>; error?: string } {
  const balance = Number(values.currentBalance || 0);
  if (!Number.isFinite(balance) || balance < 0) {
    return { error: 'El balance actual no puede ser negativo.' };
  }

  const hoursPerShift = Number(values.hoursPerShift);
  if (!Number.isFinite(hoursPerShift) || hoursPerShift <= 0 || hoursPerShift > 24) {
    return { error: 'Las horas por jornada deben estar entre 0.5 y 24.' };
  }

  const workDaysPerWeek = Number(values.workDaysPerWeek);
  if (!Number.isInteger(workDaysPerWeek) || workDaysPerWeek < 1 || workDaysPerWeek > 7) {
    return { error: 'Los días por semana deben estar entre 1 y 7.' };
  }

  const paymentWeekday = Number(values.paymentWeekday);
  const defaultShift: WorkShift = values.defaultShift ?? 'diurno';

  if (values.contractType === 'indefinido') {
    const monthlySalary = Number(values.monthlySalary);
    if (!Number.isFinite(monthlySalary) || monthlySalary <= 0) {
      return { error: 'El salario mensual debe ser mayor que cero.' };
    }

    const isQuincenal = values.paymentPeriod === 'quincenal';
    // En quincenal se paga el 15 y el último día del mes; se guarda 30 como referencia.
    const paymentDay = isQuincenal ? 30 : Number(values.paymentDayOfMonth);
    if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31) {
      return { error: 'El día de pago debe estar entre 1 y 31.' };
    }

    const workDaysTarget = Number(values.workDaysPerMonthTarget);
    if (!Number.isInteger(workDaysTarget) || workDaysTarget < 1 || workDaysTarget > 31) {
      return { error: 'La meta de días laborables debe estar entre 1 y 31.' };
    }

    const dailyRate = monthlySalary / workDaysTarget;

    return {
      data: {
        contractType: 'indefinido',
        payMode: 'mensual',
        monthlySalary,
        dailyRate,
        hourlyRate: dailyRate / hoursPerShift,
        workDaysPerWeek,
        paymentWeekday: 5,
        defaultShift,
        hoursPerShift,
        paymentPeriod: isQuincenal ? 'quincenal' : 'mensual',
        paymentDayOfMonth: paymentDay,
        workDaysPerMonthTarget: workDaysTarget,
        currentBalance: balance,
      },
    };
  }

  if (!Number.isInteger(paymentWeekday) || paymentWeekday < 1 || paymentWeekday > 7) {
    return { error: 'El día de pago semanal debe estar entre lunes y domingo.' };
  }

  const payMode: PayMode = values.payMode === 'hora' ? 'hora' : 'dia';
  const rawRate = Number(payMode === 'hora' ? values.hourlyRate : values.dailyRate);
  if (!Number.isFinite(rawRate) || rawRate <= 0) {
    return {
      error: payMode === 'hora'
        ? 'El valor por hora debe ser mayor que cero.'
        : 'La tarifa diaria debe ser mayor que cero.',
    };
  }

  const workDaysPerMonthTarget = getMonthlyTargetFromWeekly(workDaysPerWeek);
  const dailyRate = payMode === 'hora' ? rawRate * hoursPerShift : rawRate;
  const hourlyRate = payMode === 'hora' ? rawRate : rawRate / hoursPerShift;

  return {
    data: {
      contractType: 'obra_labor',
      payMode,
      monthlySalary: dailyRate * workDaysPerMonthTarget,
      dailyRate,
      hourlyRate,
      workDaysPerWeek,
      paymentWeekday,
      defaultShift,
      hoursPerShift,
      paymentPeriod: 'semanal',
      paymentDayOfMonth: 28,
      workDaysPerMonthTarget,
      currentBalance: balance,
    },
  };
}
