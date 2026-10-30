// Edge Function `telegram-bot`: el bot de Telegram de FinSmart.
//
// Dos tipos de llamada:
//   1. Telegram (webhook): trae el encabezado X-Telegram-Bot-Api-Secret-Token,
//      que debe coincidir con el secreto guardado en Vault (telegram.sql).
//   2. Administración desde el SQL Editor (telegram_setup / telegram_test):
//      trae x-agent-secret, igual que el agente diario.
//
// Se despliega con --no-verify-jwt porque Telegram no envía un JWT de Supabase;
// la protección son esos dos secretos.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { isAuthorized, safeEqual } from '../_shared/auth.ts';
import { createTelegramApi, type TelegramApi } from '../_shared/telegram.ts';
import {
  type BotDeps,
  handleUpdate,
  type LinkResult,
  type StoredDraft,
  type TelegramUpdate,
} from '../_shared/telegramBot.ts';
import { createSupabaseStore } from '../_shared/supabaseStore.ts';
import { todayInZone } from '../_shared/zone.ts';
import type { ExpenseCategory } from '../_shared/finance/finance.ts';

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
});

const DRAFT_COLUMNS = 'id, title, amount, category, is_ant, suggested_category, suggested_ant, confidence, edited';
const DRAFT_TTL_MS = 86_400_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function botDeps(client: SupabaseClient, telegram: TelegramApi): BotDeps {
  return {
    async findUserByChat(chatId) {
      const { data } = await client
        .from('telegram_links')
        .select('user_id')
        .eq('chat_id', chatId)
        .maybeSingle();
      return (data?.user_id as string | undefined) ?? null;
    },
    async linkWithCode(code, chatId, username): Promise<LinkResult> {
      const { data, error } = await client.rpc('telegram_consume_code', {
        p_code: code,
        p_chat_id: chatId,
        p_username: username,
      });
      if (error) throw new Error(`No se pudo vincular: ${error.message}`);
      if (data === 'ok') return { ok: true };
      return { ok: false, reason: data === 'chat_de_otra_cuenta' ? 'chat_de_otra_cuenta' : 'codigo_invalido' };
    },
    async unlink(chatId) {
      const { error } = await client.from('telegram_links').delete().eq('chat_id', chatId);
      if (error) throw new Error(`No se pudo desvincular: ${error.message}`);
    },
    reply: (chatId, text, keyboard) => telegram.sendMessage(chatId, text, { keyboard }),
    edit: (chatId, messageId, text, keyboard) => telegram.editMessage(chatId, messageId, text, keyboard),
    answer: (callbackId, text) => telegram.answerCallback(callbackId, text),
    today: () => todayInZone(),
    loadState: (userId) => createSupabaseStore(client).loadUserState(userId),

    async createDraft(userId, draft) {
      // De paso se limpian los borradores viejos de esta persona.
      await client.from('telegram_drafts').delete().eq('user_id', userId)
        .lt('created_at', new Date(Date.now() - DRAFT_TTL_MS).toISOString());
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
      }).select('id').single();
      if (error) throw new Error(`No se pudo crear el borrador: ${error.message}`);
      return data.id as string;
    },
    async getDraft(userId, draftId) {
      const { data } = await client.from('telegram_drafts').select(DRAFT_COLUMNS)
        .eq('user_id', userId).eq('id', draftId)
        .gt('created_at', new Date(Date.now() - DRAFT_TTL_MS).toISOString())
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
    async saveDraft(userId, draftId, expenseId, date) {
      const { data, error } = await client.rpc('telegram_save_draft', {
        p_user_id: userId,
        p_draft_id: draftId,
        p_expense_id: expenseId,
        p_date: date,
      });
      if (error) throw new Error(`No se pudo guardar el gasto: ${error.message}`);
      if (!data) return null;
      return {
        expenseId: data.expense_id,
        title: data.title,
        amount: Number(data.amount),
        category: data.category,
        isAnt: data.is_ant,
        balance: Number(data.balance),
      };
    },
    async undoExpense(userId, expenseId) {
      const { data, error } = await client.rpc('telegram_undo_expense', {
        p_user_id: userId,
        p_expense_id: expenseId,
      });
      if (error) throw new Error(`No se pudo deshacer: ${error.message}`);
      return data === null ? null : Number(data);
    },
    newExpenseId: () => `tg-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
  };
}

async function admin(action: unknown, client: SupabaseClient, telegram: TelegramApi) {
  if (action === 'setup') {
    const me = await telegram.call<{ username: string }>('getMe', {});
    const { data: secret, error } = await client.rpc('telegram_webhook_secret');
    if (error || typeof secret !== 'string') {
      return json({ error: 'Falta el secreto del webhook: ejecuta supabase/telegram.sql' }, 500);
    }
    await telegram.call('setWebhook', {
      url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-bot`,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    });
    await telegram.call('setMyCommands', {
      commands: [
        { command: 'resumen', description: 'Saldo, próximo pago y gastos del mes' },
        { command: 'deudas', description: 'Tus deudas y vencimientos' },
        { command: 'plan', description: 'Tu plan para quedar sin deudas' },
        { command: 'gasto', description: 'Registrar un gasto (ej: tinto 3500)' },
        { command: 'ayuda', description: 'Ver qué puedo hacer' },
        { command: 'desvincular', description: 'Dejar de recibir alertas aquí' },
      ],
    });
    const { error: configError } = await client
      .from('agent_config')
      .upsert({ key: 'telegram_bot_username', value: me.username, updated_at: new Date().toISOString() });
    if (configError) return json({ error: configError.message }, 500);
    return json({ ok: true, bot: `@${me.username}` });
  }

  if (action === 'test') {
    const { data, error } = await client.from('telegram_links').select('chat_id');
    if (error) return json({ error: error.message }, 500);
    let sent = 0;
    for (const row of data ?? []) {
      const ok = await telegram.sendMessage(Number(row.chat_id),
        '<b>FinSmart · prueba</b>\nSi lees esto, tu agente ya puede escribirte por Telegram.');
      if (ok) sent += 1;
    }
    return json({ ok: true, chats: data?.length ?? 0, sent });
  }

  return json({ error: 'Acción desconocida: usa "setup" o "test"' }, 400);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Usa POST' }, 405);

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) return json({ error: 'Falta el secreto TELEGRAM_BOT_TOKEN' }, 500);

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const telegram = createTelegramApi(token);

  // 1. Mensaje de Telegram.
  const telegramSecret = request.headers.get('x-telegram-bot-api-secret-token');
  if (telegramSecret !== null) {
    const { data: expected } = await client.rpc('telegram_webhook_secret');
    if (typeof expected !== 'string' || !safeEqual(telegramSecret, expected)) {
      return json({ error: 'No autorizado' }, 401);
    }
    const update = await request.json().catch(() => null) as TelegramUpdate | null;
    if (update) {
      try {
        await handleUpdate(update, botDeps(client, telegram));
      } catch (error) {
        console.error('telegram-bot:', error instanceof Error ? error.message : error);
      }
    }
    // Siempre 200: si no, Telegram reintenta el mismo mensaje una y otra vez.
    return json({ ok: true });
  }

  // 2. Administración.
  if (!(await isAuthorized(request.headers.get('x-agent-secret') ?? '', client))) {
    return json({ error: 'No autorizado' }, 401);
  }
  const body = await request.json().catch(() => ({})) as { action?: unknown };
  try {
    return await admin(body.action, client, telegram);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
