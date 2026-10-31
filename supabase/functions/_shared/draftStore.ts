// Borradores de gastos en Postgres (tabla telegram_drafts). Los usan el bot
// (gastos escritos a mano) y la recepción de avisos de los bancos.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ExpenseCategory } from './finance/finance.ts';
import type { BotDeps, StoredDraft } from './telegramBot.ts';

interface DraftRow {
  id: string;
  title: string;
  amount: number | string;
  category: ExpenseCategory;
  is_ant: boolean;
  suggested_category: ExpenseCategory;
  suggested_ant: boolean;
  confidence: number | string | null;
  edited: boolean;
  source: string | null;
}

const toDraft = (row: DraftRow): StoredDraft => ({
  id: row.id,
  title: row.title,
  amount: Number(row.amount),
  category: row.category,
  isAnt: row.is_ant,
  suggestedCategory: row.suggested_category,
  suggestedAnt: row.suggested_ant,
  confidence: row.confidence === null ? null : Number(row.confidence),
  edited: row.edited,
  source: row.source,
});

const DRAFT_COLUMNS = 'id, title, amount, category, is_ant, suggested_category, suggested_ant, confidence, edited, source';
/** Un borrador sin confirmar vence en un día. */
export const DRAFT_TTL_MS = 86_400_000;

export type DraftStore = Pick<BotDeps, 'createDraft' | 'getDraft' | 'updateDraft' | 'deleteDraft'>;

export function createDraftStore(client: SupabaseClient): DraftStore {
  const since = () => new Date(Date.now() - DRAFT_TTL_MS).toISOString();
  return {
    async createDraft(userId, draft) {
      // De paso se limpian los borradores viejos de esta persona.
      await client.from('telegram_drafts').delete().eq('user_id', userId).lt('created_at', since());
      const { data, error } = await client.from('telegram_drafts').insert({
        user_id: userId,
        title: draft.title,
        amount: draft.amount,
        category: draft.category,
        is_ant: draft.isAnt,
        suggested_category: draft.suggestedCategory,
        suggested_ant: draft.suggestedAnt,
        confidence: draft.confidence,
        edited: draft.edited,
        source: draft.source ?? null,
      }).select('id').single();
      if (error) throw new Error(`No se pudo crear el borrador: ${error.message}`);
      return data.id as string;
    },
    async getDraft(userId, draftId) {
      const { data } = await client.from('telegram_drafts').select(DRAFT_COLUMNS)
        .eq('user_id', userId).eq('id', draftId).gt('created_at', since())
        .maybeSingle<DraftRow>();
      return data ? toDraft(data) : null;
    },
    async updateDraft(userId, draftId, patch) {
      const row: Record<string, unknown> = {};
      if (patch.category !== undefined) row.category = patch.category;
      if (patch.isAnt !== undefined) row.is_ant = patch.isAnt;
      if (patch.edited !== undefined) row.edited = patch.edited;
      const { error } = await client.from('telegram_drafts').update(row).eq('user_id', userId).eq('id', draftId);
      if (error) throw new Error(`No se pudo actualizar el borrador: ${error.message}`);
    },
    async deleteDraft(userId, draftId) {
      await client.from('telegram_drafts').delete().eq('user_id', userId).eq('id', draftId);
    },
  };
}
