// ARCHIVO GENERADO desde src/utils/antLearner.ts con "npm run agent:sync". No editar aquí.

// Detector de gastos hormiga que aprende (capa 5 del agente).
//
// Es un agente que aprende (Russell y Norvig):
//   - Elemento de desempeño: sugiere la categoría y si un gasto es hormiga
//     cuando el usuario escribe el concepto.
//   - Crítico: compara la sugerencia con lo que el usuario guardó al final
//     (tabla agent_feedback) y mide el porcentaje de aciertos.
//   - Elemento de aprendizaje: un clasificador bayesiano ingenuo (Naive Bayes)
//     que se reentrena con los gastos del usuario y sus correcciones.
//   - Generador de problemas: señala gastos que parecen hormiga pero no están
//     marcados, para que el usuario confirme y el modelo aprenda.
//
// Conocimiento inicial: unos ejemplos semilla (peso 1). Los gastos del usuario
// pesan 2 y sus correcciones pesan 3, así que con el uso el modelo se adapta a
// cómo esa persona clasifica su dinero.
//
// Lógica pura y compartida (app y agente). Se copia con `npm run agent:sync`.

import type { ExpenseCategory, ExpenseRecord } from './finance.ts';

export const CATEGORIES: ExpenseCategory[] = [
  'vivienda', 'alimentacion', 'transporte', 'servicios', 'salud', 'educacion',
  'ocio', 'cafe_snacks', 'suscripciones', 'compras_impulso', 'otros',
];

export const WEIGHT_SEED = 1;
export const WEIGHT_USER = 2;
export const WEIGHT_CORRECTION = 3;

/**
 * Suavizado de Lidstone: se suma 0,1 a cada conteo (Laplace suma 1). Con pocos
 * ejemplos, sumar 1 aplana tanto las probabilidades que el modelo casi no se
 * atreve a sugerir; 0,1 deja que una palabra vista pocas veces sí pese.
 */
export const SMOOTHING = 0.1;

/** Una corrección registrada (tabla agent_feedback). */
export interface FeedbackRecord {
  concept: string;
  suggestedCategory: ExpenseCategory | null;
  finalCategory: ExpenseCategory;
  suggestedAnt: boolean | null;
  finalAnt: boolean;
  createdAt?: string;
}

interface Example {
  title: string;
  amount?: number;
  category: ExpenseCategory;
  isAnt: boolean;
  weight: number;
}

// Conocimiento inicial (Colombia). [concepto, categoría, ¿hormiga?]
const SEEDS: [string, ExpenseCategory, boolean][] = [
  ['tinto cafe', 'cafe_snacks', true],
  ['cafe juan valdez', 'cafe_snacks', true],
  ['empanada', 'cafe_snacks', true],
  ['gaseosa', 'cafe_snacks', true],
  ['paquete papas snack', 'cafe_snacks', true],
  ['chocolatina dulces', 'cafe_snacks', true],
  ['domicilio rappi', 'alimentacion', true],
  ['delivery comida', 'alimentacion', true],
  ['netflix', 'suscripciones', true],
  ['spotify', 'suscripciones', true],
  ['disney plus', 'suscripciones', true],
  ['google one almacenamiento', 'suscripciones', true],
  ['apple icloud bill', 'suscripciones', true],
  ['youtube premium', 'suscripciones', true],
  ['amazon prime video', 'suscripciones', true],
  ['aws amazon web services', 'suscripciones', true],
  ['gopass peaje', 'transporte', false],
  ['uber', 'transporte', true],
  ['taxi', 'transporte', true],
  ['didi', 'transporte', true],
  ['ropa capricho', 'compras_impulso', true],
  ['antojo tienda', 'compras_impulso', true],
  ['loteria chance', 'otros', true],
  ['mercado supermercado', 'alimentacion', false],
  ['exito', 'alimentacion', false],
  ['d1', 'alimentacion', false],
  ['almuerzo corrientazo', 'alimentacion', false],
  ['arriendo', 'vivienda', false],
  ['administracion conjunto', 'vivienda', false],
  ['recibo luz', 'servicios', false],
  ['recibo agua', 'servicios', false],
  ['gas natural', 'servicios', false],
  ['internet plan celular', 'servicios', false],
  ['transmilenio sitp bus', 'transporte', false],
  ['gasolina', 'transporte', false],
  ['drogueria farmacia', 'salud', false],
  ['cita medica eps', 'salud', false],
  ['matricula semestre', 'educacion', false],
  ['libros curso', 'educacion', false],
  ['cine', 'ocio', false],
  ['cerveza bar', 'ocio', false],
  ['concierto', 'ocio', false],
];

