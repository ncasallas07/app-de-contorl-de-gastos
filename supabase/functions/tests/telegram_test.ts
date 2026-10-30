import { deepStrictEqual as assertEquals, ok } from 'node:assert/strict';
import { createTelegramApi, escapeHtml, formatDigest, TELEGRAM_MAX } from '../_shared/telegram.ts';
import { HELP, parseCommand } from '../_shared/telegramBot.ts';
import { fakeBot } from './fake_bot.ts';

Deno.test('escapeHtml protege los mensajes de etiquetas', () => {
  assertEquals(escapeHtml('Café <b> & "té"'), 'Café &lt;b&gt; &amp; "té"');
});

Deno.test('formatDigest ordena de lo más urgente a lo menos', () => {
  const text = formatDigest([
    { severity: 'info', title: 'Plan', message: 'Vas en el mes 3' },
    { severity: 'urgente', title: 'Tarjeta <vence>', message: 'Mañana' },
    { severity: 'positiva', title: 'Pago', message: 'Llegó la nómina' },
  ]);
  ok(text.startsWith('<b>FinSmart · tu agente encontró 3 cosas</b>'));
  ok(text.indexOf('URGENTE') < text.indexOf('Bien ·'));
  ok(text.indexOf('Bien ·') < text.indexOf('Info ·'));
  ok(text.includes('Tarjeta &lt;vence&gt;'));
});

Deno.test('formatDigest no supera el límite de Telegram', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({
    severity: 'moderada' as const,
    title: `Alerta ${i}`,
    message: 'x'.repeat(150),
  }));
  const text = formatDigest(many);
  ok(text.length <= TELEGRAM_MAX);
  ok(/… y \d+ más en la app\.$/.test(text));
});

Deno.test('parseCommand entiende /start con código y con @bot', () => {
  assertEquals(parseCommand('/start ABCD1234'), { command: 'start', arg: 'ABCD1234' });
  assertEquals(parseCommand('/Ayuda@finsmart_bot'), { command: 'ayuda', arg: '' });
  assertEquals(parseCommand('hola'), null);
});

Deno.test('createTelegramApi llama la API y devuelve false si falla', async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const api = createTelegramApi('TOKEN', (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const ok = calls.length === 1;
    return Promise.resolve(new Response(JSON.stringify({ ok, description: 'chat not found' }), { status: ok ? 200 : 400 }));
  });
  assertEquals(await api.sendMessage(5, 'hola', { silent: true }), true);
  assertEquals(calls[0].url, 'https://api.telegram.org/botTOKEN/sendMessage');
  assertEquals(calls[0].body.parse_mode, 'HTML');
  assertEquals(calls[0].body.disable_notification, true);
  assertEquals(await api.sendMessage(5, 'hola'), false);
});

Deno.test('bot: vincula con un código válido y solo una vez', async () => {
  const bot = fakeBot();
  await bot.say(7, '/start abcd1234');
  assertEquals(bot.links.get(7), 'ana');
  ok(bot.replies.at(-1)?.text.includes('quedaste vinculado'));

  await bot.say(8, '/start ABCD1234');
  assertEquals(bot.links.has(8), false, 'el código ya se usó');
  ok(bot.replies.at(-1)?.text.includes('venció'));
});

Deno.test('bot: no deja que un chat ya vinculado pase a otra cuenta', async () => {
  const bot = fakeBot();
  await bot.say(7, '/start ABCD1234');
  await bot.say(7, '/start ZZZZ9999');
  assertEquals(bot.links.get(7), 'ana');
  ok(bot.replies.at(-1)?.text.includes('otra cuenta'));
});

Deno.test('bot: es privado para chats sin vincular y no responde en grupos', async () => {
  const bot = fakeBot();
  await bot.say(9, '/ayuda');
  ok(bot.replies.at(-1)?.text.includes('Este bot es privado'));
  await bot.say(9, '/start ABCD1234', 'group');
  assertEquals(bot.links.size, 0);
  assertEquals(bot.replies.length, 1);
});

Deno.test('bot: ayuda y desvincular', async () => {
  const bot = fakeBot();
  await bot.say(7, '/start ABCD1234');
  await bot.say(7, '/comando_raro');
  assertEquals(bot.replies.at(-1)?.text, HELP);
  await bot.say(7, '/desvincular');
  assertEquals(bot.links.has(7), false);
  await bot.say(7, '/start abc');
  ok(bot.replies.at(-1)?.text.includes('no es válido'));
});
