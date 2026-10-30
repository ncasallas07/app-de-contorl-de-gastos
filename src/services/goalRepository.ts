import { supabase } from '../lib/supabase';

/** Meta del agente (tabla agent_goals): quedar sin deudas en N meses. */
export interface DebtGoal {
  targetMonths: number;
  active: boolean;
}

/** La RLS solo devuelve la meta del usuario con sesión. null = no ha fijado meta. */
export async function loadDebtGoal(userId: string): Promise<DebtGoal | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('agent_goals')
    .select('target_months,active')
    .eq('user_id', userId)
    .maybeSingle<{ target_months: number; active: boolean }>();

  // Si el proyecto aún no tiene las tablas del agente, se usa la meta por defecto.
  if (error || !data) return null;
  return { targetMonths: data.target_months, active: data.active };
}

export async function saveDebtGoal(userId: string, targetMonths: number): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado.');
  const { error } = await supabase
    .from('agent_goals')
    .upsert({ user_id: userId, target_months: targetMonths, active: true }, { onConflict: 'user_id' });
  if (error) throw new Error('No se pudo guardar la meta. Revisa que supabase/agent.sql esté ejecutado.');
}
