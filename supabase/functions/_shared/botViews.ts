// Lo que el bot de Telegram muestra: resumen, deudas, plan y el borrador de
// un gasto. Funciones puras (sin base de datos), probadas en tests/bot_test.ts.

import type { ExpenseCategory } from './finance/finance.ts';
import { activeDebts, buildDebtPlan, monthName } from './finance/debtPlanner.ts';
import { forecastAntMonth } from './finance/antLearner.ts';
import { getMonthlyIncome, getNextPaymentDate } from './finance/contract.ts';
import { toIsoDate } from './finance/date.ts';
import { formatCOP } from './agentTypes.ts';
import { DEFAULT_TARGET_MONTHS } from './agents/planner.ts';
import type { UserState } from './orchestrator.ts';
import { daysBetween } from './zone.ts';
import { escapeHtml } from './telegram.ts';

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  alimentacion: 'Alimentación',
  vivienda: 'Vivienda',
  servicios: 'Servicios',
  transporte: 'Transporte',
  salud: 'Salud',
  educacion: 'Educación',
  ocio: 'Ocio',
  cafe_snacks: 'Café y snacks',
  suscripciones: 'Suscripciones',
  compras_impulso: 'Compras de impulso',
  otros: 'Otros',
};

/** Orden de los botones de categoría (el índice viaja en el botón). */
export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as ExpenseCategory[];

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
};

