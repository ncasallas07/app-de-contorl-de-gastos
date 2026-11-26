// Prueba del script de Gmail con Gmail, propiedades y red simulados.
const fs = require('fs'); const vm = require('vm'); const assert = require('assert/strict');
const code = fs.readFileSync(require('path').join(__dirname, 'finsmart-correos.gs'), 'utf8');
function run({ token = 'fs_' + 'a'.repeat(64), status = 200 } = {}, props = {}) {
  const calls = []; const store = { FINSMART_TOKEN: token, ...props };
  const mail = (id, subject, body) => ({ getId: () => id, getSubject: () => subject, getPlainBody: () => body, getFrom: () => 'Nu <notificaciones@nu.com.co>' });
  const ctx = {
    console: { log() {}, warn() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store[k] ?? null, setProperty: (k, v) => { store[k] = v; } }) },
    GmailApp: { search: () => [{ getMessages: () => [mail('m1', 'Pago rechazado', 'Hola Nelson,\n\n  Faltan fondos   para pagar $7.671,00 en GOPASS.'), mail('m2', 'Compra', 'Compraste $10.000,00 en X')] }] },
    UrlFetchApp: { fetch: (url, opts) => { calls.push({ url, opts }); return { getResponseCode: () => status, getContentText: () => '{"status":"enviado"}' }; } },
    ScriptApp: {},
  };
  vm.createContext(ctx); vm.runInContext(code, ctx); vm.runInContext('revisarCorreos()', ctx);
  return { calls, store };
}
let r = run();
assert.equal(r.calls.length, 2);
const body = JSON.parse(r.calls[0].opts.payload);
assert.equal(body.text, 'Asunto: Pago rechazado\nHola Nelson,\nFaltan fondos para pagar $7.671,00 en GOPASS.');
assert.equal(body.source, 'correo');
assert.equal(r.calls[0].opts.headers['x-finsmart-token'].length, 67);
assert.deepEqual(JSON.parse(r.store.FINSMART_ENVIADOS), ['m1', 'm2']);
r = run({}, { FINSMART_ENVIADOS: '["m1","m2"]' });
assert.equal(r.calls.length, 0, 'no reenvía los ya enviados');
r = run({ status: 503 });
assert.equal(r.store.FINSMART_ENVIADOS, undefined, 'si el servidor falla, se reintenta luego');
assert.throws(() => run({ status: 401 }), /rechazó el token/);
assert.throws(() => run({ token: '' }), /Falta FINSMART_TOKEN/);
console.log('ok: 6 comprobaciones del script de Gmail');
