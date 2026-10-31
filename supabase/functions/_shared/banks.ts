// Lectores de los avisos de los bancos (SMS y correo).
//
// Formatos confirmados con avisos reales (octubre de 2026):
//   Nequi (SMS 890806)
//     "NEQUI: Pagaste 3.900,00 en GOOGLE *Google One"
//     "NEQUI: No te alcanzo para pagar 3.900,00 en APPLE.COM/BILL"
//   Daviplata (SMS 85888)
//     "DaviPlata: Pagaste $93,800 con tu Tarjeta Debito Digital..."
//     "DaviPlata: tu compra de $12,000 por codigo QR fue exitosa..."
//     "DaviPlata: Recibiste plata por BreB por valor de $18,000..."
//     "Recibiste $30,000. Para saber mas, consulta tus movimientos."
//   Nu (correo)
//     "Faltan fondos para pagar $7.671,00 en GOPASS."
//   Davivienda: sin ejemplos; usa el lector general.
//
// Solo se lee el texto del aviso: el agente nunca usa claves ni entra al banco.
// Los mensajes con códigos de seguridad se descartan sin guardarse.

export type BankName = 'Nequi' | 'Daviplata' | 'Nu' | 'Davivienda' | 'Banco';

export type BankEventKind = 'compra' | 'envio' | 'rechazo' | 'ingreso';

export interface BankEvent {
  bank: BankName;
  kind: BankEventKind;
  amount: number;
  /** Comercio o persona, tal como viene (limpio), o null si el aviso no lo dice. */
  merchant: string | null;
  /** Título para el gasto: el comercio o una descripción del medio de pago. */
  title: string;
}

const MAX_AMOUNT = 100_000_000;

/**
 * Montos de los bancos colombianos:
 *   "3.900,00" (Nequi, Nu) → 3900 · "$93,800" (Daviplata) → 93800 ·
 *   "1.250.000" → 1250000 · "12,000.50" → 12000.5
 */
export function parseBankAmount(raw: string): number | null {
  const text = raw.replace(/[$\s]/g, '');
  if (!/^\d[\d.,]*$/.test(text)) return null;

  let normalized: string;
  const decimal = /^(.*\d)([.,])(\d{1,2})$/.exec(text);
  if (decimal) {
    // Termina en 1 o 2 dígitos después de un separador: son centavos.
    normalized = `${decimal[1].replace(/[.,]/g, '')}.${decimal[3]}`;
  } else {
    normalized = text.replace(/[.,]/g, '');
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) return null;
  return Math.round(value);
}

/** Primer monto del texto: "$93,800", "3.900,00", "COP 12.000". */
function firstAmount(text: string): number | null {
  const match = /(?:\$|COP\s?)?\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i.exec(text);
  return match ? parseBankAmount(match[1]) : null;
}

/** "GOOGLE *Google One" → "Google One" · "GOPASS" → "Gopass" · "APPLE.COM/BILL" → "Apple.com/bill". */
export function cleanMerchant(raw: string): string | null {
  let text = raw.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
  // Los procesadores de pago ponen "EMPRESA *Producto": lo útil es el producto.
  if (text.includes('*')) {
    const after = text.split('*').pop()!.trim();
    if (after) text = after;
  }
  text = text.slice(0, 60).trim();
  if (!text) return null;
  if (text === text.toUpperCase() && /[A-Z]/.test(text)) {
    text = text.toLowerCase().replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase());
  }
  return text;
}

