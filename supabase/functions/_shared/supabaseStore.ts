// Implementación de AgentStore sobre Supabase (Postgres).
// Usa el cliente con service_role: solo existe dentro de la Edge Function.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type {
  DebtRecord,
  ExpenseCategory,
  SalaryProfile,
  StrategyMethod,
  WorkDayRecord,
} from './finance/finance.ts';
import type { StoredAction } from './agentTypes.ts';
import type { AgentStore, RunLog, UserState } from './orchestrator.ts';

interface DebtRow {
  id: string;
  title: string;
  category: DebtRecord['category'];
  total_amount: number | string;
  monthly_payment: number | string;
  annual_interest_rate: number | string;
  due_date: string;
  payment_status: DebtRecord['paymentStatus'];
  minimum_payment_only: boolean;
  notes: string | null;
}

// Postgres devuelve numeric como texto.
const num = (value: number | string | null | undefined) => Number(value ?? 0);

export function mapDebtRow(row: DebtRow): DebtRecord {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    totalAmount: num(row.total_amount),
    monthlyPayment: num(row.monthly_payment),
    annualInterestRate: num(row.annual_interest_rate),
    dueDate: row.due_date,
    paymentStatus: row.payment_status,
    minimumPaymentOnly: row.minimum_payment_only,
    notes: row.notes ?? undefined,
  };
}

interface SettingsRow {
  contract_type: SalaryProfile['contractType'];
  pay_mode: SalaryProfile['payMode'];
  daily_rate: number | string;
  hourly_rate: number | string;
  work_days_per_week: number;
  payment_weekday: number;
  default_shift: SalaryProfile['defaultShift'];
  hours_per_shift: number | string;
  monthly_salary: number | string;
  payment_period: SalaryProfile['paymentPeriod'];
  payment_day_of_month: number;
  work_days_per_month_target: number;
  current_balance: number | string;
  strategy_mode: StrategyMethod;
  state_version: number | string;
}

interface WorkDayRow {
  date: string;
  type: WorkDayRecord['type'];
  shift: WorkDayRecord['shift'] | null;
  hours_worked: number | string | null;
  daily_earnings: number | string | null;
}

interface ExpenseRow {
  id: string;
  date: string;
  amount: number | string;
  title: string;
  category: ExpenseCategory;
  is_ant_expense: boolean;
}

interface FeedbackRow {
  concept: string;
  suggested_category: ExpenseCategory | null;
  final_category: ExpenseCategory;
  suggested_ant: boolean | null;
  final_ant: boolean;
  created_at: string;
}

export function mapSettingsRow(row: SettingsRow): SalaryProfile {
  return {
    contractType: row.contract_type,
    payMode: row.pay_mode,
    monthlySalary: num(row.monthly_salary),
    dailyRate: num(row.daily_rate),
    hourlyRate: num(row.hourly_rate),
    workDaysPerWeek: row.work_days_per_week,
    paymentWeekday: row.payment_weekday,
    defaultShift: row.default_shift,
    hoursPerShift: num(row.hours_per_shift),
    paymentPeriod: row.payment_period,
    paymentDayOfMonth: row.payment_day_of_month,
    workDaysPerMonthTarget: row.work_days_per_month_target,
    currentBalance: num(row.current_balance),
    currency: 'COP',
  };
}

export function mapWorkDayRow(row: WorkDayRow): WorkDayRecord {
  return {
    date: row.date,
    type: row.type,
    shift: row.shift ?? undefined,
    hoursWorked: row.hours_worked === null ? undefined : num(row.hours_worked),
    dailyEarnings: row.daily_earnings === null ? undefined : num(row.daily_earnings),
  };
}