const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} de ${MONTHS[m - 1]}`;
};

/** "hoy", "mañana", "en 5 días", "hace 2 días". */
export function relativeDays(days: number): string {
  if (days === 0) return 'hoy';
  if (days === 1) return 'mañana';
  if (days === -1) return 'ayer';
  return days > 0 ? `en ${days} días` : `hace ${-days} días`;
}

const pct = (value: number) => `${value.toFixed(1).replace('.', ',')} %`;

// ---------- Leer un gasto escrito a mano ----------

export interface ParsedExpense {
  title: string;
  amount: number;
}

const MAX_AMOUNT = 100_000_000;

/** "3.900,00" → 3900 · "12,000" → 12000 · "3.5" con k → 3500. */
function parseNumber(raw: string, thousands: boolean): number {
  let text = raw;
  if (thousands) {
    // Con "k" o "mil" el número es pequeño: punto o coma son decimales.
    return Number(text.replace(',', '.')) * 1000;
  }
  // Decimales colombianos (",00") o de punto (".50") al final: se ignoran.
  text = text.replace(/[.,]\d{1,2}$/, '');
  return Number(text.replace(/[.,]/g, ''));
}

/**
 * Entiende "tinto 3500", "3500 tinto", "almuerzo $12.000", "uber 15k",
 * "taxi 15 mil". Devuelve null si no hay monto o concepto.
 */
export function parseExpenseText(text: string): ParsedExpense | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    const match = /^\$?(\d+(?:[.,]\d+)*)(k|mil)?$/i.exec(words[i]);
    if (!match) continue;

    let thousands = Boolean(match[2]);
    let used = 1;
    if (!thousands && /^mil$/i.test(words[i + 1] ?? '')) {
      thousands = true;
      used = 2;
    }
    const amount = Math.round(parseNumber(match[1], thousands));
    const title = [...words.slice(0, i), ...words.slice(i + used)].join(' ').trim();
    if (!title || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;
    return { title: title.slice(0, 80), amount };
  }
  return null;
}

// ---------- /resumen ----------

export function formatSummary(state: UserState, todayIso: string): string {
  const month = todayIso.slice(0, 7);
  const monthExpenses = state.expenses.filter((e) => e.date.startsWith(month) && e.date <= todayIso);
  const spent = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const income = getMonthlyIncome(state.salary);
  const ant = forecastAntMonth(state.expenses, todayIso, income);

  const [y, m, d] = todayIso.split('-').map(Number);
  const payday = toIsoDate(getNextPaymentDate(state.salary, new Date(y, m - 1, d, 12)));

  const debts = activeDebts(state.debts);
  const totalDebt = debts.reduce((sum, debt) => sum + debt.totalAmount, 0);
  const nextDue = debts
    .filter((debt) => debt.paymentStatus === 'pendiente')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  const lines = [
    `<b>Tu resumen · ${longDate(todayIso)}</b>`,
    '',
    `Saldo en cuenta: <b>${formatCOP(state.salary.currentBalance)}</b>`,
    `Próximo pago: ${longDate(payday)} (${relativeDays(daysBetween(todayIso, payday))})`,
    `Gastos del mes: ${formatCOP(spent)} en ${monthExpenses.length} ${monthExpenses.length === 1 ? 'registro' : 'registros'}`,
    `Gastos hormiga: ${formatCOP(ant.spentSoFar)}`
      + (ant.dayOfMonth >= 7 && income > 0 ? ` · a este ritmo ${formatCOP(ant.projected)} (${pct(ant.projectedPct)} de tu ingreso)` : ''),
  ];

  if (debts.length === 0) {
    lines.push('Deudas: ninguna activa');
  } else {
    lines.push(`Deudas: ${formatCOP(totalDebt)} en ${debts.length} ${debts.length === 1 ? 'deuda' : 'deudas'}`);
    if (nextDue) {
      lines.push(`Próxima cuota: ${escapeHtml(nextDue.title)}, ${formatCOP(Math.min(nextDue.monthlyPayment, nextDue.totalAmount))}, `
        + `vence ${relativeDays(daysBetween(todayIso, nextDue.dueDate))}`);
    }
  }
  lines.push('', 'Más detalle: /deudas · /plan');
  return lines.join('\n');
}

// ---------- /deudas ----------

export function formatDebts(state: UserState, todayIso: string): string {
  const debts = activeDebts(state.debts).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (debts.length === 0) return '<b>Tus deudas</b>\nNo tienes deudas activas. ¡Bien!';

  const total = debts.reduce((sum, debt) => sum + debt.totalAmount, 0);
  const lines = [`<b>Tus deudas</b> · total ${formatCOP(total)}`, ''];
  debts.forEach((debt, index) => {
    const days = daysBetween(todayIso, debt.dueDate);
    const due = debt.paymentStatus === 'pagado_mes'
      ? `cuota del mes pagada (siguiente ${shortDate(debt.dueDate)})`
      : days < 0
        ? `<b>VENCIDA</b> desde el ${shortDate(debt.dueDate)}`
        : `vence ${shortDate(debt.dueDate)} (${relativeDays(days)})`;
    lines.push(
      `${index + 1}. <b>${escapeHtml(debt.title)}</b>`,
      `   Saldo ${formatCOP(debt.totalAmount)} · cuota ${formatCOP(debt.monthlyPayment)} · ${String(debt.annualInterestRate).replace('.', ',')} % anual`,
      `   ${due}`,
    );
  });
  return lines.join('\n');
}

// ---------- /plan ----------

export function formatPlan(state: UserState, todayIso: string): string {
  if (state.goal && !state.goal.active) {
    return '<b>Plan sin deudas</b>\nTienes el plan pausado. Actívalo en la app, en Estrategia.';
  }
  const targetMonths = state.goal?.targetMonths ?? DEFAULT_TARGET_MONTHS;
  const plan = buildDebtPlan({
    salary: state.salary,
    debts: state.debts,
    expenses: state.expenses,
    method: state.strategyMode,
    targetMonths,
    todayIso,
  });
  const method = plan.method === 'avalancha' ? 'avalancha' : 'bola de nieve';
  const head = `<b>Plan sin deudas</b> · meta ${targetMonths} meses · método ${method}`;

  if (plan.status === 'sin_deudas') return `${head}\n\nNo tienes deudas activas: meta cumplida.`;
  if (plan.status === 'sin_capacidad') {
    return `${head}\n\nCon tus ingresos y gastos actuales no queda dinero para abonar extra`
      + (plan.stuckDebts.length > 0 ? ` y la cuota de ${escapeHtml(plan.stuckDebts.join(', '))} no cubre ni los intereses` : '')
      + '. Revisa tus gastos o renegocia las cuotas.';
  }

  const lines = [head, ''];
  if (plan.status === 'alcanzable') {
    lines.push(`Quedas libre de deudas en <b>${monthName(plan.endMonth!)}</b> (${plan.months} meses).`);
    lines.push(plan.requiredExtra > 0
      ? `Abono extra: ${formatCOP(plan.requiredExtra)} al mes a <b>${escapeHtml(plan.priorityDebt?.title ?? '')}</b>.`
      : 'Con las cuotas mínimas ya alcanzas la meta.');
  } else {
    lines.push(`Tu meta no alcanza: necesitas ${formatCOP(plan.requiredExtra)} extra al mes y te quedan ${formatCOP(plan.extraCapacity)}.`);
    lines.push(`Con lo que tienes, quedas libre en <b>${monthName(plan.endMonth!)}</b> (${plan.months} meses).`);
  }

  const firstMonth = plan.schedule[0]?.month;
  if (firstMonth) {
    const titles = new Map(state.debts.map((debt) => [debt.id, debt.title]));
    const rows = plan.schedule.filter((row) => row.month === firstMonth && row.payment > 0);
    lines.push('', `Pagos de ${monthName(firstMonth)}:`);
    for (const row of rows) lines.push(`• ${escapeHtml(titles.get(row.debtId) ?? 'Deuda')}: ${formatCOP(row.payment)}`);
  }
  if (plan.interestSaved > 0) {
    lines.push('', `Ahorras ${formatCOP(plan.interestSaved)} en intereses frente a pagar solo las cuotas.`);
  }
  return lines.join('\n');
}

// ---------- Borrador de un gasto ----------

export interface Draft {
  id: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  isAnt: boolean;
  /** Confianza de la sugerencia (0 a 1), o null si el modelo no conocía las palabras. */
  confidence: number | null;
  /** true si la persona ya cambió algo: deja de mostrarse como sugerencia. */
  edited: boolean;
}

export interface Button {
  text: string;
  callback_data: string;
}
export type Keyboard = Button[][];

export function formatDraft(draft: Draft): string {
  const lines = [
    '<b>Nuevo gasto</b>',
    `Concepto: ${escapeHtml(draft.title)}`,
    `Monto: <b>${formatCOP(draft.amount)}</b>`,
    `Categoría: ${CATEGORY_LABELS[draft.category]}`,
    `Gasto hormiga: ${draft.isAnt ? 'sí 🐜' : 'no'}`,
    '',
  ];
  if (draft.edited) {
    lines.push('<i>Tu agente aprende de este cambio.</i>');
  } else if (draft.confidence !== null) {
    lines.push(`<i>Sugerido por tu agente (${Math.round(draft.confidence * 100)} % de seguridad). Si no es así, corrígelo: aprende de ti.</i>`);
  } else {
    lines.push('<i>Tu agente aún no conoce esta palabra: revisa la categoría.</i>');
  }
  return lines.join('\n');
}

export function draftKeyboard(draft: Pick<Draft, 'id' | 'isAnt'>): Keyboard {
  return [
    [{ text: '✅ Guardar', callback_data: `s:${draft.id}` }],
    [
      { text: draft.isAnt ? '🐜 Quitar hormiga' : '🐜 Es hormiga', callback_data: `a:${draft.id}` },
      { text: '🏷 Categoría', callback_data: `c:${draft.id}` },
    ],
    [{ text: '✖ Cancelar', callback_data: `x:${draft.id}` }],
  ];
}

export function categoryKeyboard(draftId: string): Keyboard {
  const rows: Keyboard = [];
  for (let i = 0; i < CATEGORY_ORDER.length; i += 2) {
    rows.push(CATEGORY_ORDER.slice(i, i + 2).map((category, offset) => ({
      text: CATEGORY_LABELS[category],
      callback_data: `k:${draftId}:${i + offset}`,
    })));
  }
  rows.push([{ text: '↩ Volver', callback_data: `b:${draftId}` }]);
  return rows;
}

export interface SavedExpense {
  expenseId: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  isAnt: boolean;
  balance: number;
}

export function formatSaved(saved: SavedExpense): string {
  return [
    '<b>✅ Gasto guardado</b>',
    `${escapeHtml(saved.title)} · ${formatCOP(saved.amount)} · ${CATEGORY_LABELS[saved.category]}${saved.isAnt ? ' · hormiga 🐜' : ''}`,
    `Saldo en cuenta: <b>${formatCOP(saved.balance)}</b>`,
    '<i>Ya aparece en la app.</i>',
  ].join('\n');
}

export const savedKeyboard = (expenseId: string): Keyboard => [
  [{ text: '↩ Deshacer', callback_data: `u:${expenseId}` }],
];
