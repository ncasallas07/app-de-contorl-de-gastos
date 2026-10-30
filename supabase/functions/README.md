# Agente coach financiero de FinSmart

Agente autónomo que corre en el servidor de Supabase una vez al día, revisa las
finanzas de cada usuario y actúa sin que el usuario abra la app.

Está construido por capas, de menor a mayor complejidad (Russell y Norvig):

| Capa | Tipo de agente | Archivo | Estado |
| --- | --- | --- | --- |
| 1. Vigilante de vencimientos | Reactivo simple | `_shared/agents/watcher.ts` | Listo |
| 2. Cierre de ciclo | Basado en modelo | `_shared/agents/cycle.ts` | Listo |
| 3. Planificador sin deudas | Basado en objetivos | `_shared/agents/planner.ts` | Listo |
| 4. Asesor de nómina | Basado en utilidad | `_shared/agents/payroll.ts` | Listo |
| 5. Detector de gastos hormiga | Que aprende | `_shared/agents/antLearner.ts` | Listo |

## Cómo funciona

```
Supabase Cron (5:00 a. m. Bogotá) → public.run_finsmart_agent()
  └─ POST /functions/v1/agent-run  (x-agent-secret, leído de Vault)
       └─ orchestrator.ts: para cada usuario
            1. percibe: contrato, balance, deudas, jornadas y su memoria (agent_state)
            2. capa 2 (modelo): suma pagos y renueva cuotas → agent_apply_cycle (atómico)
            3. capa 3 (objetivos): replanifica hacia la meta → agent_replace_plan
            4. capa 4 (utilidad): si hoy hubo pago, recomienda cómo repartirlo
            5. capa 5 (aprendizaje): reentrena el detector, pronostica el mes y señala gastos
            6. capa 1 (reactivo): revisa vencimientos sobre el estado ya actualizado
            7. actúa: guarda en agent_actions y envía un correo con lo urgente
            8. registra la ejecución en agent_runs
```

El orden es a propósito: primero el agente actualiza su modelo del mundo,
luego replanifica hacia su meta con ese estado y al final las reglas
reactivas revisan los vencimientos.

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
- **Capa 3 (planificador sin deudas):** la meta es "sin deudas en N meses"
  (`agent_goals`, la fija el usuario en Estrategia; si no hay, 12 meses).
  Simula mes a mes cada deuda (interés = saldo × tasa anual ÷ 12), paga las
  cuotas mínimas, dirige el abono extra a la deuda prioritaria según el método
  (avalancha o bola de nieve) y suma al abono la cuota de cada deuda que termina.
  Con búsqueda binaria encuentra el **menor abono extra mensual** que cumple la
  meta y lo compara con lo que queda libre (ingreso − gasto promedio de 90
  días − cuotas mínimas). Si no alcanza, arma el mejor plan posible y propone
  ampliar la meta o cuánto recortar. Guarda el calendario en `debt_plans` y
  solo avisa cuando el plan cambia de verdad.
  La simulación vive en `src/utils/debtPlanner.ts` y es la misma que usa la
  pantalla "Plan sin deudas" de la app.
- **Capa 4 (asesor de nómina):** se activa el día en que la capa 2 suma un
  pago. Del pago separa los gastos y cuotas del periodo y compara repartos del
  disponible (en pasos de 5 % y el abono exacto que pide la capa 3) entre
  abono extra a la deuda prioritaria y colchón de emergencia. Elige el de
  mayor **utilidad en pesos a 12 meses**:

  `U = abono × ((1 + tasa mensual)^12 − 1) − K × faltante² ÷ colchón meta`

  El primer término son los intereses que se ahorran; el segundo, el costo
  esperado de quedarse sin colchón (K = costo a un año de un crédito caro,
  mínimo 30 % anual). Es cuadrático para que la utilidad del ahorro sea
  decreciente: con tasas iguales, el óptimo llena el colchón hasta la mitad y
  luego abona. El colchón meta lo fija el usuario (`agent_goals.emergency_fund_min`)
  o es un mes de gastos y cuotas. La lógica vive en `src/utils/payrollAdvisor.ts`
  y la pantalla "Asesor de nómina" de Estrategia la usa en vivo.
