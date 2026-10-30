import { supabase } from '../lib/supabase';
import type { ExpenseCategory } from '../types/finance';
import type { FeedbackRecord } from '../utils/antLearner';

interface FeedbackRow {
  concept: string;
  suggested_category: ExpenseCategory | null;
  final_category: ExpenseCategory;
  suggested_ant: boolean | null;
  final_ant: boolean;
  created_at: string;
}

/** Correcciones del usuario a las sugerencias del detector (tabla agent_feedback). */
export async function loadFeedback(limit = 500): Promise<FeedbackRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('agent_feedback')
    .select('concept,suggested_category,final_category,suggested_ant,final_ant,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  // Sin las tablas del agente el detector funciona solo con los gastos.
  if (error) return [];

  return ((data ?? []) as FeedbackRow[]).map((row) => ({
    concept: row.concept,
    suggestedCategory: row.suggested_category,
    finalCategory: row.final_category,
    suggestedAnt: row.suggested_ant,
    finalAnt: row.final_ant,
    createdAt: row.created_at,
  }));
}

export async function saveFeedback(userId: string, row: FeedbackRecord): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('agent_feedback').insert({
    user_id: userId,
    concept: row.concept.trim().slice(0, 200),
    suggested_category: row.suggestedCategory,
    final_category: row.finalCategory,
    suggested_ant: row.suggestedAnt,
    final_ant: row.finalAnt,
  });
  if (error) throw new Error('No se pudo guardar la corrección para el detector.');
}
