-- FinSmart · avisos de los bancos (fase 2, sesión 3)
-- Ejecutar DESPUÉS de telegram.sql, completo, en el SQL Editor.
-- Se puede ejecutar varias veces sin dañar nada.
--
-- Los celulares (MacroDroid en Android, Atajos en iPhone) y el reenvío de
-- correos mandan el texto del aviso a la función bank-ingest. Aquí quedan:
--   - el token personal con el que se identifican (solo su huella SHA-256),
--   - cada aviso leído, sin duplicados aunque llegue a dos celulares,
--   - lo que la persona decidió con los ingresos.

-- ============================================================
-- AVISOS RECIBIDOS
-- ============================================================

create table if not exists public.bank_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  bank text not null,
  kind text not null check (kind in ('compra', 'envio', 'rechazo', 'ingreso')),
  amount numeric(14, 2) not null check (amount > 0),
  merchant text,
  merchant_key text not null default '',
  fingerprint text not null,
  source text not null check (source in ('sms', 'correo', 'prueba')),
  raw_text text,
  status text not null default 'nuevo' check (status in ('nuevo', 'sumado', 'ignorado')),
  received_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists bank_events_user_fp_idx on public.bank_events (user_id, fingerprint, received_at desc);
create index if not exists bank_events_user_kind_idx on public.bank_events (user_id, kind, merchant_key, received_at desc);

alter table public.bank_events enable row level security;

-- La persona puede ver sus avisos (para la app, sesión 4). Escribir solo lo hace el servidor.
drop policy if exists "bank_events_read_own" on public.bank_events;
create policy "bank_events_read_own"
  on public.bank_events for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.bank_events from anon, authenticated;
grant select on public.bank_events to authenticated;

-- Guarda un aviso. Devuelve su id, o null si el mismo aviso ya llegó hace
-- menos de 10 minutos (al otro celular o por SMS y correo a la vez).
create or replace function public.bank_record_event(
  p_user_id uuid,
  p_bank text,
  p_kind text,
  p_amount numeric,
  p_merchant text,
  p_merchant_key text,
  p_fingerprint text,
  p_source text,
  p_raw_text text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  -- Dos celulares pueden avisar al mismo tiempo: se atienden en fila.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || p_fingerprint, 0));

  if exists (
    select 1 from public.bank_events
    where user_id = p_user_id
      and fingerprint = p_fingerprint
      and received_at > now() - interval '10 minutes'
  ) then
    return null;
  end if;

  insert into public.bank_events (user_id, bank, kind, amount, merchant, merchant_key, fingerprint, source, raw_text)
  values (p_user_id, p_bank, p_kind, p_amount, p_merchant, coalesce(p_merchant_key, ''), p_fingerprint, p_source,
          left(p_raw_text, 500))
  returning id into v_id;

  return v_id;
end;
$$;

-- Ingreso: sumarlo al saldo (una sola vez) o marcarlo como "no sumar".
create or replace function public.bank_add_income(p_user_id uuid, p_event_id bigint)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric;
  v_balance numeric;
begin
  update public.bank_events
  set status = 'sumado', decided_at = now()
  where id = p_event_id and user_id = p_user_id and kind = 'ingreso' and status = 'nuevo'
  returning amount into v_amount;

  if v_amount is null then
    return null;
  end if;

  update public.finance_settings
  set current_balance = current_balance + v_amount,
      state_version = state_version + 1,
      updated_at = now()
  where user_id = p_user_id
  returning current_balance into v_balance;

  return v_balance;
end;
$$;

create or replace function public.bank_dismiss_income(p_user_id uuid, p_event_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with changed as (
    update public.bank_events
    set status = 'ignorado', decided_at = now()
    where id = p_event_id and user_id = p_user_id and kind = 'ingreso' and status = 'nuevo'
    returning 1
  )
  select exists (select 1 from changed);
$$;

revoke all on function public.bank_record_event(uuid, text, text, numeric, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.bank_record_event(uuid, text, text, numeric, text, text, text, text, text)
  to service_role;
revoke all on function public.bank_add_income(uuid, bigint) from public, anon, authenticated;
grant execute on function public.bank_add_income(uuid, bigint) to service_role;
revoke all on function public.bank_dismiss_income(uuid, bigint) from public, anon, authenticated;
grant execute on function public.bank_dismiss_income(uuid, bigint) to service_role;

-- ============================================================
-- TOKEN PERSONAL DE LOS CELULARES
-- La app lo genera y lo muestra una sola vez; aquí solo queda su huella.
-- Generar uno nuevo invalida el anterior.
-- ============================================================

create table if not exists public.bank_ingest_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.bank_ingest_tokens enable row level security;
revoke all on public.bank_ingest_tokens from anon, authenticated;

create or replace function public.bank_create_ingest_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_token text;
begin
  if v_user is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  v_token := 'fs_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.bank_ingest_tokens (user_id, token_hash, created_at, last_used_at)
  values (v_user, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), now(), null)
  on conflict (user_id) do update
    set token_hash = excluded.token_hash,
        created_at = excluded.created_at,
        last_used_at = null;

  return v_token;
end;
$$;

-- Para la app: si ya hay token y cuándo se usó por última vez (nunca el token).
create or replace function public.bank_ingest_status()
returns table (created_at timestamptz, last_used_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.created_at, t.last_used_at from public.bank_ingest_tokens t where t.user_id = auth.uid();
$$;

create or replace function public.bank_revoke_ingest_token()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.bank_ingest_tokens where user_id = auth.uid();
$$;

-- Para la función bank-ingest: de quién es este token.
create or replace function public.bank_user_for_token(p_hash text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  update public.bank_ingest_tokens
  set last_used_at = now()
  where token_hash = p_hash
  returning user_id;
$$;

revoke all on function public.bank_create_ingest_token() from public, anon;
grant execute on function public.bank_create_ingest_token() to authenticated;
revoke all on function public.bank_ingest_status() from public, anon;
grant execute on function public.bank_ingest_status() to authenticated;
revoke all on function public.bank_revoke_ingest_token() from public, anon;
grant execute on function public.bank_revoke_ingest_token() to authenticated;
revoke all on function public.bank_user_for_token(text) from public, anon, authenticated;
grant execute on function public.bank_user_for_token(text) to service_role;

-- ============================================================
-- PRUEBAS (solo desde el SQL Editor)
--   select public.bank_test('tu@correo.com', 'NEQUI: Pagaste 3.900,00 en GOOGLE *Google One');
--   select status_code, content from net._http_response order by created desc limit 1;
-- ============================================================

create or replace function public.bank_test(p_email text, p_text text, p_sender text default null)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/bank-ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'agent_cron_secret')
    ),
    body := jsonb_build_object(
      'userId', (select id from auth.users where lower(email) = lower(p_email)),
      'text', p_text,
      'sender', p_sender,
      'source', 'prueba'
    ),
    timeout_milliseconds := 30000
  );
$$;

revoke all on function public.bank_test(text, text, text) from public, anon, authenticated;
