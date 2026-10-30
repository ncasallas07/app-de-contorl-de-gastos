import { deepStrictEqual as assertEquals, ok } from 'node:assert/strict';
import { formatDebts, formatPlan, formatSummary, parseExpenseText, relativeDays } from '../_shared/botViews.ts';
import { baseState, fakeBot } from './fake_bot.ts';

Deno.test('lee montos colombianos y el concepto en cualquier orden', () => {
  assertEquals(parseExpenseText('tinto 3500'), { title: 'tinto', amount: 3_500 });
  assertEquals(parseExpenseText('3500 tinto'), { title: 'tinto', amount: 3_500 });
  assertEquals(parseExpenseText('almuerzo $15.000'), { title: 'almuerzo', amount: 15_000 });
  assertEquals(parseExpenseText('Google One 3.900,00'), { title: 'Google One', amount: 3_900 });
  assertEquals(parseExpenseText('mercado 93,800'), { title: 'mercado', amount: 93_800 });
  assertEquals(parseExpenseText('uber 12k'), { title: 'uber', amount: 12_000 });
  assertEquals(parseExpenseText('taxi 15 mil'), { title: 'taxi', amount: 15_000 });
  assertEquals(parseExpenseText('arriendo 1.200.000'), { title: 'arriendo', amount: 1_200_000 });
});

Deno.test('rechaza mensajes sin monto o sin concepto', () => {
  assertEquals(parseExpenseText('hola'), null);
  assertEquals(parseExpenseText('3500'), null);
  assertEquals(parseExpenseText('tinto 0'), null);
});

Deno.test('relativeDays en español', () => {
  assertEquals([relativeDays(0), relativeDays(1), relativeDays(6), relativeDays(-2)], ['hoy', 'mañana', 'en 6 días', 'hace 2 días']);
});

Deno.test('resumen: saldo, próximo pago quincenal, gastos del mes y próxima cuota', () => {
  const text = formatSummary(baseState(), '2026-10-30');
  ok(/Saldo en cuenta: <b>\$\s?500\.000<\/b>/.test(text), text);
  ok(text.includes('sábado 31 de octubre (mañana)'), text);
  ok(text.includes('en 2 registros'), text);
  ok(text.includes('Tarjeta &lt;Nu&gt;'), 'escapa el HTML del título');
  ok(text.includes('vence en 6 días'), text);
});

Deno.test('deudas: ordenadas por vencimiento y avisa las vencidas', () => {
  const state = baseState({
    debts: [
      { ...baseState().debts[0] },
      { ...baseState().debts[0], id: 'd2', title: 'Préstamo', dueDate: '2026-10-20' },
      { ...baseState().debts[0], id: 'd3', title: 'Liquidada', paymentStatus: 'liquidada' },
    ],
  });
  const text = formatDebts(state, '2026-10-30');
  ok(text.indexOf('Préstamo') < text.indexOf('Tarjeta'));
  ok(text.includes('VENCIDA'));
  ok(!text.includes('Liquidada'));
  ok(formatDebts(baseState({ debts: [] }), '2026-10-30').includes('No tienes deudas'));
});

Deno.test('plan: fecha de salida y pagos del primer mes', () => {
  const text = formatPlan(baseState(), '2026-10-30');
  ok(text.includes('Quedas libre de deudas en'), text);
  ok(text.includes('Pagos de noviembre de 2026'), text);
  ok(formatPlan(baseState({ debts: [] }), '2026-10-30').includes('meta cumplida'));
});

