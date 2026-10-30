// Autorización de las llamadas internas (cron y administración) a las Edge Functions.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/** Comparación en tiempo constante para no filtrar el secreto por tiempos. */
export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/**
 * El secreto vive en Supabase Vault (lo crea supabase/agent_cron.sql) y se
 * verifica en la base de datos. Opcionalmente también se acepta el secreto
 * de entorno AGENT_CRON_SECRET.
 */
export async function isAuthorized(provided: string, client: SupabaseClient): Promise<boolean> {
  if (provided.length < 32) return false;

  const envSecret = Deno.env.get('AGENT_CRON_SECRET');
  if (envSecret && safeEqual(provided, envSecret)) return true;

  const { data, error } = await client.rpc('agent_check_secret', { p_secret: provided });
  return !error && data === true;
}
