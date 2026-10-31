import { deepStrictEqual as assertEquals, ok } from 'node:assert/strict';
import { type IngestDeps, processBankMessage, type RecordedEvent } from '../_shared/bankIngest.ts';
import type { AgentAction, StoredAction } from '../_shared/agentTypes.ts';
import { baseState, fakeBot } from './fake_bot.ts';

/** Recepción de avisos con base de datos en memoria y el bot falso para los botones. */
function setup(options: { telegram?: boolean } = {}) {
  const bot = fakeBot();
  bot.links.set(7, 'ana');
  const events: (RecordedEvent & { id: number; userId: string; at: number })[] = [];
  const actions: (StoredAction & { userId: string })[] = [];
  const sent: { chatId: number; text: string; keyboard?: unknown; silent?: boolean }[] = [];
  let clock = 0;
  let nextId = 1;

  const deps: IngestDeps = {
    recordEvent: (userId, event) => {
      const dup = events.some((e) => e.userId === userId && e.fingerprint === event.fingerprint && clock - e.at < 10);
      if (dup) return Promise.resolve(null);
      const id = nextId++;
      events.push({ ...event, id, userId, at: clock });
      if (event.kind === 'ingreso') bot.incomes.set(id, { userId, amount: event.amount, status: 'nuevo' });
      return Promise.resolve(id);
    },
    countRejections: (userId, key) =>
      Promise.resolve(events.filter((e) => e.userId === userId && e.kind === 'rechazo' && e.merchantKey === key).length),
    getTelegramChatId: (userId) => Promise.resolve(options.telegram === false ? null : userId === 'ana' ? 7 : null),
    loadState: (userId) => bot.deps.loadState(userId),
    createDraft: (userId, draft) => bot.deps.createDraft(userId, draft),
    send: (chatId, text, keyboard, silent) => {
      sent.push({ chatId, text, keyboard, silent });
      return Promise.resolve(true);
    },
    saveActions: (userId, list: AgentAction[]) => {
      const created = list.filter((a) => !actions.some((s) => s.userId === userId && s.dedupeKey === a.dedupeKey))
        .map((a) => ({ ...a, id: String(actions.length + 1), userId }));
      actions.push(...created);
      return Promise.resolve(created);
    },
    today: () => '2026-10-30',
  };
  const ingest = (text: string, sender?: string, userId = 'ana') =>
    processBankMessage({ userId, text, sender, source: 'sms' }, deps);
  const later = (minutes: number) => {
    clock += minutes;
  };
  return { bot, events, actions, sent, ingest, later };
}

Deno.test('compra de Nequi: borrador con sugerencia y botones, se guarda con un toque', async () => {
  const t = setup();
  const result = await t.ingest('NEQUI: Pagaste 3.900,00 en GOOGLE *Google One', '890806');
  assertEquals(result, { status: 'enviado', kind: 'compra', bank: 'Nequi', amount: 3_900 });
  const message = t.sent.at(-1)!;
  ok(message.text.includes('Nequi · ¿registro este gasto?'), message.text);
  ok(message.text.includes('Google One'));
  ok(message.text.includes('Suscripciones'), 'la capa 5 reconoce Google One como suscripción');

  await t.bot.tap(7, 's:dr1');
  const expense = t.bot.states.get('ana')!.expenses.at(-1)!;
  assertEquals([expense.title, expense.amount, expense.category], ['Google One', 3_900, 'suscripciones']);
});

Deno.test('el mismo aviso en el iPhone y en el Android se registra una sola vez', async () => {
  const t = setup();
  await t.ingest('NEQUI: Pagaste 3.900,00 en GOOGLE *Google One');
  const second = await t.ingest('NEQUI: Pagaste 3.900,00 en GOOGLE *Google One');
  assertEquals(second.status, 'duplicado');
  assertEquals(t.sent.length, 1);

  t.later(60);
  const otherDay = await t.ingest('NEQUI: Pagaste 3.900,00 en GOOGLE *Google One');
  assertEquals(otherDay.status, 'enviado', 'una compra igual una hora después sí es otra compra');
});

