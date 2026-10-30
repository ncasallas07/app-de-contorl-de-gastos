import { deepStrictEqual as assertEquals, ok } from 'node:assert/strict';
import type { ExpenseRecord } from '../_shared/finance/finance.ts';
import {
  findUnmarkedAnt,
  forecastAntMonth,
  learningStats,
  predictExpense,
  tokenize,
  topAntWords,
  trainAntModel,
} from '../_shared/finance/antLearner.ts';

type Mini = Pick<ExpenseRecord, 'id' | 'title' | 'amount' | 'date' | 'category' | 'isAntExpense'>;
const expense = (title: string, overrides: Partial<Mini> = {}): Mini => ({
  id: title,
  title,
  amount: 4_000,
  date: '2026-10-20',
  category: 'cafe_snacks',
  isAntExpense: true,
  ...overrides,
});

Deno.test('tokenize quita tildes, mayúsculas y palabras vacías', () => {
  assertEquals(tokenize('Café de la Esquina'), ['cafe', 'esquina']);
  assertEquals(tokenize('Recibo  de LUZ!'), ['recibo', 'luz']);
});

Deno.test('con solo el conocimiento inicial ya clasifica lo común', () => {
  const model = trainAntModel([]);
  assertEquals(predictExpense(model, 'Tinto en la oficina')?.category, 'cafe_snacks');
  assertEquals(predictExpense(model, 'Tinto en la oficina')?.isAnt, true);
  assertEquals(predictExpense(model, 'Arriendo noviembre')?.category, 'vivienda');
  assertEquals(predictExpense(model, 'Arriendo noviembre')?.isAnt, false);
  assertEquals(predictExpense(model, 'Netflix')?.category, 'suscripciones');
});

Deno.test('aprende una palabra nueva a partir de los gastos del usuario', () => {
  const before = predictExpense(trainAntModel([]), 'pandebono', 3_000);
  assertEquals(before?.knownTokens, 0);

  const model = trainAntModel([
    expense('pandebono'),
    expense('pandebono y avena'),
    expense('pandebono'),
  ]);
  const after = predictExpense(model, 'pandebono', 3_000)!;
  assertEquals(after.category, 'cafe_snacks');
  ok(after.antProbability > 0.9);
  ok(after.categoryConfidence > (before?.categoryConfidence ?? 0));
});

Deno.test('las correcciones del usuario pesan más que el conocimiento inicial', () => {
  // Al inicio, "uber" es transporte hormiga. El usuario lo usa para ir a trabajar.
  assertEquals(predictExpense(trainAntModel([]), 'uber')?.isAnt, true);
  const corrections = [1, 2].map(() => ({
    concept: 'uber al trabajo',
    suggestedCategory: 'transporte' as const,
    finalCategory: 'transporte' as const,
    suggestedAnt: true,
    finalAnt: false,
  }));
  const model = trainAntModel([], corrections);
  assertEquals(predictExpense(model, 'uber')?.isAnt, false);
  assertEquals(model.examples.corrections, 2);
});

Deno.test('el monto es una pista: lo pequeño se parece más a hormiga', () => {
  const model = trainAntModel([
    expense('tienda', { amount: 3_000 }),
    expense('tienda', { amount: 2_500 }),
    expense('tienda', { amount: 250_000, isAntExpense: false, category: 'alimentacion' }),
    expense('tienda', { amount: 180_000, isAntExpense: false, category: 'alimentacion' }),
  ]);
  const small = predictExpense(model, 'tienda', 3_000)!;
  const big = predictExpense(model, 'tienda', 200_000)!;
  ok(small.antProbability > big.antProbability);
  assertEquals(small.isAnt, true);
  assertEquals(big.isAnt, false);
});

Deno.test('sin palabras útiles no sugiere nada', () => {
  assertEquals(predictExpense(trainAntModel([]), 'de la'), null);
});

Deno.test('el crítico mide aciertos totales y recientes', () => {
  const row = (hit: boolean, i: number) => ({
    concept: 'x',
    suggestedCategory: 'ocio' as const,
    finalCategory: hit ? ('ocio' as const) : ('otros' as const),
    suggestedAnt: false,
    finalAnt: false,
    createdAt: `2026-10-${String(i + 1).padStart(2, '0')}`,
  });
  // 4 errores al principio y 10 aciertos después: aprende.
  const rows = [...[0, 1, 2, 3].map((i) => row(false, i)), ...Array.from({ length: 10 }, (_, i) => row(true, i + 4))];
  const stats = learningStats(rows);
  assertEquals(stats.total, 14);
  assertEquals(stats.hits, 10);
  assertEquals(stats.recentHitRate, 1);
  ok(stats.hitRate !== null && stats.hitRate < 1);
  assertEquals(learningStats([]).hitRate, null);
});

Deno.test('palabras hormiga aprendidas de los datos del usuario', () => {
  const model = trainAntModel([expense('pandebono'), expense('pandebono'), expense('mercado', { isAntExpense: false, category: 'alimentacion', amount: 200_000 })]);
  ok(topAntWords(model).includes('pandebono'));
  ok(!topAntWords(model).includes('mercado'));
});

Deno.test('pronóstico del mes: ritmo diario × días del mes', () => {
  const forecast = forecastAntMonth([
    { date: '2026-10-02', amount: 30_000, isAntExpense: true },
    { date: '2026-10-09', amount: 20_000, isAntExpense: true },
    { date: '2026-10-05', amount: 900_000, isAntExpense: false },
    { date: '2026-09-30', amount: 99_000, isAntExpense: true },
  ], '2026-10-10', 3_100_000);
  assertEquals(forecast.spentSoFar, 50_000);
  assertEquals(forecast.projected, 155_000);
  assertEquals(Math.round(forecast.projectedPct * 10) / 10, 5);
});

Deno.test('detecta gastos recientes que parecen hormiga pero no están marcados', () => {
  const model = trainAntModel([]);
  const found = findUnmarkedAnt(model, [
    expense('Tinto y empanada', { id: 'a', isAntExpense: false, date: '2026-10-28' }),
    expense('Arriendo', { id: 'b', isAntExpense: false, date: '2026-10-28', amount: 900_000, category: 'vivienda' }),
    expense('Tinto viejo', { id: 'c', isAntExpense: false, date: '2026-10-01' }),
    expense('Tinto marcado', { id: 'd', isAntExpense: true, date: '2026-10-28' }),
  ], '2026-10-30');
  assertEquals(found.map((item) => item.expense.id), ['a']);
});
