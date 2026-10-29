# Agente coach financiero de FinSmart

Agente autónomo que corre en el servidor de Supabase una vez al día, revisa las
finanzas de cada usuario y actúa sin que el usuario abra la app.

Está construido por capas, de menor a mayor complejidad (Russell y Norvig):

| Capa | Tipo de agente | Archivo | Estado |
| --- | --- | --- | --- |
| 1. Vigilante de vencimientos | Reactivo simple | `_shared/agents/watcher.ts` | Listo |
| 2. Cierre de ciclo | Basado en modelo | `_shared/agents/cycle.ts` | Listo |
| 3. Planificador sin deudas | Basado en objetivos | `_shared/agents/planner.ts` | Semana 3 |
| 4. Asesor de nómina | Basado en utilidad | `_shared/agents/payroll.ts` | Versión completa |
| 5. Detector de gastos hormiga | Que aprende | `_shared/agents/antLearner.ts` | Versión completa |

## Cómo funciona

```
Supabase Cron (5:00 a. m. Bogotá) → public.run_finsmart_agent()
  └─ POST /functions/v1/agent-run  (x-agent-secret, leído de Vault)
       └─ orchestrator.ts: para cada usuario
            1. percibe: contrato, balance, deudas, jornadas y su memoria (agent_state)
            2. capa 2 (modelo): suma pagos y renueva cuotas → agent_apply_cycle (atómico)
            3. capa 1 (reactivo): revisa vencimientos sobre el estado ya actualizado
            4. actúa: guarda en agent_actions y envía un correo con lo urgente
            5. registra la ejecución en agent_runs
```

La capa 2 va antes que la 1 a propósito: primero el agente actualiza su
modelo del mundo y luego las reglas reactivas actúan sobre ese estado.

- **Capa 1 (vigilante):** reglas condición → acción. Avisa si una cuota
  pendiente vence en 3 días o menos, vence hoy o ya venció. No guarda memoria;
  la base de datos evita repetir la misma alerta (`dedupe_key` único), y si la
  situación empeora (de "próxima" a "hoy" o "vencida") llega un aviso nuevo.
- **Capa 2 (cierre de ciclo):** guarda un modelo interno en `agent_state`: el
  último día de pago que ya aplicó. Con eso:
  - el día de pago suma la nómina al balance: mensual (salario completo),
    quincenal (mitad del salario el 15 y el último día del mes) u obra o labor
    (lo ganado en las jornadas registradas de los 7 días anteriores). Nunca
    aplica dos veces el mismo pago y, si el cron estuvo apagado, se pone al
    día con hasta 62 días hacia atrás;
  - cuando pasa la fecha de una cuota marcada como pagada, la renueva: la
    fecha avanza un mes y vuelve a quedar pendiente.
  - La primera vez no suma pagos pasados: el balance que el usuario escribió es
    el punto de partida.
- **Sin pisarse con la app:** `finance_settings.state_version` sube con cada
  guardado. La app guarda indicando la versión que cargó y el agente aplica sus
  cambios con `agent_apply_cycle` solo si nadie guardó desde que leyó. Si hay
  choque, la app recarga los datos y el agente lo reintenta al día siguiente.
  Al volver a la pestaña, la app revisa la versión y recarga si el agente
  cambió algo.
- **Bandeja en la app:** `src/components/AgentInbox.tsx` muestra en el Resumen
  las acciones sin leer, con su capa y prioridad.
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
      agents/cycle.ts       capa 2
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
   Si actualizas desde una versión anterior, vuelve a ejecutar los dos: se
   pueden ejecutar varias veces sin perder datos.

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

   Respuesta esperada: `{"today":"2026-11-10","users":1,"newActions":1,"balanceAdded":0,"errors":[]}`.
   Las alertas quedan en la tabla `agent_actions` y cada ejecución en `agent_runs`.

   **Cuidado al simular fechas:** si simulas un día de pago futuro, la capa 2
   suma ese pago de verdad y su memoria avanza hasta esa fecha. Para la demo usa
   una cuenta de prueba, no la tuya real.

## Pruebas

```bash
npm run agent:test     # 32 pruebas: vigilante, cierre de ciclo, fechas y orquestador
npm run agent:check    # revisión de tipos de la función
```

Las pruebas usan una base de datos en memoria, así que no necesitan Supabase
ni internet.