/** Clave para comparar comercios: "Google One" y "GOOGLE *GOOGLE ONE" → "googleone". */
export function merchantKey(merchant: string | null): string {
  return (merchant ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function detectBank(text: string, sender?: string | null): BankName {
  const from = (sender ?? '').toLowerCase();
  if (from.includes('890806') || /^\s*nequi\b/i.test(text) || /\bnequi\b/i.test(from)) return 'Nequi';
  if (from.includes('85888') || /daviplata/i.test(text) || from.includes('daviplata')) return 'Daviplata';
  if (/(^|[^a-z])nu\.com\.co|nubank/i.test(from) || /\b(nu colombia|nubank|tu cuenta nu|tarjeta nu)\b/i.test(text)) return 'Nu';
  if (from.includes('davivienda') || /davivienda/i.test(text)) return 'Davivienda';
  return 'Banco';
}

// Mensajes que nunca son movimientos: códigos, claves, promociones.
const SENSITIVE = /\b(c[oó]digo|clave|otp|token|contrase[nñ]a|pin)\b.*\b(\d{4,8})\b|\b(\d{4,8})\b.*\b(c[oó]digo|clave|otp|token)\b/i;
const PROMO = /\b(gana|participa|promoci[oó]n|descuento|cr[eé]dito pre-?aprobado|oferta)\b/i;

const REJECTED = /(no te alcanz[oó]|faltan fondos|fondos insuficientes|saldo insuficiente|rechaz|declinad|no (?:fue|pudo ser) (?:aprobad|exitos))/i;
const INCOME = /\b(recibiste|te (?:enviaron|consignaron|transfirieron|lleg[oó])|abono a tu cuenta|consignaci[oó]n recibida)\b/i;
const SENT = /\b(enviaste|transferiste|pasaste plata|retiraste|retiro)\b/i;
const PURCHASE = /\b(pagaste|compraste|tu compra|compra (?:aprobada|por|de|en)|pago (?:aprobado|exitoso|de|en)|hiciste un pago|cobro)\b/i;

/** Lo que viene después de " en " o " a " hasta el final de la frase. */
function after(text: string, word: 'en' | 'a'): string | null {
  const match = new RegExp(`\\s${word}\\s+([^\\n]+?)(?:\\.(?:\\s|$)|,\\s|\\s+con\\s+tu|\\s+por\\s+|$)`, 'i').exec(text);
  return match ? cleanMerchant(match[1]) : null;
}

function defaultTitle(bank: BankName, kind: BankEventKind, text: string): string {
  if (/c[oó]digo qr|\bqr\b/i.test(text)) return `Pago QR ${bank}`;
  if (/retir/i.test(text)) return `Retiro ${bank}`;
  if (/tarjeta/i.test(text)) return `Compra con tarjeta ${bank}`;
  if (kind === 'envio') return `Envío ${bank}`;
  return `Compra ${bank}`;
}

/**
 * Lee un aviso. Devuelve null si no es un movimiento de dinero (códigos de
 * seguridad, promociones, avisos sin monto).
 */
export function parseBankMessage(raw: string, sender?: string | null): BankEvent | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 2000) return null;
  if (SENSITIVE.test(text)) return null;

  const bank = detectBank(text, sender);
  // El prefijo "NEQUI:" o "DaviPlata:" no es parte del mensaje.
  const body = text.replace(/^\s*(nequi|daviplata|davivienda|nu)\s*:\s*/i, '');

  let kind: BankEventKind;
  if (REJECTED.test(body)) kind = 'rechazo';
  else if (INCOME.test(body)) kind = 'ingreso';
  else if (SENT.test(body)) kind = 'envio';
  else if (PURCHASE.test(body)) kind = 'compra';
  else return null;

  if (kind !== 'rechazo' && PROMO.test(body) && !/\b(pagaste|recibiste|enviaste)\b/i.test(body)) return null;

  // El monto que importa va después del verbo ("de $12,000", "pagar 3.900,00").
  const amount = firstAmount(body);
  if (amount === null) return null;

  let merchant: string | null = null;
  if (kind === 'ingreso') {
    const from = /\bde\s+([A-ZÁÉÍÓÚÑ][\p{L} ]{2,40}?)(?:\.|,|\s+por\s|\s+el\s|$)/u.exec(body);
    merchant = from ? cleanMerchant(from[1]) : null;
  } else if (kind === 'envio') {
    merchant = after(body, 'a');
  } else {
    merchant = after(body, 'en');
  }
  // "en efectivo", "en tu cuenta" no son comercios.
  // ("terminada en 1234" es la tarjeta, no un comercio.)
  if (merchant && (/^(efectivo|tu |su |la cuenta|cuenta|linea|línea)/i.test(merchant) || /^[\d\s*-]+$/.test(merchant))) {
    merchant = null;
  }

  const title = merchant ?? (kind === 'ingreso' ? `Ingreso ${bank}` : defaultTitle(bank, kind, body));
  return { bank, kind, amount, merchant, title };
}

/** Huella para reconocer el mismo aviso llegando a dos celulares. */
export function fingerprint(event: BankEvent): string {
  return [event.bank, event.kind, event.amount, merchantKey(event.merchant)].join('|');
}
