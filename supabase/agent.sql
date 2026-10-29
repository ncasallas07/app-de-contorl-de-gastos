-- FinSmart · tablas del agente coach financiero
-- Ejecutar DESPUÉS de schema.sql, completo, en Supabase Dashboard > SQL Editor.
-- Se puede ejecutar varias veces sin dañar datos.
--
-- El agente corre en la Edge Function `agent-run` con la clave service_role
-- (que nunca sale del servidor). La app solo lee lo que el agente escribe.

create extension if not exists pgcrypto;

-- ============================================================
-- TABLAS
-- ============================================================

-- Meta del usuario (capa 3, basada en objetivos).
create table if not exists public.agent_goals (
  user_id uuid primary key references auth.users (id) on delete cascade,
  target_months integer not null default 12
    check (target_months between 1 and 120),
  emergency_fund_min numeric(14, 2) not null default 0
    check (emergency_fund_min >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Memoria interna del agente (capa 2, basada en modelo).
create table if not exists public.agent_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_run_date date,
  last_payment_applied date,
  last_cycle_month text check (last_cycle_month ~ '^\d{4}-\d{2}$'),
  updated_at timestamptz not null default now()
);

-- Bitácora de cada ejecución del agente.
create table if not exists public.agent_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  run_date date not null,
  run_at timestamptz not null default now(),
  layers text[] not null default '{}',
  actions_created integer not null default 0,
  emails_sent integer not null default 0,
  status text not null check (status in ('ok', 'error')),
  error text
);

-- Lo que el agente detecta, hace o recomienda (la "bandeja" de la app).
create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  layer smallint not null check (layer between 1 and 5),
  kind text not null,
  severity text not null
    check (severity in ('urgente', 'alta', 'moderada', 'positiva', 'info')),
  title text not null,
  message text not null,
  data jsonb not null default '{}'::jsonb,
  -- Evita repetir la misma alerta todos los días.
  dedupe_key text not null,
  emailed_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

-- Plan de pago de deudas mes a mes (capa 3).
create table if not exists public.debt_plans (
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null,
  debt_id text not null,
  payment numeric(14, 2) not null check (payment >= 0),
  interest numeric(14, 2) not null default 0 check (interest >= 0),
  remaining numeric(14, 2) not null check (remaining >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, month, debt_id)
);

-- Correcciones del usuario para que el agente aprenda (capa 5).
create table if not exists public.agent_feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  concept text not null check (char_length(trim(concept)) > 0),
  suggested_category text,
  final_category text not null,
  suggested_ant boolean,
  final_ant boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists agent_actions_user_created_idx
  on public.agent_actions (user_id, created_at desc);
create index if not exists agent_runs_user_run_at_idx
  on public.agent_runs (user_id, run_at desc);
create index if not exists agent_feedback_user_idx
  on public.agent_feedback (user_id, created_at desc);

drop trigger if exists agent_goals_set_updated_at on public.agent_goals;
create trigger agent_goals_set_updated_at
  before update on public.agent_goals
  for each row execute function public.set_updated_at();

drop trigger if exists agent_state_set_updated_at on public.agent_state;
create trigger agent_state_set_updated_at
  before update on public.agent_state
  for each row execute function public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- El agente usa service_role (salta RLS). El usuario solo ve lo suyo.
-- ============================================================

alter table public.agent_goals enable row level security;
alter table public.agent_state enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_actions enable row level security;
alter table public.debt_plans enable row level security;
alter table public.agent_feedback enable row level security;

-- La meta la define el usuario.
drop policy if exists "agent_goals_own_rows" on public.agent_goals;
create policy "agent_goals_own_rows"
  on public.agent_goals for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Estado, ejecuciones y planes: solo lectura para el usuario.
drop policy if exists "agent_state_read_own" on public.agent_state;
create policy "agent_state_read_own"
  on public.agent_state for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "agent_runs_read_own" on public.agent_runs;
create policy "agent_runs_read_own"
  on public.agent_runs for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "debt_plans_read_own" on public.debt_plans;
create policy "debt_plans_read_own"
  on public.debt_plans for select
  to authenticated
  using (auth.uid() = user_id);

-- Acciones: el usuario las lee y solo puede marcarlas como leídas.
drop policy if exists "agent_actions_read_own" on public.agent_actions;
create policy "agent_actions_read_own"
  on public.agent_actions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "agent_actions_mark_read_own" on public.agent_actions;
create policy "agent_actions_mark_read_own"
  on public.agent_actions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Correcciones: el usuario las crea y las lee.
drop policy if exists "agent_feedback_insert_own" on public.agent_feedback;
create policy "agent_feedback_insert_own"
  on public.agent_feedback for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "agent_feedback_read_own" on public.agent_feedback;
create policy "agent_feedback_read_own"
  on public.agent_feedback for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.agent_goals, public.agent_state, public.agent_runs,
  public.agent_actions, public.debt_plans, public.agent_feedback
  from anon, authenticated;

grant select, insert, update, delete on public.agent_goals to authenticated;
grant select on public.agent_state, public.agent_runs, public.debt_plans
  to authenticated;
grant select on public.agent_actions to authenticated;
-- Solo la columna read_at se puede cambiar desde la app.
grant update (read_at) on public.agent_actions to authenticated;
grant select, insert on public.agent_feedback to authenticated;

-- ============================================================
-- EJECUCIÓN DIARIA (Supabase Cron)
-- Paso aparte: ejecutar SOLO después de desplegar la función
-- y de definir el secreto AGENT_CRON_SECRET (ver README del agente).
-- Reemplaza los dos valores entre <...> en tu SQL Editor; no los guardes
-- en el repositorio.
-- ============================================================
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select vault.create_secret('https://<TU-PROYECTO>.supabase.co', 'project_url');
-- select vault.create_secret('<EL MISMO AGENT_CRON_SECRET>', 'agent_cron_secret');
--
-- -- Todos los días a las 10:00 UTC = 5:00 a. m. en Bogotá.
-- select cron.schedule(
--   'finsmart-agent-diario',
--   '0 10 * * *',
--   $$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
--       || '/functions/v1/agent-run',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-agent-secret',
--       (select decrypted_secret from vault.decrypted_secrets where name = 'agent_cron_secret')
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
