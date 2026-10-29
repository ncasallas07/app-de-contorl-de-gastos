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
Supabase Cron (5:00 a. m. Bogotá)
  └─ POST /functions/v1/agent-run  (encabezado x-agent-secret)
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
  agent.sql                 tablas del agente, seguridad (RLS) y cron
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

3. **Secretos de la función.** Inventa un secreto largo para el cron y, si
   quieres correos, crea una clave en [Resend](https://resend.com):

   ```bash
   npx supabase secrets set AGENT_CRON_SECRET=<secreto-largo-inventado>
   npx supabase secrets set RESEND_API_KEY=<clave-de-resend>   # opcional
   ```

   Sin dominio propio, Resend solo entrega correos a la dirección con la que
   creaste tu cuenta de Resend. Para la demo es suficiente.
   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya existen dentro de la
   función; nunca los pongas en el código ni en variables `VITE_*`.

4. **Desplegar:**

   ```bash
   npx supabase functions deploy agent-run --no-verify-jwt
   ```

   `--no-verify-jwt` es necesario porque el cron no inicia sesión como usuario;
   la función se protege con el encabezado `x-agent-secret`.

5. **Probar a mano** (puedes simular otra fecha con `today`):

   ```bash
   curl -X POST "https://<TU-PROJECT-REF>.supabase.co/functions/v1/agent-run" \
     -H "Content-Type: application/json" \
     -H "x-agent-secret: <secreto-largo-inventado>" \
     -d '{"today": "2026-11-10"}'
   ```

   Respuesta esperada: `{"today":"2026-11-10","users":1,"newActions":1,"errors":[]}`.
   Las alertas quedan en la tabla `agent_actions` y cada ejecución en `agent_runs`.

6. **Programar la ejecución diaria.** Al final de `supabase/agent.sql` está el
   bloque de Supabase Cron comentado. Quita los `--`, reemplaza los dos valores
   entre `<...>` y ejecútalo en el SQL Editor (no guardes esos valores en el
   repositorio).

## Pruebas

```bash
npm run agent:test     # 15 pruebas: reglas del vigilante, fechas y orquestador
npm run agent:check    # revisión de tipos de la función
```

Las pruebas usan una base de datos en memoria, así que no necesitan Supabase
ni internet.
