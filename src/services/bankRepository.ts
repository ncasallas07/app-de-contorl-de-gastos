import { supabase, supabaseProjectUrl } from '../lib/supabase';

/** Estado del token con el que los celulares envían los avisos (nunca el token). */
export interface IngestStatus {
  /** false si el proyecto aún no tiene supabase/banks.sql ejecutado. */
  available: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export type BankEventKind = 'compra' | 'envio' | 'rechazo' | 'ingreso';

export interface BankEventRow {
  id: number;
  bank: string;
  kind: BankEventKind;
  amount: number;
  merchant: string | null;
  status: 'nuevo' | 'sumado' | 'ignorado';
  source: 'sms' | 'correo' | 'prueba';
  receivedAt: string;
}

/** Dirección a la que los celulares envían los avisos. */
export function bankIngestUrl(): string | null {
  return supabaseProjectUrl ? `${supabaseProjectUrl}/functions/v1/bank-ingest` : null;
}

export async function loadIngestStatus(): Promise<IngestStatus> {
  if (!supabase) return { available: false, createdAt: null, lastUsedAt: null };
  const { data, error } = await supabase.rpc('bank_ingest_status');
  if (error) return { available: false, createdAt: null, lastUsedAt: null };
  const row = (data as { created_at: string; last_used_at: string | null }[] | null)?.[0];
  return { available: true, createdAt: row?.created_at ?? null, lastUsedAt: row?.last_used_at ?? null };
}

/** Genera un token nuevo (el anterior deja de funcionar). Solo se ve esta vez. */
export async function createIngestToken(): Promise<string> {
  if (!supabase) throw new Error('Supabase no está configurado.');
  const { data, error } = await supabase.rpc('bank_create_ingest_token');
  if (error || typeof data !== 'string') {
    throw new Error('No se pudo generar el token. Revisa que supabase/banks.sql esté ejecutado.');
  }
  return data;
}

export async function revokeIngestToken(): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado.');
  const { error } = await supabase.rpc('bank_revoke_ingest_token');
  if (error) throw new Error('No se pudo desactivar el token.');
}

export async function loadRecentBankEvents(limit = 5): Promise<BankEventRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('bank_events')
    .select('id,bank,kind,amount,merchant,status,source,received_at')
    .order('received_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((row) => ({
    id: Number(row.id),
    bank: row.bank as string,
    kind: row.kind as BankEventKind,
    amount: Number(row.amount),
    merchant: (row.merchant as string | null) ?? null,
    status: row.status as BankEventRow['status'],
    source: row.source as BankEventRow['source'],
    receivedAt: row.received_at as string,
  }));
}
