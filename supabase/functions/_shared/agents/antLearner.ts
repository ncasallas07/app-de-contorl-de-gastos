// CAPA 5 · Agente que aprende: "Detector de gastos hormiga".
//
// Cada día reentrena un clasificador bayesiano ingenuo con los gastos del
// usuario y sus correcciones (agent_feedback), y con él:
//   1. Pronostica cuánto se irá este mes en gastos hormiga y avisa si supera
//      el 5 % del ingreso (alerta alta desde el 10 %).
//   2. Señala gastos recientes que parecen hormiga pero no están marcados
//      (generador de problemas: si el usuario los corrige, el modelo aprende).
//   3. Reporta cuando su tasa de aciertos sube (el crítico).
//
// El modelo vive en finance/antLearner.ts (el mismo que sugiere en la app).

import type { ExpenseRecord, SalaryProfile } from '../finance/finance.ts';
import { getMonthlyIncome } from '../finance/contract.ts';
import {
  type FeedbackRecord,
  findUnmarkedAnt,
  forecastAntMonth,
  learningStats,
  trainAntModel,
} from '../finance/antLearner.ts';
import { type AgentAction, formatCOP } from '../agentTypes.ts';

export type LearnerExpense = Pick<ExpenseRecord, 'id' | 'date' | 'amount' | 'title' | 'category' | 'isAntExpense'>;

export interface LearnerInput {
  salary: SalaryProfile;
  expenses: LearnerExpense[];
  feedback: FeedbackRecord[];
  todayIso: string;
}

/** Desde qué día del mes el pronóstico es confiable. */
export const FORECAST_FROM_DAY = 7;
export const HEALTHY_PCT = 5;
export const HIGH_PCT = 10;

export function runAntLearner(input: LearnerInput): AgentAction[] {
  const actions: AgentAction[] = [];
  const model = trainAntModel(input.expenses, input.feedback);
  const stats = learningStats(input.feedback);
  const income = getMonthlyIncome(input.salary);

  // 1. Pronóstico del mes.
  const forecast = forecastAntMonth(input.expenses, input.todayIso, income);
  if (forecast.dayOfMonth >= FORECAST_FROM_DAY && forecast.projectedPct >= HEALTHY_PCT) {
    const level = forecast.projectedPct >= HIGH_PCT ? 'alta' : 'moderada';
    const pct = forecast.projectedPct.toFixed(1).replace('.', ',');
    actions.push({
      layer: 5,
      kind: 'pronostico_hormiga',
      severity: level,
      title: `Gastos hormiga: vas para ${formatCOP(forecast.projected)} este mes`,
      message: `Llevas ${formatCOP(forecast.spentSoFar)} en ${forecast.dayOfMonth} días. A este ritmo cerrarás `
        + `el mes con ${formatCOP(forecast.projected)}, el ${pct} % de tu ingreso (lo sano es menos del `
        + `${HEALTHY_PCT} %). Recortarlos a la mitad te libera ${formatCOP(forecast.projected / 2)} para tus deudas.`,
      data: { ...forecast },
      dedupeKey: `ant:forecast:${forecast.month}:${level}`,
      notify: level === 'alta',
    });
  }

  // 2. Gastos que parecen hormiga pero no están marcados. Los gastos recientes
  //    sin marcar son "pendientes de confirmar": se evalúan con un modelo que
  //    NO los usó para entrenar, para no aprender su etiqueta antes de juzgarla.
  const pending = new Set(findUnmarkedAnt(model, input.expenses, input.todayIso, 7, 0).map((item) => item.expense.id));
  const judge = pending.size > 0
    ? trainAntModel(input.expenses.filter((expense) => !pending.has(expense.id)), input.feedback)
    : model;
  const suspects = findUnmarkedAnt(judge, input.expenses, input.todayIso).slice(0, 3);
  if (suspects.length > 0) {
    const list = suspects.map((item) => `${item.expense.title} (${formatCOP(item.expense.amount)})`).join(', ');
    actions.push({
      layer: 5,
      kind: 'posible_hormiga',
      severity: 'info',
      title: suspects.length === 1 ? '¿Esto es un gasto hormiga?' : '¿Estos son gastos hormiga?',
      message: `El detector cree que ${list} ${suspects.length === 1 ? 'es un gasto hormiga, pero no está marcado' : 'son gastos hormiga, pero no están marcados'}. `
        + 'Revísalos en Gastos: cada corrección le enseña al agente.',
      data: {
        expenses: suspects.map((item) => ({
          id: item.expense.id,
          title: item.expense.title,
          probability: Math.round(item.probability * 100) / 100,
        })),
      },
      dedupeKey: `ant:suspect:${suspects.map((item) => item.expense.id).sort().join('|')}`,
      notify: false,
    });
  }

  // 3. El crítico: avisa cuando el detector ya acierta seguido.
  if (stats.total >= 10 && stats.recentHitRate !== null && stats.recentHitRate >= 0.8) {
    const pct = Math.round(stats.recentHitRate * 100);
    actions.push({
      layer: 5,
      kind: 'aprendizaje',
      severity: 'positiva',
      title: `El detector ya acierta el ${pct} % de tus gastos`,
      message: `De tus últimas 10 sugerencias aceptaste ${Math.round(stats.recentHitRate * 10)} sin cambios `
        + `(${stats.hits} aciertos en ${stats.total} en total). Aprendió de ${model.examples.user} gastos y `
        + `${model.examples.corrections} correcciones tuyas.`,
      data: { ...stats, examples: model.examples },
      dedupeKey: `ant:learned:${Math.floor(stats.recentHitRate * 10)}`,
      notify: false,
    });
  }

  return actions;
}
