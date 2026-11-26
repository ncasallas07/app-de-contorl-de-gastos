# Enviar los correos de los bancos al agente

Nu avisa por correo, no por SMS, y Nequi y Davivienda también envían correos.
Un script de Google Apps Script corre con tu propia cuenta de Gmail, revisa
cada 5 minutos los correos nuevos de esos bancos y manda
el asunto y el comienzo del texto a la función `bank-ingest`. No hace falta
dominio, servidor de correo ni reglas de reenvío, y es gratis.

El script solo lee los correos de `nu.com.co`, `nubank.com.co`,
`nequi.com.co`, `davivienda.com` y `daviplata.com` de los últimos 2 días que
no estén en la pestaña Promociones; nunca borra, mueve ni responde correos.

Si un movimiento llega por SMS y también por correo, FinSmart lo registra una
sola vez: compara banco, tipo y monto en una ventana de 30 minutos.

## Instalación (una sola vez, desde el computador)

1. Entra a <https://script.google.com> con la cuenta de Gmail donde te llegan
   los correos de los bancos y crea un **Nuevo proyecto**. Llámalo `FinSmart correos`.
2. Borra lo que trae el editor y pega todo
   [`scripts/gmail/finsmart-correos.gs`](../scripts/gmail/finsmart-correos.gs).
   Guarda (Ctrl + S).
3. **Configuración del proyecto** (engranaje) > **Propiedades del script** >
   **Agregar propiedad**:
   - Propiedad: `FINSMART_TOKEN`
   - Valor: tu token `fs_…` (Ajustes de la app > Avisos de los bancos). Puede
     ser el mismo de los celulares.
4. Vuelve al **Editor**, elige la función `instalar` arriba y toca
   **Ejecutar**. Google pide permisos: *Revisar permisos* > tu cuenta >
   *Configuración avanzada* > *Ir a FinSmart correos (no seguro)* > *Permitir*.
   El aviso "no seguro" sale porque el script es tuyo y no está publicado;
   los permisos son leer Gmail y conectarse a internet.
5. En **Activadores** (reloj) debe aparecer `revisarCorreos`, cada 5 minutos.

## Comprobar

- **Ejecuciones** (lista) muestra cada revisión; con un correo de Nu verás
  `Asunto → {"status":"enviado",...}`.
- Si un banco te escribe desde otro dominio, abre uno de sus correos en
  Gmail, mira la dirección y agrégala a `REMITENTES` al comienzo del script.
- Para detenerlo: ejecuta `desinstalar`.

## Qué pasa con cada correo

Lo mismo que con los SMS: una compra llega a Telegram como borrador para
confirmar, un "Faltan fondos" se avisa sin registrar gasto (y si se repite,
alerta de suscripción olvidada), y un mismo correo nunca se envía dos veces
(el script recuerda los ya enviados y el servidor descarta duplicados).
