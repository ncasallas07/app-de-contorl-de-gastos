-- FinSmart · esquema de Supabase
-- Ejecutar completo en Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

-- ============================================================
-- TABLAS
-- ============================================================

create table if not exists public.finance_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  contract_type text not null default 'indefinido'
    check (contract_type in ('indefinido', 'obra_labor')),
  pay_mode text not null default 'mensual'
    check (pay_mode in ('mensual', 'dia', 'hora')),
  daily_rate numeric(14, 2) not null default 0 check (daily_rate >= 0),
  hourly_rate numeric(14, 2) not null default 0 check (hourly_rate >= 0),
  work_days_per_week integer not null default 5
    check (work_days_per_week between 1 and 7),
  payment_weekday integer not null default 5
    check (payment_weekday between 1 and 7),
  default_shift text not null default 'diurno'
    check (default_shift in ('diurno', 'nocturno', 'mixto')),
  hours_per_shift numeric(4, 1) not null default 8
    check (hours_per_shift between 0.5 and 24),
  monthly_salary numeric(14, 2) not null default 0 check (monthly_salary >= 0),
  payment_period text not null default 'mensual'
    check (payment_period in ('mensual', 'quincenal', 'semanal')),
  payment_day_of_month integer not null default 28
    check (payment_day_of_month between 1 and 31),
  work_days_per_month_target integer not null default 22
    check (work_days_per_month_target between 1 and 31),
  current_balance numeric(14, 2) not null default 0,
  currency text not null default 'COP' check (currency = 'COP'),
  strategy_mode text not null default 'avalancha'
    check (strategy_mode in ('avalancha', 'bola_de_nieve')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  date date not null,
  title text not null check (char_length(trim(title)) > 0),
  category text not null,
  amount numeric(14, 2) not null check (amount >= 0),
  is_ant_expense boolean not null default false,
  ant_tag text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.debts (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  title text not null check (char_length(trim(title)) > 0),
  category text not null,
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0),
  monthly_payment numeric(14, 2) not null default 0 check (monthly_payment >= 0),
  annual_interest_rate numeric(6, 2) not null default 0 check (annual_interest_rate >= 0),
  due_date date not null,
  payment_status text not null default 'pendiente'
    check (payment_status in ('pendiente', 'pagado_mes', 'liquidada')),
  minimum_payment_only boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.work_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  type text not null
    check (type in ('laboral', 'extra', 'medio_dia', 'descanso')),
  shift text not null default 'diurno'
    check (shift in ('diurno', 'nocturno', 'mixto')),
  hours_worked numeric(5, 2),
  daily_earnings numeric(14, 2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.finance_settings
  add column if not exists contract_type text not null default 'indefinido'
    check (contract_type in ('indefinido', 'obra_labor')),
  add column if not exists pay_mode text not null default 'mensual'
    check (pay_mode in ('mensual', 'dia', 'hora')),
  add column if not exists daily_rate numeric(14, 2) not null default 0
    check (daily_rate >= 0),
  add column if not exists hourly_rate numeric(14, 2) not null default 0
    check (hourly_rate >= 0),
  add column if not exists work_days_per_week integer not null default 5
    check (work_days_per_week between 1 and 7),
  add column if not exists payment_weekday integer not null default 5
    check (payment_weekday between 1 and 7),
  add column if not exists default_shift text not null default 'diurno'
    check (default_shift in ('diurno', 'nocturno', 'mixto')),
  add column if not exists hours_per_shift numeric(4, 1) not null default 8
    check (hours_per_shift between 0.5 and 24);

-- Versión del estado financiero. Sube cada vez que la app o el agente
-- guardan cambios; así ninguno de los dos pisa lo que el otro escribió.
alter table public.finance_settings
  add column if not exists state_version bigint not null default 0;

alter table public.work_days
  add column if not exists shift text not null default 'diurno'
    check (shift in ('diurno', 'nocturno', 'mixto'));

create index if not exists expenses_user_date_idx
  on public.expenses (user_id, date desc);
create index if not exists debts_user_due_date_idx
  on public.debts (user_id, due_date);
create index if not exists work_days_user_date_idx
  on public.work_days (user_id, date desc);

-- ============================================================
-- UPDATED_AT
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists finance_settings_set_updated_at on public.finance_settings;
create trigger finance_settings_set_updated_at
  before update on public.finance_settings
  for each row execute function public.set_updated_at();

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

drop trigger if exists debts_set_updated_at on public.debts;
create trigger debts_set_updated_at
  before update on public.debts
  for each row execute function public.set_updated_at();

drop trigger if exists work_days_set_updated_at on public.work_days;
create trigger work_days_set_updated_at
  before update on public.work_days
  for each row execute function public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.finance_settings enable row level security;
alter table public.expenses enable row level security;
alter table public.debts enable row level security;
alter table public.work_days enable row level security;

drop policy if exists "finance_settings_own_rows" on public.finance_settings;
create policy "finance_settings_own_rows"
  on public.finance_settings for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "expenses_own_rows" on public.expenses;
create policy "expenses_own_rows"
  on public.expenses for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "debts_own_rows" on public.debts;
create policy "debts_own_rows"
  on public.debts for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "work_days_own_rows" on public.work_days;
create policy "work_days_own_rows"
  on public.work_days for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- GUARDADO ATÓMICO DEL ESTADO FINANCIERO
-- ============================================================

-- Versión anterior (sin control de versión): se reemplaza.
drop function if exists public.save_finance_state(jsonb, jsonb, jsonb, jsonb);

-- p_expected_version: la versión que la app cargó. Si alguien (por ejemplo
-- el agente) guardó después, se rechaza con FINSMART_CONFLICT para que la
-- app recargue en vez de pisar esos cambios. Devuelve la nueva versión.
create or replace function public.save_finance_state(
  p_salary jsonb,
  p_debts jsonb,
  p_expenses jsonb,
  p_work_days jsonb,
  p_expected_version bigint default null
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_current bigint;
  v_next bigint;
begin
  if v_user_id is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  -- Bloquea la fila para que dos guardados no se crucen.
  select state_version into v_current
  from public.finance_settings
  where user_id = v_user_id
  for update;

  if p_expected_version is not null
    and v_current is not null
    and v_current <> p_expected_version then
    raise exception 'FINSMART_CONFLICT: tus datos cambiaron (versión % y no %)',
      v_current, p_expected_version
      using errcode = '40001';
  end if;

  v_next := coalesce(v_current, 0) + 1;

  insert into public.finance_settings (
    user_id,
    contract_type,
    pay_mode,
    daily_rate,
    hourly_rate,
    work_days_per_week,
    payment_weekday,
    default_shift,
    hours_per_shift,
    monthly_salary,
    payment_period,
    payment_day_of_month,
    work_days_per_month_target,
    current_balance,
    currency,
    strategy_mode,
    state_version
  )
  values (
    v_user_id,
    case
      when p_salary ->> 'contract_type' = 'obra_labor' then 'obra_labor'
      else 'indefinido'
    end,
    case
      when p_salary ->> 'pay_mode' in ('dia', 'hora') then p_salary ->> 'pay_mode'
      else 'mensual'
    end,
    coalesce((p_salary ->> 'daily_rate')::numeric, 0),
    coalesce((p_salary ->> 'hourly_rate')::numeric, 0),
    greatest(1, least(7, coalesce((p_salary ->> 'work_days_per_week')::integer, 5))),
    greatest(1, least(7, coalesce((p_salary ->> 'payment_weekday')::integer, 5))),
    case
      when p_salary ->> 'default_shift' in ('nocturno', 'mixto') then p_salary ->> 'default_shift'
      else 'diurno'
    end,
    greatest(0.5, least(24, coalesce((p_salary ->> 'hours_per_shift')::numeric, 8))),
    coalesce((p_salary ->> 'monthly_salary')::numeric, 0),
    coalesce(p_salary ->> 'payment_period', 'mensual'),
    greatest(1, least(31, coalesce((p_salary ->> 'payment_day_of_month')::integer, 28))),
    greatest(1, least(31, coalesce((p_salary ->> 'work_days_per_month_target')::integer, 22))),
    coalesce((p_salary ->> 'current_balance')::numeric, 0),
    'COP',
    case
      when p_salary ->> 'strategy_mode' = 'bola_de_nieve' then 'bola_de_nieve'
      else 'avalancha'
    end,
    v_next
  )
  on conflict (user_id) do update set
    contract_type = excluded.contract_type,
    pay_mode = excluded.pay_mode,
    daily_rate = excluded.daily_rate,
    hourly_rate = excluded.hourly_rate,
    work_days_per_week = excluded.work_days_per_week,
    payment_weekday = excluded.payment_weekday,
    default_shift = excluded.default_shift,
    hours_per_shift = excluded.hours_per_shift,
    monthly_salary = excluded.monthly_salary,
    payment_period = excluded.payment_period,
    payment_day_of_month = excluded.payment_day_of_month,
    work_days_per_month_target = excluded.work_days_per_month_target,
    current_balance = excluded.current_balance,
    currency = excluded.currency,
    strategy_mode = excluded.strategy_mode,
    state_version = excluded.state_version,
    updated_at = now();

  delete from public.expenses e
  where e.user_id = v_user_id
    and not exists (
      select 1
      from jsonb_to_recordset(coalesce(p_expenses, '[]'::jsonb)) as x(id text)
      where x.id = e.id
    );

  insert into public.expenses (
    user_id, id, date, title, category, amount, is_ant_expense, ant_tag, notes
  )
  select
    v_user_id, x.id, x.date, x.title, x.category, x.amount,
    coalesce(x.is_ant_expense, false), x.ant_tag, x.notes
  from jsonb_to_recordset(coalesce(p_expenses, '[]'::jsonb)) as x(
    id text,
    date date,
    title text,
    category text,
    amount numeric,
    is_ant_expense boolean,
    ant_tag text,
    notes text
  )
  on conflict (user_id, id) do update set
    date = excluded.date,
    title = excluded.title,
    category = excluded.category,
    amount = excluded.amount,
    is_ant_expense = excluded.is_ant_expense,
    ant_tag = excluded.ant_tag,
    notes = excluded.notes,
    updated_at = now();

  delete from public.debts d
  where d.user_id = v_user_id
    and not exists (
      select 1
      from jsonb_to_recordset(coalesce(p_debts, '[]'::jsonb)) as x(id text)
      where x.id = d.id
    );

  insert into public.debts (
    user_id, id, title, category, total_amount, monthly_payment,
    annual_interest_rate, due_date, payment_status, minimum_payment_only, notes
  )
  select
    v_user_id, x.id, x.title, x.category, x.total_amount, x.monthly_payment,
    x.annual_interest_rate, x.due_date, x.payment_status,
    coalesce(x.minimum_payment_only, false), x.notes
  from jsonb_to_recordset(coalesce(p_debts, '[]'::jsonb)) as x(
    id text,
    title text,
    category text,
    total_amount numeric,
    monthly_payment numeric,
    annual_interest_rate numeric,
    due_date date,
    payment_status text,
    minimum_payment_only boolean,
    notes text
  )
  on conflict (user_id, id) do update set
    title = excluded.title,
    category = excluded.category,
    total_amount = excluded.total_amount,
    monthly_payment = excluded.monthly_payment,
    annual_interest_rate = excluded.annual_interest_rate,
    due_date = excluded.due_date,
    payment_status = excluded.payment_status,
    minimum_payment_only = excluded.minimum_payment_only,
    notes = excluded.notes,
    updated_at = now();

  delete from public.work_days w
  where w.user_id = v_user_id
    and not exists (
      select 1
      from jsonb_to_recordset(coalesce(p_work_days, '[]'::jsonb)) as x(date date)
      where x.date = w.date
    );

  insert into public.work_days (
    user_id, date, type, shift, hours_worked, daily_earnings, notes
  )
  select
    v_user_id, x.date, x.type, coalesce(x.shift, 'diurno'), x.hours_worked, x.daily_earnings, x.notes
  from jsonb_to_recordset(coalesce(p_work_days, '[]'::jsonb)) as x(
    date date,
    type text,
    shift text,
    hours_worked numeric,
    daily_earnings numeric,
    notes text
  )
  on conflict (user_id, date) do update set
    type = excluded.type,
    shift = excluded.shift,
    hours_worked = excluded.hours_worked,
    daily_earnings = excluded.daily_earnings,
    notes = excluded.notes,
    updated_at = now();

  return v_next;
end;
$$;

revoke all on function public.save_finance_state(jsonb, jsonb, jsonb, jsonb, bigint) from public;
grant execute on function public.save_finance_state(jsonb, jsonb, jsonb, jsonb, bigint) to authenticated;

grant select, insert, update, delete on public.finance_settings to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
grant select, insert, update, delete on public.debts to authenticated;
grant select, insert, update, delete on public.work_days to authenticated;
