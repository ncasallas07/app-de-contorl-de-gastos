-- FinSmart · alertas por Telegram (fase 2, sesión 1)
-- Ejecutar DESPUÉS de agent.sql y agent_cron.sql, completo, en el SQL Editor.
-- Se puede ejecutar varias veces sin dañar nada.
--
-- Cómo se vincula una cuenta:
--   1. En la app, Ajustes > Alertas por Telegram genera un código de un solo
--      uso (telegram_create_link_code) válido 10 minutos.
--   2. El usuario abre el bot con ese código (/start CODIGO).
--   3. La función telegram-bot guarda el chat en telegram_links.
-- Desde ahí, el agente envía sus alertas a ese chat.

-- ============================================================
-- TABLAS
-- ============================================================

create table if not exists public.telegram_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  chat_id bigint not null unique,
  username text,
  linked_at timestamptz not null default now()
);

create table if not exists public.telegram_link_codes (
  code text primary key check (code ~ '^[A-Z0-9]{8}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null
);

-- Configuración pública del agente (nunca secretos): p. ej. el usuario del bot.
create table if not exists public.agent_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.telegram_links enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.agent_config enable row level security;

-- El usuario ve su vínculo y puede desconectarlo. Crearlo solo lo hace el bot.
drop policy if exists "telegram_links_read_own" on public.telegram_links;
create policy "telegram_links_read_own"
  on public.telegram_links for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "telegram_links_delete_own" on public.telegram_links;
create policy "telegram_links_delete_own"
  on public.telegram_links for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "agent_config_read" on public.agent_config;
create policy "agent_config_read"
  on public.agent_config for select
  to authenticated
  using (true);

revoke all on public.telegram_links, public.telegram_link_codes, public.agent_config
  from anon, authenticated;
grant select, delete on public.telegram_links to authenticated;
grant select on public.agent_config to authenticated;
-- telegram_link_codes: sin acceso directo; solo por la función de abajo.

-- ============================================================
-- CÓDIGO DE VINCULACIÓN (lo pide la app)
-- ============================================================

create or replace function public.telegram_create_link_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
begin
  if v_user is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  -- Un código vigente por usuario; de paso se limpian los vencidos.
  delete from public.telegram_link_codes
  where user_id = v_user or expires_at < now();

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.telegram_link_codes (code, user_id, expires_at)
  values (v_code, v_user, now() + interval '10 minutes');

  return v_code;
end;
$$;

revoke all on function public.telegram_create_link_code() from public, anon;
grant execute on function public.telegram_create_link_code() to authenticated;

-- ============================================================
-- USAR EL CÓDIGO (lo llama la función telegram-bot con service_role)
-- Devuelve 'ok', 'codigo_invalido' o 'chat_de_otra_cuenta'.
-- ============================================================

create or replace function public.telegram_consume_code(
  p_code text,
  p_chat_id bigint,
  p_username text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  -- El código se borra al usarlo: sirve una sola vez.
  delete from public.telegram_link_codes
  where code = upper(p_code) and expires_at >= now()
  returning user_id into v_user;

  if v_user is null then
    return 'codigo_invalido';
  end if;

  if exists (
    select 1 from public.telegram_links where chat_id = p_chat_id and user_id <> v_user
  ) then
    return 'chat_de_otra_cuenta';
  end if;

  insert into public.telegram_links (user_id, chat_id, username, linked_at)
  values (v_user, p_chat_id, p_username, now())
  on conflict (user_id) do update
    set chat_id = excluded.chat_id,
        username = excluded.username,
        linked_at = excluded.linked_at;

  return 'ok';
end;
$$;

revoke all on function public.telegram_consume_code(text, bigint, text) from public, anon, authenticated;
grant execute on function public.telegram_consume_code(text, bigint, text) to service_role;

-- ============================================================
-- SECRETO DEL WEBHOOK
-- Telegram lo envía en cada mensaje (X-Telegram-Bot-Api-Secret-Token) y la
-- función lo compara. Se genera aquí, al azar, y vive solo en Vault.
-- ============================================================

select vault.create_secret(
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'telegram_webhook_secret',
  'Valida que los mensajes al bot de FinSmart vienen de Telegram'
)
where not exists (select 1 from vault.secrets where name = 'telegram_webhook_secret');

create or replace function public.telegram_webhook_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'telegram_webhook_secret';
$$;

revoke all on function public.telegram_webhook_secret() from public, anon, authenticated;
grant execute on function public.telegram_webhook_secret() to service_role;

-- ============================================================
-- ADMINISTRACIÓN (solo desde el SQL Editor)
--   select public.telegram_setup();  -- conecta el bot con la función
--   select public.telegram_test();   -- envía un mensaje de prueba
--   select status_code, content from net._http_response order by created desc limit 1;
-- ============================================================

create or replace function public.telegram_admin(p_action text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/telegram-bot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'agent_cron_secret')
    ),
    body := jsonb_build_object('action', p_action),
    timeout_milliseconds := 30000
  );
$$;

create or replace function public.telegram_setup() returns bigint
language sql security definer set search_path = ''
as $$ select public.telegram_admin('setup'); $$;

create or replace function public.telegram_test() returns bigint
language sql security definer set search_path = ''
as $$ select public.telegram_admin('test'); $$;

revoke all on function public.telegram_admin(text) from public, anon, authenticated;
revoke all on function public.telegram_setup() from public, anon, authenticated;
revoke all on function public.telegram_test() from public, anon, authenticated;
