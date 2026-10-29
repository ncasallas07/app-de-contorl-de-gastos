# Agente coach financiero de FinSmart

Agente autónomo que corre en el servidor de Supabase una vez al día, revisa las
finanzas de cada usuario y actúa sin que el usuario abra la app.

Está construido por capas, de menor a mayor complejidad (Russell y Norvig):

| Capa | Tipo de agente | Archivo | Estado |
| --- | --- | --- | --- |
| 1. Vigilante de vencimientos | Reactivo simple | `_shared/agents/watcher.ts` | Listo |
| 2. Cierre de ciclo | Basado en modelo | `_shared/agents/cycle.ts` | Semana 2 |
| 3. Planificador sin deudas | Basado en objetivos | `_shared/agents/planner.ts` | Semana 3 |
| 4. Asesor de nómina | Basado en utilidad | `_shared/agents/payroll.ts` | Versión completa |
| 5. Detector de gastos hormiga | Que aprende | `_shared/agents/antLearner.ts` | Versión completa |

## Cómo funciona

```
Supabase Cron (5:00 a. m. Bogotá) → public.run_finsmart_agent()
  └─ POST /functions/v1/agent-run  (x-agent-secret, leído de Vault)
       └─ orchestrator.ts: para cada usuario
            1. percibe: lee sus deudas (y más datos en las siguientes capas)
            2. decide: cada capa devuelve acciones
            3. actúa: guarda en agent_actions y envía un correo con lo nuevo
            4. registra la ejecución en agent_runs
```

- **Capa 1 (vigilante):** reglas condición → acción. Avisa si una cuota
  pendiente vence en 3 días o menos, vence hoy o ya venció. No guarda memoria;
  la base de datos evita repetir la misma alerta (`dedupe_key` único), y si la
  situación empeora (de "próxima" a "hoy" o "vencida") llega un aviso nuevo.
- **Fechas:** el servidor corre en UTC, así que "hoy" se calcula en la zona
  `America/Bogota` (`_shared/zone.ts`).
- **Misma lógica que la app:** `_shared/finance/` es una copia generada de
  `src/types/finance.ts`, `src/utils/contract.ts` y `src/utils/date.ts`.
  Si cambias alguno de esos archivos, ejecuta `npm run agent:sync`.

### PEAS

| | |
| --- | --- |
| Medida de desempeño | Cuotas pagadas a tiempo, intereses ahorrados, salud financiera, avance hacia la meta |
| Entorno | Datos del usuario en Supabase y la fecha actual |
| Actuadores | Alertas en la app (`agent_actions`), correos, planes (`debt_plans`) |
| Sensores | Tablas `debts`, `expenses`, `work_days`, `finance_settings`; reloj |

## Estructura

```
supabase/
  agent.sql                 tablas del agente y seguridad (RLS)
  agent_cron.sql            secreto en Vault y ejecución diaria
  functions/
    deno.json               tareas de Deno (test, check, lint)
    agent-run/index.ts      punto de entrada (Edge Function)
    _shared/
      orchestrator.ts       ejecuta las capas en orden
      agents/watcher.ts     capa 1
      supabaseStore.ts      lectura y escritura en Postgres
      notify.ts             correos con Resend
      zone.ts               fechas en la zona de Bogotá
      agentTypes.ts         tipos comunes
      finance/              copia generada de la lógica de la app
    tests/                  pruebas (deno test)
scripts/agent/sync-shared.mjs
```

## Instalación

Necesitas Node 20+, [Deno 2](https://docs.deno.com/runtime/getting_started/installation/)
y una cuenta gratuita de [Supabase](https://supabase.com). La CLI de Supabase
se usa con `npx`, no hay que instalarla aparte. Docker solo hace falta si
quieres correr Supabase completo en tu computador.

1. **Base de datos.** En tu proyecto de Supabase, abre *SQL Editor* y ejecuta
   completos, en este orden: `supabase/schema.sql` y luego `supabase/agent.sql`.

2. **Vincular el proyecto** (el `project-ref` está en la URL del panel):

   ```bash
   npx supabase login
   npx supabase link --project-ref <TU-PROJECT-REF>
   ```

3. **Correos (opcional).** Si quieres que el agente envíe correos, crea una
   clave en [Resend](https://resend.com) y guárdala como secreto:

   ```bash
   npx supabase secrets set RESEND_API_KEY=<clave-de-resend>
   ```

   Sin dominio propio, Resend solo entrega correos a la dirección con la que
   creaste tu cuenta de Resend. Para la demo es suficiente. Sin esta clave el
   agente funciona igual: las alertas quedan en la app.
   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya existen dentro de la
   función; nunca los pongas en el código ni en variables `VITE_*`.

4. **Desplegar** (sin Docker):

   ```bash
   npx supabase functions deploy agent-run --no-verify-jwt --use-api
   ```

   `--no-verify-jwt` es necesario porque el cron no inicia sesión como usuario;
   la función se protege con el encabezado `x-agent-secret`.

5. **Ejecución diaria.** Abre `supabase/agent_cron.sql`, cambia
   `<TU-PROJECT-REF>` por el id de tu proyecto y ejecútalo completo en el SQL
   Editor. Ese script:
   - genera al azar el secreto que protege a `agent-run` y lo guarda en
     Supabase Vault (nadie tiene que copiarlo ni escribirlo);
   - crea `public.run_finsmart_agent()` para disparar el agente;
   - programa el agente todos los días a las 5:00 a. m. (hora de Bogotá).

6. **Probar a mano** (en el SQL Editor; sirve para la demo):

   ```sql
   select public.run_finsmart_agent();               -- como si fuera hoy
   select public.run_finsmart_agent('2026-11-10');   -- simular otra fecha

   -- unos segundos después, la respuesta del agente:
   select status_code, content from net._http_response order by created desc limit 1;
   ```

   Respuesta esperada: `{"today":"2026-11-10","users":1,"newActions":1,"errors":[]}`.
   Las alertas quedan en la tabla `agent_actions` y cada ejecución en `agent_runs`.

## Pruebas

```bash
npm run agent:test     # 15 pruebas: reglas del vigilante, fechas y orquestador
npm run agent:check    # revisión de tipos de la función
```

Las pruebas usan una base de datos en memoria, así que no necesitan Supabase
ni internet.
