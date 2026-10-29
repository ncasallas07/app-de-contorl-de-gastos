import { supabase } from '../lib/supabase';
import {
  ContractType,
  DebtCategory,
  DebtRecord,
  ExpenseCategory,
  ExpenseRecord,
  PayMode,
  SalaryProfile,
  StrategyMethod,
  WorkDayRecord,
  WorkDayType,
  WorkShift,
} from '../types/finance';

export interface FinanceSnapshot {
  salary: SalaryProfile;
  debts: DebtRecord[];
  expenses: ExpenseRecord[];
  workDays: WorkDayRecord[];
  strategyMode: StrategyMethod;
}

/** Estado cargado de la nube junto con su versión (ver state_version en schema.sql). */
export interface LoadedFinanceState extends FinanceSnapshot {
  version: number;
}

/**
 * Otro guardado (por ejemplo, el agente coach financiero) cambió los datos
 * después de que la app los cargó. La app debe recargar en vez de pisarlos.
 */
export class FinanceConflictError extends Error {
  constructor() {
    super('Tus datos se actualizaron desde otro lugar (por ejemplo, el agente). Los recargamos.');
    this.name = 'FinanceConflictError';
  }
}

interface SettingsRow {
  contract_type: ContractType;
  pay_mode: PayMode;
  daily_rate: number;
  hourly_rate: number;
  work_days_per_week: number;
  payment_weekday: number;
  default_shift: WorkShift;
  hours_per_shift: number;
  monthly_salary: number;
  payment_period: SalaryProfile['paymentPeriod'];
  payment_day_of_month: number;
  work_days_per_month_target: number;
  current_balance: number;
  currency: SalaryProfile['currency'];
  strategy_mode: StrategyMethod;
  state_version: number | string;
}

interface ExpenseRow {
  id: string;
  date: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  is_ant_expense: boolean;
  ant_tag: ExpenseRecord['antTag'] | null;
  notes: string | null;
}

interface DebtRow {
  id: string;
  title: string;
  category: DebtCategory;
  total_amount: number;
  monthly_payment: number;
  annual_interest_rate: number;
  due_date: string;
  payment_status: DebtRecord['paymentStatus'];
  minimum_payment_only: boolean;
  notes: string | null;
}

interface WorkDayRow {
  date: string;
  type: WorkDayType;
  shift: WorkShift | null;
  hours_worked: number | null;
  daily_earnings: number | null;
  notes: string | null;
}

function requireClient() {
  if (!supabase) {
    throw new Error('Supabase no está configurado. Revisa las variables VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.');
  }
  return supabase;
}

function friendlyDatabaseError(message: string, code?: string): Error {
  if (code === '42P01' || message.includes('does not exist')) {
    return new Error('Faltan las tablas de FinSmart. Ejecuta supabase/schema.sql en el SQL Editor de Supabase.');
  }
  if (code === '42703' || code === 'PGRST204' || message.includes('contract_type') || message.includes('daily_rate') || message.includes('shift')) {
    return new Error('Faltan las columnas de contrato y jornada. Vuelve a ejecutar supabase/schema.sql completo.');
  }
  if (code === '42883' || code === 'PGRST202' || message.includes('save_finance_state')) {
    return new Error('Falta la función save_finance_state. Vuelve a ejecutar supabase/schema.sql completo.');
  }
  if (code === '42501' || message.toLowerCase().includes('row-level security')) {
    return new Error('Las políticas de seguridad no permiten guardar. Revisa el esquema y la sesión activa.');
  }
  return new Error(message);
}

