import { supabase } from '../lib/supabase';

/** Meta del agente (tabla agent_goals): quedar sin deudas en N meses. */
export interface DebtGoal {
  targetMonths: number;
  active: boolean;
  /** Colchón de emergencia que se quiere tener (0 = un mes de gastos y cuotas). */
  emergencyFundMin: number;
}

/** La RLS solo devuelve la meta del usuario con sesión. null = no ha fijado meta. */
export async function loadDebtGoal(userId: string): Promise<DebtGoal | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('agent_goals')
    .select('target_months,active,emergency_fund_min')
    .eq('user_id', userId)
    .maybeSingle<{ target_months: number; active: boolean; emergency_fund_min: number | string }>();

  // Si el proyecto aún no tiene las tablas del agente, se usa la meta por defecto.
  if (error || !data) return null;
  return {
    targetMonths: Number.isFinite(Number(data.target_months)) ? Number(data.target_months) : 12,
    active: data.active,
    emergencyFundMin: Number(data.emergency_fund_min ?? 0),
  };
}

export async function saveDebtGoal(userId: string, targetMonths: number): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado.');
  const { error } = await supabase
    .from('agent_goals')
    .upsert({ user_id: userId, target_months: targetMonths, active: true }, { onConflict: 'user_id' });
  if (error) throw new Error('No se pudo guardar la meta. Revisa que supabase/agent.sql esté ejecutado.');
}

/** Guarda solo el colchón; si aún no hay meta, se crea con la meta por defecto. */
export async function saveEmergencyFund(userId: string, amount: number): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado.');
  const { error } = await supabase
    .from('agent_goals')
    .upsert({ user_id: userId, emergency_fund_min: amount }, { onConflict: 'user_id' });
  if (error) throw new Error('No se pudo guardar el colchón. Revisa que supabase/agent.sql esté ejecutado.');
}