Deno.test('cobro rechazado: no es gasto; al segundo rechazo avisa la suscripción olvidada', async () => {
  const t = setup();
  await t.ingest('NEQUI: No te alcanzo para pagar 3.900,00 en APPLE.COM/BILL');
  assertEquals(t.sent.length, 1);
  ok(t.sent[0].text.includes('rechazó un cobro'));
  assertEquals(t.sent[0].silent, true);
  assertEquals(t.actions.length, 0);
  assertEquals(t.bot.drafts.size, 0, 'no propone gasto');

  t.later(60 * 24);
  await t.ingest('NEQUI: No te alcanzo para pagar 3.900,00 en APPLE.COM/BILL');
  assertEquals(t.actions.length, 1);
  assertEquals(t.actions[0].kind, 'cobro_rechazado_repetido');
  ok(t.sent.at(-1)!.text.includes('Apple.com/bill intenta cobrarte'));
  ok(t.sent.at(-1)!.text.includes('2 veces'));

  t.later(60 * 24);
  await t.ingest('NEQUI: No te alcanzo para pagar 3.900,00 en APPLE.COM/BILL');
  assertEquals(t.actions.length, 1, 'una sola alerta por comercio al mes');
});

Deno.test('ingreso de Daviplata: pregunta antes de sumar y no suma dos veces', async () => {
  const t = setup();
  await t.ingest('DaviPlata: Recibiste plata por BreB por valor de $18,000. Consulta tus movimientos', '85888');
  const message = t.sent.at(-1)!;
  ok(message.text.includes('recibiste'));
  ok(message.text.includes('nómina'));
  await t.bot.tap(7, 'i:1');
  assertEquals(t.bot.states.get('ana')!.salary.currentBalance, 518_000);
  await t.bot.tap(7, 'i:1');
  assertEquals(t.bot.states.get('ana')!.salary.currentBalance, 518_000);
  assertEquals(t.bot.answers.at(-1), 'Ya lo habías decidido.');
});

Deno.test('ingreso que no se suma (nómina)', async () => {
  const t = setup();
  await t.ingest('Recibiste $30,000. Para saber mas, consulta tus movimientos.', '85888');
  await t.bot.tap(7, 'n:1');
  ok(t.bot.edits.at(-1)!.text.includes('no lo sumé'));
  assertEquals(t.bot.states.get('ana')!.salary.currentBalance, 500_000);
});

Deno.test('otra cuenta no puede sumar mis ingresos', async () => {
  const t = setup();
  t.bot.links.set(8, 'beto');
  await t.ingest('Recibiste $30,000. Para saber mas, consulta tus movimientos.', '85888');
  await t.bot.tap(8, 'i:1');
  assertEquals(t.bot.states.get('beto')!.salary.currentBalance, 500_000);
  assertEquals(t.bot.incomes.get(1)!.status, 'nuevo');
});

Deno.test('códigos de seguridad se ignoran y no se guardan', async () => {
  const t = setup();
  const result = await t.ingest('NEQUI: Tu codigo de seguridad es 482913. No lo compartas.');
  assertEquals(result, { status: 'ignorado' });
  assertEquals(t.events.length, 0);
  assertEquals(t.sent.length, 0);
});

Deno.test('sin Telegram: guarda el aviso y la alerta en la app, sin enviar mensajes', async () => {
  const t = setup({ telegram: false });
  assertEquals((await t.ingest('NEQUI: Pagaste 3.900,00 en GOOGLE *Google One')).status, 'sin_telegram');
  await t.ingest('Faltan fondos para pagar $7.671,00 en GOPASS.', 'notificaciones@nu.com.co');
  t.later(30);
  await t.ingest('Faltan fondos para pagar $7.671,00 en GOPASS.', 'notificaciones@nu.com.co');
  assertEquals(t.sent.length, 0);
  assertEquals(t.actions.length, 1, 'la alerta queda en la bandeja de la app');
  void baseState;
});

Deno.test('cuerpo: texto plano de MacroDroid con remitente en la URL, y JSON de Atajos', async () => {
  const { readIngestBody } = await import('../_shared/ingestBody.ts');
  const plain = await readIngestBody(new Request('https://x.co/functions/v1/bank-ingest?source=sms&sender=890806', {
    method: 'POST',
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: 'NEQUI: Pagaste 3.900,00 en "TIENDA" *X',
  }));
  assertEquals([plain.text, plain.sender, plain.source], ['NEQUI: Pagaste 3.900,00 en "TIENDA" *X', '890806', 'sms']);

  const json = await readIngestBody(new Request('https://x.co/f', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'DaviPlata: Recibiste $30,000', source: 'sms' }),
  }));
  assertEquals([json.text, json.source], ['DaviPlata: Recibiste $30,000', 'sms']);

  const broken = await readIngestBody(new Request('https://x.co/f', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"text": "NEQUI: Pagaste 1.000,00 en "MALO""}',
  }));
  ok(String(broken.text).includes('Pagaste 1.000,00'), 'un JSON roto se procesa como texto');
});
