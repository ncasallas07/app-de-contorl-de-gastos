import { supabase } from '../lib/supabase';

export type AgentSeverity = 'urgente' | 'alta' | 'moderada' | 'positiva' | 'info';

/** Una acción que el agente coach financiero registró (tabla agent_actions). */
export interface AgentInboxItem {
  id: string;
  layer: number;
  kind: string;
  severity: AgentSeverity;
  title: string;
  message: string;
  createdAt: string;
}

interface AgentActionRow {
  id: string;
  layer: number;
  kind: string;
  severity: AgentSeverity;
  title: string;
  message: string;
  created_at: string;
}

/** Alertas sin leer, de la más reciente a la más antigua. La RLS solo devuelve las del usuario. */
export async function loadAgentInbox(limit = 6): Promise<AgentInboxItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('agent_actions')
    .select('id,layer,kind,severity,title,message,created_at')
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  // Si el proyecto aún no tiene las tablas del agente, la bandeja simplemente no aparece.
  if (error) return [];

  return ((data ?? []) as AgentActionRow[]).map((row) => ({
    id: row.id,
    layer: row.layer,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    message: row.message,
    createdAt: row.created_at,
  }));
}

export async function markAgentActionsRead(ids: string[]): Promise<void> {
  if (!supabase || ids.length === 0) return;
  const { error } = await supabase
    .from('agent_actions')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw new Error('No se pudo marcar la alerta como leída.');
}