- **Capa 5 (detector que aprende):** un clasificador bayesiano ingenuo (Naive
  Bayes) con las palabras del concepto y el rango del monto, con suavizado de
  Lidstone (0,1). Parte de ~36 ejemplos semilla (peso 1); los gastos del
  usuario pesan 2 y sus correcciones (`agent_feedback`) pesan 3. Tiene las
  cuatro partes de un agente que aprende:
  - *elemento de desempeño:* en la app sugiere categoría y si es hormiga
    mientras se escribe el concepto;
  - *crítico:* al guardar se registra si la sugerencia se aceptó o se corrigió,
    y se mide el porcentaje de aciertos (total y últimas 10);
  - *elemento de aprendizaje:* cada noche el agente se reentrena con todo;
  - *generador de problemas:* señala gastos recientes no marcados que parecen
    hormiga (evaluados con un modelo que no los usó para entrenar).
  Además pronostica el gasto hormiga del mes (ritmo diario × días del mes) y
  avisa desde el día 7 si supera el 5 % del ingreso (alerta por correo desde el
  10 %). La lógica vive en `src/utils/antLearner.ts`; la tarjeta "Detector que
  aprende" está en Gastos.
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
  telegram.sql              vinculación con Telegram y secreto del webhook
  functions/
    deno.json               tareas de Deno (test, check, lint)
    agent-run/index.ts      punto de entrada (Edge Function)
    telegram-bot/index.ts   bot de Telegram (webhook y administración)
    _shared/
      orchestrator.ts       ejecuta las capas en orden
      agents/watcher.ts     capa 1
      agents/cycle.ts       capa 2
      agents/planner.ts     capa 3 (usa finance/debtPlanner.ts)
      agents/payroll.ts     capa 4 (usa finance/payrollAdvisor.ts)
      agents/antLearner.ts  capa 5 (usa finance/antLearner.ts)
      supabaseStore.ts      lectura y escritura en Postgres
      notify.ts             correos con Resend
      telegram.ts           API de Telegram y resumen de alertas
      telegramBot.ts        respuestas del bot (comandos y botones)
      botViews.ts           textos del bot: resumen, deudas, plan y gastos
      auth.ts               verificación del secreto del cron
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

7. **Alertas por Telegram (opcional).**
   1. En Telegram, crea un bot con [@BotFather](https://t.me/BotFather)
      (`/newbot`). Te entrega un token: **no lo pegues en ningún chat ni en el
      código**; guárdalo directamente como secreto:

      ```bash
      npx supabase secrets set TELEGRAM_BOT_TOKEN=<token-de-botfather>
      npx supabase functions deploy telegram-bot --no-verify-jwt --use-api
      npx supabase functions deploy agent-run --no-verify-jwt --use-api
      ```

   2. Ejecuta completo `supabase/telegram.sql` en el SQL Editor y luego:

      ```sql
      select public.telegram_setup();   -- conecta el bot con la función
      select status_code, content from net._http_response order by created desc limit 1;
      ```

      Respuesta esperada: `{"ok":true,"bot":"@TuBot"}`.
   3. En la app: *Ajustes de cuenta > Alertas por Telegram > Conectar
      Telegram*. Se abre el bot con un código de un solo uso (vence en 10
      minutos); al pulsar *Iniciar* queda vinculado.
   4. `select public.telegram_test();` envía un mensaje de prueba.

   Desde ahí, cada ejecución del agente manda **un solo mensaje** con todo lo
   nuevo, de lo más urgente a lo menos. Si nada es urgente llega en silencio.

   Lo que se le puede escribir al bot:

   | Mensaje | Qué hace |
   |---|---|
   | `/resumen` | saldo, próximo pago, gastos y gastos hormiga del mes, próxima cuota |
   | `/deudas` | deudas activas ordenadas por vencimiento |
   | `/plan` | plan sin deudas (capa 3): fecha de salida y pagos del mes |
   | `tinto 3500`, `almuerzo $15.000`, `uber 12k` o `/gasto ...` | registra un gasto |

   Al registrar un gasto, el detector de la capa 5 sugiere la categoría y si es
   hormiga; la persona confirma o corrige con botones y el agente aprende de la
   corrección. El gasto se guarda en una sola transacción (`telegram_save_draft`):
   descuenta el saldo y sube `state_version`, así la app recarga en vez de
   pisarlo. El botón *Deshacer* lo revierte.
   El bot solo responde en chats privados y a cuentas vinculadas; Telegram
   firma cada mensaje con un secreto que vive en Vault.

## Pruebas

```bash
npm run agent:test     # 92 pruebas: las 5 capas, fechas, orquestador y bot de Telegram
npm run agent:check    # revisión de tipos de la función
```

Las pruebas usan una base de datos en memoria, así que no necesitan Supabase
ni internet.
