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
-- CAPA 2: APLICAR EL CIERRE DE CICLO DE FORMA ATÓMICA
-- El agente envía lo que decidió (cuánto sumar al balance y qué cuotas
-- renovar). Solo se aplica si nadie guardó desde que el agente leyó los
-- datos (p_expected_version); si no, devuelve null y lo reintenta mañana.
-- ============================================================

create or replace function public.agent_apply_cycle(
  p_user_id uuid,
  p_expected_version bigint,
  p_balance_delta numeric,
  p_debt_updates jsonb,
  p_last_payment_applied date,
  p_run_date date
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current bigint;
  v_next bigint;
  v_changes boolean :=
    coalesce(p_balance_delta, 0) <> 0
    or jsonb_array_length(coalesce(p_debt_updates, '[]'::jsonb)) > 0;
begin
  select state_version into v_current
  from public.finance_settings
  where user_id = p_user_id
  for update;

  if v_current is null or v_current <> p_expected_version then
    return null;
  end if;

  v_next := case when v_changes then v_current + 1 else v_current end;

  if v_changes then
    update public.finance_settings
    set current_balance = current_balance + coalesce(p_balance_delta, 0),
        state_version = v_next,
        updated_at = now()
    where user_id = p_user_id;

    update public.debts d
    set due_date = x.due_date,
        payment_status = x.payment_status,
        updated_at = now()
    from jsonb_to_recordset(coalesce(p_debt_updates, '[]'::jsonb))
      as x(id text, due_date date, payment_status text)
    where d.user_id = p_user_id
      and d.id = x.id
      and x.payment_status in ('pendiente', 'pagado_mes', 'liquidada');
  end if;

  insert into public.agent_state (user_id, last_run_date, last_payment_applied)
  values (p_user_id, p_run_date, p_last_payment_applied)
  on conflict (user_id) do update set
    last_run_date = excluded.last_run_date,
    last_payment_applied = excluded.last_payment_applied;

  return v_next;
end;
$$;

revoke all on function public.agent_apply_cycle(uuid, bigint, numeric, jsonb, date, date)
  from public, anon, authenticated;
grant execute on function public.agent_apply_cycle(uuid, bigint, numeric, jsonb, date, date)
  to service_role;

-- ============================================================
-- EJECUCIÓN DIARIA
-- Está en supabase/agent_cron.sql (solo funciona en Supabase, porque usa
-- pg_cron, pg_net y Vault). Ejecútalo después de desplegar agent-run.
-- ============================================================