const STOPWORDS = new Set([
  'de', 'la', 'el', 'en', 'y', 'para', 'con', 'del', 'los', 'las', 'un', 'una',
  'por', 'al', 'lo', 'mi', 'me', 'se', 'que', 'a', 'o',
]);

/** Palabras del concepto, sin tildes ni palabras vacías. */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

/** El monto también es una pista: los gastos hormiga suelen ser pequeños. */
export function amountToken(amount: number | undefined): string | null {
  if (!amount || amount <= 0) return null;
  if (amount < 5_000) return '#monto<5k';
  if (amount < 15_000) return '#monto<15k';
  if (amount < 40_000) return '#monto<40k';
  if (amount < 100_000) return '#monto<100k';
  return '#monto>=100k';
}

interface NaiveBayes<C extends string> {
  classTotals: Map<C, number>;
  tokenCounts: Map<C, Map<string, number>>;
  tokenTotals: Map<C, number>;
  vocabulary: Set<string>;
  totalWeight: number;
}

function emptyModel<C extends string>(classes: C[]): NaiveBayes<C> {
  return {
    classTotals: new Map(classes.map((c) => [c, 0])),
    tokenCounts: new Map(classes.map((c) => [c, new Map()])),
    tokenTotals: new Map(classes.map((c) => [c, 0])),
    vocabulary: new Set(),
    totalWeight: 0,
  };
}

function learn<C extends string>(model: NaiveBayes<C>, label: C, tokens: string[], weight: number) {
  model.classTotals.set(label, (model.classTotals.get(label) ?? 0) + weight);
  model.totalWeight += weight;
  const counts = model.tokenCounts.get(label)!;
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + weight);
    model.tokenTotals.set(label, (model.tokenTotals.get(label) ?? 0) + weight);
    model.vocabulary.add(token);
  }
}