export function createSupabaseStore(client: SupabaseClient): AgentStore {
  return {
    async listUserIds(onlyUserId) {
      let query = client.from('finance_settings').select('user_id');
      if (onlyUserId) query = query.eq('user_id', onlyUserId);
      const { data, error } = await query;
      if (error) throw new Error(`No se pudieron listar usuarios: ${error.message}`);
      return (data ?? []).map((row: { user_id: string }) => row.user_id);
    },

    async loadUserState(userId): Promise<UserState> {
      const since = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
      const [settings, debts, workDays, agentState, expenses, goal, feedback] = await Promise.all([
        client.from('finance_settings')
          .select('contract_type, pay_mode, daily_rate, hourly_rate, work_days_per_week, payment_weekday, default_shift, hours_per_shift, monthly_salary, payment_period, payment_day_of_month, work_days_per_month_target, current_balance, strategy_mode, state_version')
          .eq('user_id', userId)
          .single(),
        client.from('debts')
          .select('id, title, category, total_amount, monthly_payment, annual_interest_rate, due_date, payment_status, minimum_payment_only, notes')
          .eq('user_id', userId),
        // Las jornadas solo importan para pagos recientes (obra o labor).
        client.from('work_days')
          .select('date, type, shift, hours_worked, daily_earnings')
          .eq('user_id', userId)
          .gte('date', since),
        client.from('agent_state')
          .select('last_payment_applied')
          .eq('user_id', userId)
          .maybeSingle(),
        // Gasto mensual (capa 3) y entrenamiento del detector (capa 5).
        client.from('expenses')
          .select('id, date, amount, title, category, is_ant_expense')
          .eq('user_id', userId)
          .gte('date', since),
        client.from('agent_goals')
          .select('target_months, active, emergency_fund_min')
          .eq('user_id', userId)
          .maybeSingle(),
        client.from('agent_feedback')
          .select('concept, suggested_category, final_category, suggested_ant, final_ant, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(500),
      ]);

      const failed = [settings, debts, workDays, agentState, expenses, goal, feedback].find((result) => result.error);
      if (failed?.error) throw new Error(`No se pudieron leer los datos: ${failed.error.message}`);

      const settingsRow = settings.data as SettingsRow;
      return {
        salary: mapSettingsRow(settingsRow),
        debts: (debts.data ?? []).map((row) => mapDebtRow(row as DebtRow)),
        workDays: (workDays.data ?? []).map((row) => mapWorkDayRow(row as WorkDayRow)),
        expenses: (expenses.data ?? []).map((row: ExpenseRow) => ({
          id: row.id,
          date: row.date,
          amount: num(row.amount),
          title: row.title,
          category: row.category,
          isAntExpense: row.is_ant_expense,
        })),
        feedback: (feedback.data ?? []).map((row: FeedbackRow) => ({
          concept: row.concept,
          suggestedCategory: row.suggested_category,
          finalCategory: row.final_category,
          suggestedAnt: row.suggested_ant,
          finalAnt: row.final_ant,
          createdAt: row.created_at,
        })),
        strategyMode: settingsRow.strategy_mode === 'bola_de_nieve' ? 'bola_de_nieve' : 'avalancha',
        goal: goal.data
          ? {
            targetMonths: (goal.data as { target_months: number }).target_months,
            active: (goal.data as { active: boolean }).active,
            emergencyFundMin: num((goal.data as { emergency_fund_min: number | string }).emergency_fund_min),
          }
          : null,
        stateVersion: num(settingsRow.state_version),
        lastPaymentApplied: (agentState.data as { last_payment_applied: string | null } | null)
          ?.last_payment_applied ?? null,
      };
    },

    async applyCycle(userId, commit) {
      const { data, error } = await client.rpc('agent_apply_cycle', {
        p_user_id: userId,
        p_expected_version: commit.expectedVersion,
        p_balance_delta: commit.balanceDelta,
        p_debt_updates: commit.debtUpdates.map((update) => ({
          id: update.id,
          due_date: update.dueDate,
          payment_status: update.paymentStatus,
        })),
        p_last_payment_applied: commit.lastPaymentApplied,
        p_run_date: commit.runDate,
      });
      if (error) throw new Error(`No se pudo aplicar el ciclo: ${error.message}`);
      return data === null ? null : num(data as number | string);
    },

    async replacePlan(userId, rows) {
      const { error } = await client.rpc('agent_replace_plan', {
        p_user_id: userId,
        p_rows: rows.map((row) => ({
          month: row.month,
          debt_id: row.debtId,
          payment: row.payment,
          interest: row.interest,
          remaining: row.remaining,
        })),
      });
      if (error) throw new Error(`No se pudo guardar el plan: ${error.message}`);
    },

    async saveActions(userId, actions) {
      if (actions.length === 0) return [];
      const rows = actions.map((action) => ({
        user_id: userId,
        layer: action.layer,
        kind: action.kind,
        severity: action.severity,
        title: action.title,
        message: action.message,
        data: action.data,
        dedupe_key: action.dedupeKey,
      }));
      // ON CONFLICT DO NOTHING: Postgres solo devuelve las filas nuevas.
      const { data, error } = await client
        .from('agent_actions')
        .upsert(rows, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
        .select('id, dedupe_key');
      if (error) throw new Error(`No se pudieron guardar las acciones: ${error.message}`);

      const byKey = new Map(actions.map((action) => [action.dedupeKey, action]));
      return (data ?? []).flatMap((row: { id: string; dedupe_key: string }): StoredAction[] => {
        const action = byKey.get(row.dedupe_key);
        return action ? [{ ...action, id: row.id }] : [];
      });
    },

    async markEmailed(actionIds) {
      if (actionIds.length === 0) return;
      const { error } = await client
        .from('agent_actions')
        .update({ emailed_at: new Date().toISOString() })
        .in('id', actionIds);
      if (error) throw new Error(`No se pudo marcar el envío: ${error.message}`);
    },

    async getUserEmail(userId) {
      const { data, error } = await client.auth.admin.getUserById(userId);
      if (error) return null;
      return data.user?.email ?? null;
    },

    async logRun(entry: RunLog) {
      const { error } = await client.from('agent_runs').insert({
        user_id: entry.userId,
        run_date: entry.runDate,
        layers: entry.layers,
        actions_created: entry.actionsCreated,
        emails_sent: entry.emailsSent,
        status: entry.status,
        error: entry.error ?? null,
      });
      if (error) throw new Error(`No se pudo registrar la ejecución: ${error.message}`);
    },
  };
}
