# Enviar los SMS del banco al agente

Los SMS de Nequi (890806) y Daviplata (85888) llegan al celular. Una
automatización los reenvía a la función `bank-ingest` y el agente te propone el
gasto en Telegram. No se usan claves del banco: solo el texto del aviso.

Si configuras los dos celulares, cada aviso llega dos veces y el agente lo
registra una sola vez (huella de 10 minutos).

## Antes de empezar

En la app: **Ajustes de cuenta > Avisos de los bancos > Generar token**. Copia:

- **Dirección:** `https://<tu-proyecto>.supabase.co/functions/v1/bank-ingest`
- **Token:** empieza por `fs_`. Solo se muestra una vez; si lo pierdes, genera otro.

## Android con MacroDroid

1. Instala **MacroDroid** desde Play Store y dale los permisos que pida.
2. **Agregar macro** y ponle un nombre: `FinSmart bancos`.
3. **Disparador:** *Mensajería > SMS recibido*.
   - *Desde:* "Cualquier número" o, mejor, solo `890806` y `85888`.
   - *Contenido:* cualquiera.
   - Si tu versión no muestra *SMS recibido* (algunas lo limitan por políticas
     de Google), usa *Notificación > Notificación recibida*, elige la app de
     Mensajes y filtra por el texto `NEQUI` o `DaviPlata`.
4. **Acción:** *Conectividad > Solicitud HTTP*.
   - *Método:* `POST`.
   - *URL:* la dirección de arriba seguida de
     `?source=sms&sender=` y el número del remitente (botón de texto mágico,
     *Número del SMS*). Queda así:
     `https://…/functions/v1/bank-ingest?source=sms&sender=[sms_number]`
   - *Encabezados:* agrega `x-finsmart-token` con tu token.
   - *Cuerpo:* tipo `text/plain`, contenido: texto mágico *Mensaje del SMS*
     (`[sms_message]`). Si usaste el disparador de notificación, el texto
     mágico es el texto de la notificación.
5. Guarda la macro y verifica que esté activada.

Se usa texto plano a propósito: si el SMS trae comillas, un JSON armado a mano
se rompe; el texto plano llega tal cual.

## iPhone con Atajos

En iPhone las automatizaciones solo pueden filtrar por una palabra del mensaje,
así que se crea una por banco.

1. Abre **Atajos > Automatización > Nueva automatización > Mensaje**.
2. *El mensaje contiene:* `NEQUI`. Elige **Ejecutar inmediatamente** (sin
   preguntar) y toca **Siguiente**.
3. Agrega la acción **Obtener contenido de URL**:
   - *URL:* la dirección de arriba.
   - *Método:* `POST`.
   - *Encabezados:* `x-finsmart-token` = tu token.
   - *Cuerpo de la solicitud:* **JSON** con dos campos de texto:
     - `text` = variable **Entrada del atajo**; tócala y elige **Contenido**.
     - `source` = `sms`
4. Guarda. Repite para `DaviPlata`.

Nota: el aviso de Daviplata "Recibiste $30,000…" no trae la palabra DaviPlata,
así que en iPhone no se reenvía. En Android sí, porque ahí se filtra por el
número 85888.

## Comprobar que funciona

- En la app, *Avisos de los bancos* muestra el último aviso recibido.
- Haz una compra pequeña o pide una transferencia: el borrador debe llegar a
  Telegram en segundos.
- Si no llega: revisa que el token esté completo (sin espacios), que el método
  sea POST y que la URL termine en `/bank-ingest`. Respuestas de la función:
  `401` token incorrecto, `400` texto vacío, `200` con `"status"`:
  `enviado`, `duplicado` (ya llegó desde el otro celular) o `ignorado`
  (no era un movimiento, por ejemplo un código de seguridad).