/** Probabilidad de cada clase (Bayes con suavizado de Lidstone). */
function posterior<C extends string>(model: NaiveBayes<C>, tokens: string[]): Map<C, number> {
  const classes = [...model.classTotals.keys()];
  const vocabularySize = Math.max(1, model.vocabulary.size);
  const logs = classes.map((label) => {
    let log = Math.log(((model.classTotals.get(label) ?? 0) + SMOOTHING) / (model.totalWeight + SMOOTHING * classes.length));
    const counts = model.tokenCounts.get(label)!;
    const total = model.tokenTotals.get(label) ?? 0;
    for (const token of tokens) {
      log += Math.log(((counts.get(token) ?? 0) + SMOOTHING) / (total + SMOOTHING * vocabularySize));
    }
    return log;
  });
  const max = Math.max(...logs);
  const exp = logs.map((log) => Math.exp(log - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return new Map(classes.map((label, i) => [label, exp[i] / sum]));
}

export interface AntModel {
  category: NaiveBayes<ExpenseCategory>;
  ant: NaiveBayes<'si' | 'no'>;
  examples: { seed: number; user: number; corrections: number };
}

export interface ExpensePrediction {
  category: ExpenseCategory;
  categoryConfidence: number;
  isAnt: boolean;
  antProbability: number;
  /** Cuántas palabras del concepto ya conoce el modelo. */
  knownTokens: number;
}

export function trainAntModel(
  expenses: Pick<ExpenseRecord, 'title' | 'amount' | 'category' | 'isAntExpense'>[],
  feedback: FeedbackRecord[] = []
): AntModel {
  const examples: Example[] = [
    ...SEEDS.map(([title, category, isAnt]) => ({ title, category, isAnt, weight: WEIGHT_SEED })),
    ...expenses.map((expense) => ({
      title: expense.title,
      amount: expense.amount,
      category: expense.category,
      isAnt: expense.isAntExpense,
      weight: WEIGHT_USER,
    })),
    ...feedback.map((row) => ({
      title: row.concept,
      category: row.finalCategory,
      isAnt: row.finalAnt,
      weight: WEIGHT_CORRECTION,
    })),
  ];

  const category = emptyModel<ExpenseCategory>(CATEGORIES);
  const ant = emptyModel<'si' | 'no'>(['si', 'no']);
  for (const example of examples) {
    const words = tokenize(example.title);
    if (words.length === 0) continue;
    if (CATEGORIES.includes(example.category)) learn(category, example.category, words, example.weight);
    const amount = amountToken(example.amount);
    learn(ant, example.isAnt ? 'si' : 'no', amount ? [...words, amount] : words, example.weight);
  }

  return {
    category,
    ant,
    examples: { seed: SEEDS.length, user: expenses.length, corrections: feedback.length },
  };
}

export function predictExpense(model: AntModel, title: string, amount?: number): ExpensePrediction | null {
  const words = tokenize(title);
  if (words.length === 0) return null;

  const categories = posterior(model.category, words);
  let best: ExpenseCategory = 'otros';
  let bestProbability = -1;
  for (const [label, probability] of categories) {
    if (probability > bestProbability) {
      best = label;
      bestProbability = probability;
    }
  }

  const amountWord = amountToken(amount);
  const ant = posterior(model.ant, amountWord ? [...words, amountWord] : words);
  const antProbability = ant.get('si') ?? 0;

  return {
    category: best,
    categoryConfidence: bestProbability,
    isAnt: antProbability >= 0.5,
    antProbability,
    knownTokens: words.filter((word) => model.category.vocabulary.has(word)).length,
  };
}

/** Tipo de gasto hormiga más probable según la categoría. */
export function antTagFor(category: ExpenseCategory): NonNullable<ExpenseRecord['antTag']> {
  switch (category) {
    case 'cafe_snacks': return 'cafe_chucherias';
    case 'alimentacion': return 'delivery';
    case 'suscripciones': return 'suscripcion_olvidada';
    case 'transporte': return 'transporte_evitable';
    case 'compras_impulso': return 'antojo_impulso';
    default: return 'otro_hormiga';
  }
}

// ---------- Crítico: qué tan bien está sugiriendo ----------

export interface LearningStats {
  total: number;
  hits: number;
  hitRate: number | null;
  /** Aciertos en las últimas 10 sugerencias (para ver si mejora). */
  recentHitRate: number | null;
}

export function learningStats(feedback: FeedbackRecord[]): LearningStats {
  const judged = feedback.filter((row) => row.suggestedCategory !== null);
  const isHit = (row: FeedbackRecord) =>
    row.suggestedCategory === row.finalCategory && row.suggestedAnt === row.finalAnt;
  const sorted = [...judged].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const recent = sorted.slice(-10);
  const hits = judged.filter(isHit).length;
  return {
    total: judged.length,
    hits,
    hitRate: judged.length ? hits / judged.length : null,
    recentHitRate: recent.length ? recent.filter(isHit).length / recent.length : null,
  };
}

/** Palabras que el modelo más asocia con gastos hormiga, según los datos del usuario. */
export function topAntWords(model: AntModel, limit = 6): string[] {
  const yes = model.ant.tokenCounts.get('si')!;
  const no = model.ant.tokenCounts.get('no')!;
  const yesTotal = model.ant.tokenTotals.get('si') ?? 0;
  const noTotal = model.ant.tokenTotals.get('no') ?? 0;
  const size = Math.max(1, model.ant.vocabulary.size);
  return [...yes.entries()]
    .filter(([token, count]) => !token.startsWith('#') && count >= WEIGHT_USER)
    .map(([token, count]) => ({
      token,
      score: Math.log((count + SMOOTHING) / (yesTotal + SMOOTHING * size))
        - Math.log(((no.get(token) ?? 0) + SMOOTHING) / (noTotal + SMOOTHING * size)),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.token);
}

// ---------- Pronóstico del mes ----------

export interface AntForecast {
  month: string;
  dayOfMonth: number;
  daysInMonth: number;
  spentSoFar: number;
  projected: number;
  /** Porcentaje del ingreso mensual que se proyecta perder en gastos hormiga. */
  projectedPct: number;
}

export function forecastAntMonth(
  expenses: Pick<ExpenseRecord, 'date' | 'amount' | 'isAntExpense'>[],
  todayIso: string,
  monthlyIncome: number
): AntForecast {
  const month = todayIso.slice(0, 7);
  const [year, monthNumber, day] = todayIso.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const spentSoFar = expenses
    .filter((expense) => expense.isAntExpense && expense.date.startsWith(month) && expense.date <= todayIso)
    .reduce((sum, expense) => sum + expense.amount, 0);
  // Ritmo diario × días del mes.
  const projected = Math.round((spentSoFar / day) * daysInMonth);
  return {
    month,
    dayOfMonth: day,
    daysInMonth,
    spentSoFar: Math.round(spentSoFar),
    projected,
    projectedPct: monthlyIncome > 0 ? (projected / monthlyIncome) * 100 : 0,
  };
}

/** Gastos recientes no marcados como hormiga que el modelo cree que sí lo son. */
export function findUnmarkedAnt<T extends Pick<ExpenseRecord, 'id' | 'title' | 'amount' | 'date' | 'isAntExpense'>>(
  model: AntModel,
  expenses: T[],
  todayIso: string,
  days = 7,
  threshold = 0.8
): { expense: T; probability: number }[] {
  const [y, m, d] = todayIso.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
  return expenses
    .filter((expense) => !expense.isAntExpense && expense.date > from && expense.date <= todayIso)
    .map((expense) => ({ expense, probability: predictExpense(model, expense.title, expense.amount)?.antProbability ?? 0 }))
    .filter((item) => item.probability >= threshold)
    .sort((a, b) => b.probability - a.probability);
}