export async function loadFinanceState(userId: string): Promise<LoadedFinanceState | null> {
  const client = requireClient();

  const [settingsResult, expensesResult, debtsResult, workDaysResult] = await Promise.all([
    client
      .from('finance_settings')
      .select('contract_type,pay_mode,daily_rate,hourly_rate,work_days_per_week,payment_weekday,default_shift,hours_per_shift,monthly_salary,payment_period,payment_day_of_month,work_days_per_month_target,current_balance,currency,strategy_mode,state_version')
      .eq('user_id', userId)
      .maybeSingle<SettingsRow>(),
    client
      .from('expenses')
      .select('id,date,title,category,amount,is_ant_expense,ant_tag,notes')
      .eq('user_id', userId)
      .order('date', { ascending: false }),
    client
      .from('debts')
      .select('id,title,category,total_amount,monthly_payment,annual_interest_rate,due_date,payment_status,minimum_payment_only,notes')
      .eq('user_id', userId)
      .order('due_date', { ascending: true }),
    client
      .from('work_days')
      .select('date,type,shift,hours_worked,daily_earnings,notes')
      .eq('user_id', userId)
      .order('date', { ascending: true }),
  ]);

  const firstError = settingsResult.error || expensesResult.error || debtsResult.error || workDaysResult.error;
  if (firstError) throw friendlyDatabaseError(firstError.message, firstError.code);

  const settings = settingsResult.data;
  if (!settings) return null;

  const salary: SalaryProfile = {
    contractType: settings.contract_type,
    payMode: settings.pay_mode,
    dailyRate: Number(settings.daily_rate),
    hourlyRate: Number(settings.hourly_rate),
    workDaysPerWeek: settings.work_days_per_week,
    paymentWeekday: settings.payment_weekday,
    defaultShift: settings.default_shift,
    hoursPerShift: Number(settings.hours_per_shift),
    monthlySalary: Number(settings.monthly_salary),
    paymentPeriod: settings.payment_period,
    paymentDayOfMonth: settings.payment_day_of_month,
    workDaysPerMonthTarget: settings.work_days_per_month_target,
    currentBalance: Number(settings.current_balance),
    currency: settings.currency,
  };

  const expenses: ExpenseRecord[] = ((expensesResult.data ?? []) as ExpenseRow[]).map((row) => ({
    id: row.id,
    date: row.date,
    title: row.title,
    category: row.category,
    amount: Number(row.amount),
    isAntExpense: row.is_ant_expense,
    antTag: row.ant_tag ?? undefined,
    notes: row.notes ?? undefined,
  }));

  const debts: DebtRecord[] = ((debtsResult.data ?? []) as DebtRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    totalAmount: Number(row.total_amount),
    monthlyPayment: Number(row.monthly_payment),
    annualInterestRate: Number(row.annual_interest_rate),
    dueDate: row.due_date,
    paymentStatus: row.payment_status,
    minimumPaymentOnly: row.minimum_payment_only,
    notes: row.notes ?? undefined,
  }));

  const workDays: WorkDayRecord[] = ((workDaysResult.data ?? []) as WorkDayRow[]).map((row) => ({
    date: row.date,
    type: row.type,
    shift: row.shift ?? undefined,
    hoursWorked: row.hours_worked === null ? undefined : Number(row.hours_worked),
    dailyEarnings: row.daily_earnings === null ? undefined : Number(row.daily_earnings),
    notes: row.notes ?? undefined,
  }));

  return {
    salary,
    debts,
    expenses,
    workDays,
    strategyMode: settings.strategy_mode,
    version: Number(settings.state_version ?? 0),
  };
}

/** Versión actual en la nube, para saber si hay que recargar (null si aún no hay datos). */
export async function fetchStateVersion(userId: string): Promise<number | null> {
  const client = requireClient();
  const { data, error } = await client
    .from('finance_settings')
    .select('state_version')
    .eq('user_id', userId)
    .maybeSingle<{ state_version: number | string }>();
  if (error) throw friendlyDatabaseError(error.message, error.code);
  return data ? Number(data.state_version) : null;
}

/**
 * Guarda todo el estado. Con `expectedVersion` el servidor rechaza el guardado
 * si alguien más guardó después (FinanceConflictError). Devuelve la nueva versión.
 */
export async function saveFinanceState(
  snapshot: FinanceSnapshot,
  expectedVersion: number | null = null
): Promise<number> {
  const client = requireClient();

  const { data, error } = await client.rpc('save_finance_state', {
    p_salary: {
      contract_type: snapshot.salary.contractType,
      pay_mode: snapshot.salary.payMode,
      daily_rate: snapshot.salary.dailyRate,
      hourly_rate: snapshot.salary.hourlyRate,
      work_days_per_week: snapshot.salary.workDaysPerWeek,
      payment_weekday: snapshot.salary.paymentWeekday,
      default_shift: snapshot.salary.defaultShift,
      hours_per_shift: snapshot.salary.hoursPerShift,
      monthly_salary: snapshot.salary.monthlySalary,
      payment_period: snapshot.salary.paymentPeriod,
      payment_day_of_month: snapshot.salary.paymentDayOfMonth,
      work_days_per_month_target: snapshot.salary.workDaysPerMonthTarget,
      current_balance: snapshot.salary.currentBalance,
      currency: snapshot.salary.currency,
      strategy_mode: snapshot.strategyMode,
    },
    p_debts: snapshot.debts.map((debt) => ({
      id: debt.id,
      title: debt.title,
      category: debt.category,
      total_amount: debt.totalAmount,
      monthly_payment: debt.monthlyPayment,
      annual_interest_rate: debt.annualInterestRate,
      due_date: debt.dueDate,
      payment_status: debt.paymentStatus,
      minimum_payment_only: debt.minimumPaymentOnly,
      notes: debt.notes ?? null,
    })),
    p_expenses: snapshot.expenses.map((expense) => ({
      id: expense.id,
      date: expense.date,
      title: expense.title,
      category: expense.category,
      amount: expense.amount,
      is_ant_expense: expense.isAntExpense,
      ant_tag: expense.antTag ?? null,
      notes: expense.notes ?? null,
    })),
    p_work_days: snapshot.workDays.map((workDay) => ({
      date: workDay.date,
      type: workDay.type,
      shift: workDay.shift ?? snapshot.salary.defaultShift,
      hours_worked: workDay.hoursWorked ?? null,
      daily_earnings: workDay.dailyEarnings ?? null,
      notes: workDay.notes ?? null,
    })),
    p_expected_version: expectedVersion,
  });

  if (error) {
    if (error.message.includes('FINSMART_CONFLICT')) throw new FinanceConflictError();
    throw friendlyDatabaseError(error.message, error.code);
  }
  return Number(data ?? 0);
}
