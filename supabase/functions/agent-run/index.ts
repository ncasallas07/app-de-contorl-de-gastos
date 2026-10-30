// Edge Function `agent-run`: punto de entrada del agente coach financiero.
//
// La llama Supabase Cron una vez al día (ver supabase/agent_cron.sql) y
// también se puede disparar a mano con `select public.run_finsmart_agent();`.
// Está protegida con el encabezado `x-agent-secret`, que debe coincidir con
// el secreto guardado en Supabase Vault.
//
// Cuerpo opcional (JSON):
//   { "userId": "<uuid>" }        ejecutar solo para un usuario
//   { "today": "2026-11-15" }     simular otra fecha (demo y pruebas)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { runAgent } from '../_shared/orchestrator.ts';
import { createSupabaseStore } from '../_shared/supabaseStore.ts';
import { createResendSender } from '../_shared/notify.ts';
import { isAuthorized } from '../_shared/auth.ts';
import { createTelegramApi } from '../_shared/telegram.ts';
import { isIsoDate, todayInZone } from '../_shared/zone.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Usa POST' }, 405);

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  if (!(await isAuthorized(request.headers.get('x-agent-secret') ?? '', client))) {
    return json({ error: 'No autorizado' }, 401);
  }

  const body = await request.json().catch(() => ({})) as { userId?: unknown; today?: unknown };

  if (body.today !== undefined && !isIsoDate(body.today)) {
    return json({ error: '"today" debe tener el formato YYYY-MM-DD' }, 400);
  }
  if (body.userId !== undefined && (typeof body.userId !== 'string' || !UUID.test(body.userId))) {
    return json({ error: '"userId" debe ser un UUID' }, 400);
  }

  const today = (body.today as string | undefined) ?? todayInZone();
  const userId = body.userId as string | undefined;

  const sendEmail = createResendSender(
    Deno.env.get('RESEND_API_KEY'),
    Deno.env.get('RESEND_FROM') ?? undefined
  );

  // Telegram es opcional: sin TELEGRAM_BOT_TOKEN el agente solo usa la app y el correo.
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const telegram = botToken ? createTelegramApi(botToken) : null;
  const sendTelegram = telegram
    ? (chatId: number, text: string, silent: boolean) => telegram.sendMessage(chatId, text, { silent })
    : undefined;

  try {
    const results = await runAgent(today, createSupabaseStore(client), sendEmail, userId, sendTelegram);
    return json({
      today,
      users: results.length,
      newActions: results.reduce((sum, result) => sum + result.newActions, 0),
      balanceAdded: results.reduce((sum, result) => sum + result.balanceDelta, 0),
      telegramSent: results.filter((result) => result.telegramSent).length,
      errors: results.filter((result) => result.status === 'error'),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