Deno.test('gasto: sugiere categoría y hormiga, y guarda al confirmar', async () => {
  const bot = fakeBot();
  bot.links.set(7, 'ana');
  await bot.say(7, 'tinto 3500');
  const draft = bot.replies.at(-1)!;
  ok(draft.text.includes('Café y snacks'), draft.text);
  ok(draft.text.includes('hormiga: sí'), draft.text);
  assertEquals(draft.keyboard?.[0][0].callback_data, 's:dr1');

  await bot.tap(7, 's:dr1');
  const saved = bot.edits.at(-1)!;
  ok(saved.text.includes('Gasto guardado'));
  ok(saved.text.includes('496.500'), 'descuenta del saldo');
  assertEquals(saved.keyboard?.[0][0].callback_data, 'u:tg-test-1');
  assertEquals(bot.states.get('ana')!.stateVersion, 2, 'sube la versión para que la app recargue');
  assertEquals(bot.feedback.length, 1, 'registra lo que aprende');

  await bot.tap(7, 's:dr1');
  assertEquals(bot.states.get('ana')!.expenses.length, 3, 'doble toque no guarda dos veces');
});

Deno.test('gasto: corregir categoría y hormiga antes de guardar', async () => {
  const bot = fakeBot();
  bot.links.set(7, 'ana');
  await bot.say(7, '/gasto curso de ingles 120000');
  await bot.tap(7, 'c:dr1');
  ok(bot.edits.at(-1)!.text.includes('Elige la categoría'));
  await bot.tap(7, 'k:dr1:5'); // educacion
  ok(bot.edits.at(-1)!.text.includes('Categoría: Educación'));
  ok(bot.edits.at(-1)!.text.includes('aprende de este cambio'));
  await bot.tap(7, 'a:dr1');
  await bot.tap(7, 'a:dr1');
  await bot.tap(7, 's:dr1');
  const expense = bot.states.get('ana')!.expenses.at(-1)!;
  assertEquals([expense.category, expense.isAntExpense, expense.amount], ['educacion', false, 120_000]);
});

Deno.test('gasto: cancelar no guarda y deshacer devuelve el saldo', async () => {
  const bot = fakeBot();
  bot.links.set(7, 'ana');
  await bot.say(7, 'pizza 30000');
  await bot.tap(7, 'x:dr1');
  ok(bot.edits.at(-1)!.text.includes('no se guardó nada'));
  assertEquals(bot.states.get('ana')!.expenses.length, 2);

  await bot.say(7, 'pizza 30000');
  await bot.tap(7, 's:dr2');
  await bot.tap(7, 'u:tg-test-1');
  ok(bot.edits.at(-1)!.text.includes('Gasto deshecho'));
  assertEquals(bot.states.get('ana')!.salary.currentBalance, 500_000);
  await bot.tap(7, 'u:tg-test-1');
  ok(bot.edits.at(-1)!.text.includes('ya se había borrado'));
});

Deno.test('seguridad: un chat no puede usar borradores de otra cuenta ni botones sin vínculo', async () => {
  const bot = fakeBot();
  bot.links.set(7, 'ana');
  bot.links.set(8, 'beto');
  await bot.say(7, 'tinto 3500');
  await bot.tap(8, 's:dr1');
  ok(bot.edits.at(-1)!.text.includes('ya no está disponible'));
  assertEquals(bot.states.get('beto')!.expenses.length, 2);
  assertEquals(bot.states.get('ana')!.expenses.length, 2);

  await bot.tap(9, 's:dr1');
  assertEquals(bot.answers.at(-1), 'Este chat ya no está vinculado.');
  await bot.tap(7, 'z:<script>');
  assertEquals(bot.states.get('ana')!.expenses.length, 2);
});

Deno.test('comandos de consulta y texto que no es un gasto', async () => {
  const bot = fakeBot();
  bot.links.set(7, 'ana');
  await bot.say(7, '/resumen');
  ok(bot.replies.at(-1)!.text.includes('Tu resumen'));
  await bot.say(7, '/deudas');
  ok(bot.replies.at(-1)!.text.includes('Tus deudas'));
  await bot.say(7, '/plan');
  ok(bot.replies.at(-1)!.text.includes('Plan sin deudas'));
  await bot.say(7, '/gasto');
  ok(bot.replies.at(-1)!.text.includes('concepto y el monto'));
  await bot.say(7, 'hola');
  ok(bot.replies.at(-1)!.text.includes('No entendí ese gasto'));
});
