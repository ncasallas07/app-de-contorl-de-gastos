-- FinSmart · ejecución automática del agente (Supabase Cron + Vault)
-- Ejecutar DESPUÉS de agent.sql y de desplegar la función agent-run.
-- Antes de ejecutarlo, cambia <TU-PROJECT-REF> en la sección 2 por el id
-- de tu proyecto (está en la URL del panel de Supabase).
-- Se puede ejecutar varias veces sin dañar nada.
--
-- Seguridad: el secreto que protege a agent-run se genera aquí al azar y
-- vive solo en Supabase Vault. Nadie lo copia ni lo escribe: el cron lo lee
-- del Vault y la función lo verifica con agent_check_secret().

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ------------------------------------------------------------
-- 1. Secreto del agente (solo se crea la primera vez)
-- ------------------------------------------------------------
select vault.create_secret(
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'agent_cron_secret',
  'Protege la Edge Function agent-run de FinSmart'
)
where not exists (select 1 from vault.secrets where name = 'agent_cron_secret');

-- ------------------------------------------------------------
-- 2. URL del proyecto (no es secreta, pero se guarda junto al secreto)
-- ------------------------------------------------------------
do $$
declare
  v_url text := 'https://<TU-PROJECT-REF>.supabase.co';
  v_id uuid;
begin
  if v_url like '%<%' then
    raise exception 'Cambia <TU-PROJECT-REF> por el id de tu proyecto antes de ejecutar';
  end if;
  select id into v_id from vault.secrets where name = 'project_url';
  if v_id is null then
    perform vault.create_secret(v_url, 'project_url', 'URL del proyecto FinSmart');
  else
    perform vault.update_secret(v_id, v_url);
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 3. La función agent-run pregunta aquí si el secreto recibido es correcto
--    (solo la puede llamar el servidor con service_role).
-- ------------------------------------------------------------
create or replace function public.agent_check_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from vault.decrypted_secrets
    where name = 'agent_cron_secret'
      and decrypted_secret = p_secret
      and length(coalesce(p_secret, '')) >= 32
  );
$$;

revoke all on function public.agent_check_secret(text) from public, anon, authenticated;
grant execute on function public.agent_check_secret(text) to service_role;

-- ------------------------------------------------------------
-- 4. Ejecutar el agente (lo usa el cron y sirve para la demo)
--    select public.run_finsmart_agent();               -- hoy
--    select public.run_finsmart_agent('2026-11-10');   -- simular una fecha
--    La respuesta llega unos segundos después; para verla:
--    select status_code, content from net._http_response order by created desc limit 1;
-- ------------------------------------------------------------
create or replace function public.run_finsmart_agent(p_today date default null)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/agent-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'agent_cron_secret')
    ),
    body := case
      when p_today is null then '{}'::jsonb
      else jsonb_build_object('today', to_char(p_today, 'YYYY-MM-DD'))
    end,
    timeout_milliseconds := 30000
  );
$$;

-- Solo el administrador (SQL Editor o cron) puede dispararlo.
revoke all on function public.run_finsmart_agent(date) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5. Programación diaria: 10:00 UTC = 5:00 a. m. en Bogotá
--    (cron.schedule con el mismo nombre reemplaza la programación anterior)
-- ------------------------------------------------------------
select cron.schedule(
  'finsmart-agent-diario',
  '0 10 * * *',
  'select public.run_finsmart_agent();'
);
