import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

const hasPlaceholder = (value?: string) =>
  !value || value.includes('tu-proyecto') || value.includes('tu-anon-key');

export const isSupabaseConfigured = !hasPlaceholder(supabaseUrl) && !hasPlaceholder(supabaseAnonKey);

/** URL del proyecto (pública), p. ej. para mostrar la dirección de las funciones. */
export const supabaseProjectUrl = isSupabaseConfigured ? supabaseUrl!.replace(/\/$/, '') : null;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
