// Edge Function `bank-ingest`: recibe el texto de los avisos de los bancos.
//
// Quién la llama:
//   - MacroDroid (Android) y Atajos (iPhone) cuando llega un SMS del banco.
//   - El reenvío de correos de Nu (sesión 5).
//   - El SQL Editor con `select public.bank_test(...)` para probar.
//
// Autenticación:
//   - Celulares: encabezado `x-finsmart-token` con el token personal que se
//     genera en la app. En la base de datos solo se guarda su huella SHA-256.
//   - Pruebas: `x-agent-secret` (el del agente diario) + "userId" en el cuerpo.
//
// Cuerpo: JSON { "text": "...", "sender": "890806", "source": "sms" } o el
// texto plano del aviso (útil cuando el SMS trae comillas que rompen un JSON);
// en ese caso sender y source van en la URL: ?sender=890806&source=sms
//
// Se despliega con --no-verify-jwt: los celulares no inician sesión en Supabase.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { isAuthorized } from '../_shared/auth.ts';
import { type IngestDeps, type IngestSource, processBankMessage } from '../_shared/bankIngest.ts';
import { createDraftStore } from '../_shared/draftStore.ts';
import { createSupabaseStore } from '../_shared/supabaseStore.ts';
import { createTelegramApi } from '../_shared/telegram.ts';
import { todayInZone } from '../_shared/zone.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES: IngestSource[] = ['sms', 'correo', 'prueba'];

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface Body {
  text?: unknown;
  sender?: unknown;
  source?: unknown;
  userId?: unknown;
}

async function readBody(request: Request): Promise<Body> {
  const url = new URL(request.url);
  const raw = await request.text();
  const fromUrl = { sender: url.searchParams.get('sender'), source: url.searchParams.get('source') };
  if ((request.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      return { ...fromUrl, ...JSON.parse(raw) as Body };
    } catch {
      // JSON roto (comillas del SMS): se usa el texto tal cual.
    }
  }
  return { ...fromUrl, text: raw };
}

async function resolveUser(request: Request, body: Body, client: SupabaseClient): Promise<string | null> {
  const token = request.headers.get('x-finsmart-token')
    ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (token.startsWith('fs_') && token.length >= 40) {
    const { data, error } = await client.rpc('bank_user_for_token', { p_hash: await sha256(token) });
    return !error && typeof data === 'string' ? data : null;
  }
  const secret = request.headers.get('x-agent-secret');
  if (secret && typeof body.userId === 'string' && UUID.test(body.userId) && await isAuthorized(secret, client)) {
    return body.userId;
  }
  return null;
}

function deps(client: SupabaseClient): IngestDeps {
  const store = createSupabaseStore(client);
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const telegram = token ? createTelegramApi(token) : null;
  return {
    async recordEvent(userId, event) {
      const { data, error } = await client.rpc('bank_record_event', {
        p_user_id: userId,
        p_bank: event.bank,
        p_kind: event.kind,
        p_amount: event.amount,
        p_merchant: event.merchant,
        p_merchant_key: event.merchantKey,
        p_fingerprint: event.fingerprint,
        p_source: event.source,
        p_raw_text: event.rawText,
      });
      if (error) throw new Error(`No se pudo guardar el aviso: ${error.message}`);
      return data === null ? null : Number(data);
    },
    async countRejections(userId, key, days) {
      const { count, error } = await client.from('bank_events')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('kind', 'rechazo').eq('merchant_key', key)
        .gte('received_at', new Date(Date.now() - days * 86_400_000).toISOString());
      if (error) throw new Error(`No se pudieron contar los rechazos: ${error.message}`);
      return count ?? 0;
    },
    getTelegramChatId: telegram ? (userId) => store.getTelegramChatId(userId) : () => Promise.resolve(null),
    loadState: (userId) => store.loadUserState(userId),
    ...createDraftStore(client),
    send: (chatId, text, keyboard, silent) =>
      telegram ? telegram.sendMessage(chatId, text, { keyboard, silent }) : Promise.resolve(false),
    saveActions: (userId, actions) => store.saveActions(userId, actions),
    today: () => todayInZone(),
  };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Usa POST' }, 405);

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const body = await readBody(request);
  const userId = await resolveUser(request, body, client);
  if (!userId) return json({ error: 'No autorizado' }, 401);

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 2000) return json({ error: 'Falta el texto del aviso (máximo 2000 caracteres)' }, 400);

  const source = SOURCES.includes(body.source as IngestSource) ? body.source as IngestSource : 'sms';
  const sender = typeof body.sender === 'string' ? body.sender.slice(0, 120) : null;

  try {
    const result = await processBankMessage({ userId, text, sender, source }, deps(client));
    return json(result);
  } catch (error) {
    console.error('bank-ingest:', error instanceof Error ? error.message : error);
    return json({ error: 'No se pudo procesar el aviso' }, 500);
  }
});
