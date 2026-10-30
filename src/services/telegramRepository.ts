import { supabase } from '../lib/supabase';

/** Vínculo con Telegram (tabla telegram_links). La RLS solo devuelve el propio. */
export interface TelegramLink {
  username: string | null;
  linkedAt: string;
}

export interface TelegramStatus {
  /** false si el proyecto aún no tiene supabase/telegram.sql ejecutado. */
  available: boolean;
  /** Usuario del bot sin @, o null si aún no se configuró. */
  botUsername: string | null;
  link: TelegramLink | null;
}

export async function loadTelegramStatus(): Promise<TelegramStatus> {
  if (!supabase) return { available: false, botUsername: null, link: null };

  const [config, link] = await Promise.all([
    supabase.from('agent_config').select('value').eq('key', 'telegram_bot_username').maybeSingle<{ value: string }>(),
    supabase.from('telegram_links').select('username,linked_at').maybeSingle<{ username: string | null; linked_at: string }>(),
  ]);

  if (config.error || link.error) return { available: false, botUsername: null, link: null };
  return {
    available: true,
    botUsername: config.data?.value ?? null,
    link: link.data ? { username: link.data.username, linkedAt: link.data.linked_at } : null,
  };
}

/** Código de un solo uso, válido 10 minutos. */
export async function createTelegramLinkCode(): Promise<string> {
  if (!supabase) throw new Error('Supabase no está configurado.');
  const { data, error } = await supabase.rpc('telegram_create_link_code');
  if (error || typeof data !== 'string') {
    throw new Error('No se pudo generar el código. Revisa que supabase/telegram.sql esté ejecutado.');
  }
  return data;
}

export async function unlinkTelegram(): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado.');
  // Sin filtro explícito la RLS limita el borrado al vínculo propio,
  // pero PostgREST exige un filtro: se usa uno que siempre se cumple.
  const { error } = await supabase.from('telegram_links').delete().not('chat_id', 'is', null);
  if (error) throw new Error('No se pudo desconectar Telegram.');
}

export function telegramDeepLink(botUsername: string, code: string): string {
  return `https://t.me/${encodeURIComponent(botUsername)}?start=${encodeURIComponent(code)}`;
}
