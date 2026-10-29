// Implementación de AgentStore sobre Supabase (Postgres).
// Usa el cliente con service_role: solo existe dentro de la Edge Function.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { DebtRecord } from './finance/finance.ts';
import type { StoredAction } from './agentTypes.ts';
import type { AgentStore, RunLog } from './orchestrator.ts';

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

export function createSupabaseStore(client: SupabaseClient): AgentStore {
  return {
    async listUserIds(onlyUserId) {
      let query = client.from('finance_settings').select('user_id');
      if (onlyUserId) query = query.eq('user_id', onlyUserId);
      const { data, error } = await query;
      if (error) throw new Error(`No se pudieron listar usuarios: ${error.message}`);
      return (data ?? []).map((row: { user_id: string }) => row.user_id);
    },

    async loadDebts(userId) {
      const { data, error } = await client
        .from('debts')
        .select('id, title, category, total_amount, monthly_payment, annual_interest_rate, due_date, payment_status, minimum_payment_only, notes')
        .eq('user_id', userId);
      if (error) throw new Error(`No se pudieron leer las deudas: ${error.message}`);
      return (data ?? []).map((row) => mapDebtRow(row as DebtRow));
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
