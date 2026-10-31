import { deepStrictEqual as assertEquals } from 'node:assert/strict';
import { cleanMerchant, fingerprint, merchantKey, parseBankAmount, parseBankMessage } from '../_shared/banks.ts';

Deno.test('montos de cada banco', () => {
  assertEquals(parseBankAmount('3.900,00'), 3_900);
  assertEquals(parseBankAmount('$93,800'), 93_800);
  assertEquals(parseBankAmount('$7.671,00'), 7_671);
  assertEquals(parseBankAmount('1.250.000'), 1_250_000);
  assertEquals(parseBankAmount('$12,000.50'), 12_001);
  assertEquals(parseBankAmount('abc'), null);
  assertEquals(parseBankAmount('0'), null);
});

Deno.test('comercios limpios y comparables', () => {
  assertEquals(cleanMerchant('GOOGLE *Google One'), 'Google One');
  assertEquals(cleanMerchant('GOPASS.'), 'Gopass');
  assertEquals(cleanMerchant('APPLE.COM/BILL'), 'Apple.com/bill');
  assertEquals(merchantKey(cleanMerchant('GOOGLE *GOOGLE ONE')), merchantKey('Google One'));
  assertEquals(merchantKey('Café Ñ'), 'cafen');
});

Deno.test('Nequi: compra y cobro rechazado (avisos reales)', () => {
  assertEquals(parseBankMessage('NEQUI: Pagaste 3.900,00 en GOOGLE *Google One', '890806'),
    { bank: 'Nequi', kind: 'compra', amount: 3_900, merchant: 'Google One', title: 'Google One' });
  assertEquals(parseBankMessage('NEQUI: No te alcanzo para pagar 3.900,00 en APPLE.COM/BILL'),
    { bank: 'Nequi', kind: 'rechazo', amount: 3_900, merchant: 'Apple.com/bill', title: 'Apple.com/bill' });
});

Deno.test('Daviplata: tarjeta, QR e ingresos (avisos reales)', () => {
  assertEquals(parseBankMessage('DaviPlata: Pagaste $93,800 con tu Tarjeta Debito Digital terminada en 1234. Si no fuiste tu llama al 3383838'),
    { bank: 'Daviplata', kind: 'compra', amount: 93_800, merchant: null, title: 'Compra con tarjeta Daviplata' });
  assertEquals(parseBankMessage('DaviPlata: tu compra de $12,000 por codigo QR fue exitosa. Consulta tus movimientos'),
    { bank: 'Daviplata', kind: 'compra', amount: 12_000, merchant: null, title: 'Pago QR Daviplata' });
  assertEquals(parseBankMessage('DaviPlata: Recibiste plata por BreB por valor de $18,000. Consulta tus movimientos', '85888'),
    { bank: 'Daviplata', kind: 'ingreso', amount: 18_000, merchant: null, title: 'Ingreso Daviplata' });
  assertEquals(parseBankMessage('Recibiste $30,000. Para saber mas, consulta tus movimientos.', '85888'),
    { bank: 'Daviplata', kind: 'ingreso', amount: 30_000, merchant: null, title: 'Ingreso Daviplata' });
});

Deno.test('Nu: falta de fondos (correo real)', () => {
  assertEquals(parseBankMessage('Faltan fondos para pagar $7.671,00 en GOPASS.', 'notificaciones@nu.com.co'),
    { bank: 'Nu', kind: 'rechazo', amount: 7_671, merchant: 'Gopass', title: 'Gopass' });
});

Deno.test('lector general: Davivienda y envíos', () => {
  const compra = parseBankMessage('Davivienda: Compra por $45.000 en EXITO CALLE 80 aprobada.');
  assertEquals([compra?.bank, compra?.kind, compra?.amount], ['Davivienda', 'compra', 45_000]);
  const envio = parseBankMessage('NEQUI: Enviaste $50.000 a Juan Perez');
  assertEquals([envio?.kind, envio?.amount, envio?.merchant], ['envio', 50_000, 'Juan Perez']);
});

Deno.test('descarta códigos de seguridad, promociones y textos sin monto', () => {
  assertEquals(parseBankMessage('NEQUI: Tu codigo de seguridad es 482913. No lo compartas.'), null);
  assertEquals(parseBankMessage('DaviPlata: Usa la clave 4821 para tu retiro'), null);
  assertEquals(parseBankMessage('Gana hasta $500.000 con tu compra en tiendas aliadas'), null);
  assertEquals(parseBankMessage('NEQUI: Pagaste en GOOGLE'), null);
  assertEquals(parseBankMessage('Hola, ¿cómo estás?'), null);
});

Deno.test('la huella ignora mayúsculas y prefijos del comercio', () => {
  const a = parseBankMessage('NEQUI: Pagaste 3.900,00 en GOOGLE *Google One')!;
  const b = parseBankMessage('NEQUI: Pagaste 3.900,00 en GOOGLE *GOOGLE ONE')!;
  assertEquals(fingerprint(a), fingerprint(b));
});
