/**
 * FinSmart · reenvía al agente los correos de los bancos (fase 2, sesión 5):
 * Nu, Nequi, Davivienda y Daviplata.
 *
 * Corre en Google Apps Script con TU cuenta de Gmail: no necesita dominio,
 * servidor de correo ni reenvíos. Cada 5 minutos busca correos nuevos de los bancos y
 * manda el asunto y el comienzo del texto a la función bank-ingest. Solo lee
 * los correos que coinciden con BUSQUEDA; nunca borra ni responde nada.
 *
 * Instalación (docs/correo.md):
 *   1. script.google.com > Nuevo proyecto > pega este archivo.
 *   2. Configuración del proyecto > Propiedades del script:
 *        FINSMART_TOKEN = tu token fs_... (de la app)
 *   3. Ejecuta instalar() una vez y acepta los permisos.
 */

const URL_FINSMART = 'https://usqzqmudjouxkoivwfth.supabase.co/functions/v1/bank-ingest';

/**
 * Correos de los bancos de los últimos 2 días, sin la pestaña Promociones
 * (publicidad). Si un banco te escribe desde otro dominio, agrégalo aquí.
 * Si el mismo movimiento llega por SMS y por correo, FinSmart lo registra
 * una sola vez.
 */
const REMITENTES = ['nu.com.co', 'nubank.com.co', 'nequi.com.co', 'davivienda.com', 'daviplata.com'];
const BUSQUEDA = '(' + REMITENTES.map((r) => 'from:' + r).join(' OR ') + ') newer_than:2d -category:promotions';

/** Cuántos ids de correos ya enviados se recuerdan (evita reenviar). */
const MAX_RECORDADOS = 300;
const MAX_TEXTO = 1500;

/** Ejecútalo una vez: crea la revisión automática cada 5 minutos. */
function instalar() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'revisarCorreos')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('revisarCorreos').timeBased().everyMinutes(5).create();
  revisarCorreos();
  console.log('Listo: FinSmart revisará los correos de tus bancos cada 5 minutos.');
}

/** Ejecútalo si quieres detener la revisión automática. */
function desinstalar() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'revisarCorreos')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  console.log('FinSmart ya no revisará tus correos.');
}

/** Asunto + cuerpo en texto plano, sin espacios de sobra, recortado. */
function textoDelCorreo(asunto, cuerpo) {
  const limpio = String(cuerpo || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  return ('Asunto: ' + String(asunto || '').trim() + '\n' + limpio).slice(0, MAX_TEXTO);
}

function revisarCorreos() {
  const props = PropertiesService.getScriptProperties();
  const token = String(props.getProperty('FINSMART_TOKEN') || '').trim();
  if (!token.startsWith('fs_')) {
    throw new Error('Falta FINSMART_TOKEN en Propiedades del script (empieza por fs_).');
  }

  const enviados = JSON.parse(props.getProperty('FINSMART_ENVIADOS') || '[]');
  const yaEnviado = new Set(enviados);
  const nuevos = [];

  for (const hilo of GmailApp.search(BUSQUEDA, 0, 30)) {
    for (const correo of hilo.getMessages()) {
      const id = correo.getId();
      if (yaEnviado.has(id)) continue;

      const respuesta = UrlFetchApp.fetch(URL_FINSMART, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-finsmart-token': token },
        payload: JSON.stringify({
          text: textoDelCorreo(correo.getSubject(), correo.getPlainBody()),
          sender: correo.getFrom(),
          source: 'correo',
        }),
        muteHttpExceptions: true,
      });
      const estado = respuesta.getResponseCode();

      if (estado === 401) {
        // Token mal copiado o reemplazado: no tiene sentido seguir intentando.
        throw new Error('FinSmart rechazó el token: ' + respuesta.getContentText());
      }
      if (estado >= 500) {
        console.warn('FinSmart no respondió (' + estado + '); se reintenta en 5 minutos.');
        continue;
      }
      console.log(correo.getSubject() + ' → ' + respuesta.getContentText());
      nuevos.push(id);
      yaEnviado.add(id);
    }
  }

  if (nuevos.length > 0) {
    props.setProperty('FINSMART_ENVIADOS', JSON.stringify(enviados.concat(nuevos).slice(-MAX_RECORDADOS)));
  }
}
