// Lógica del bot de Telegram (lo que responde a cada mensaje y botón).
// No depende de Supabase ni de Telegram: recibe sus dependencias, así se
// prueba con datos falsos (tests/telegram_test.ts y tests/bot_test.ts).

import type { ExpenseCategory } from './finance/finance.ts';
import { predictExpense, trainAntModel } from './finance/antLearner.ts';
import { formatCOP } from './agentTypes.ts';
import type { UserState } from './orchestrator.ts';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  categoryKeyboard,
  type Draft,
  draftKeyboard,
  formatDebts,
  formatDraft,
  formatPlan,
  formatSaved,
  formatSummary,
  type Keyboard,
  parseExpenseText,
  type SavedExpense,
  savedKeyboard,
} from './botViews.ts';

interface Chat {
  id: number;
  type: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id?: number;
    chat: Chat;
    from?: { username?: string; first_name?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: Chat };
  };
}

export type LinkResult =
  | { ok: true }
  | { ok: false; reason: 'codigo_invalido' | 'chat_de_otra_cuenta' };

/** Borrador guardado mientras la persona confirma con los botones. */
export interface StoredDraft extends Draft {
  suggestedCategory: ExpenseCategory;
  suggestedAnt: boolean;
}

export interface BotDeps {
  /** Usuario de FinSmart vinculado a este chat, o null. */
  findUserByChat(chatId: number): Promise<string | null>;
  /** Usa un código de un solo uso para vincular el chat a su dueño. */
  linkWithCode(code: string, chatId: number, username: string | null): Promise<LinkResult>;
  unlink(chatId: number): Promise<void>;
  reply(chatId: number, text: string, keyboard?: Keyboard): Promise<unknown>;
  edit(chatId: number, messageId: number, text: string, keyboard?: Keyboard): Promise<unknown>;
  /** Responde al toque de un botón (quita el reloj de carga en Telegram). */
  answer(callbackId: string, text?: string): Promise<unknown>;
  /** Hoy en Bogotá, YYYY-MM-DD. */
  today(): string;
  loadState(userId: string): Promise<UserState>;
  createDraft(userId: string, draft: Omit<StoredDraft, 'id'>): Promise<string>;
  getDraft(userId: string, draftId: string): Promise<StoredDraft | null>;
  updateDraft(userId: string, draftId: string, patch: Partial<Pick<Draft, 'category' | 'isAnt' | 'edited'>>): Promise<void>;
  deleteDraft(userId: string, draftId: string): Promise<void>;
  /** Guarda el gasto, descuenta el saldo y registra lo aprendido. null si el borrador ya no existe. */
  saveDraft(userId: string, draftId: string, expenseId: string, date: string): Promise<SavedExpense | null>;
  /** Deshace un gasto creado desde Telegram. Devuelve el saldo nuevo o null. */
  undoExpense(userId: string, expenseId: string): Promise<number | null>;
  newExpenseId(): string;
  /** Suma al saldo un ingreso avisado por el banco. Devuelve el saldo nuevo o null si ya se decidió. */
  addIncome(userId: string, eventId: number): Promise<number | null>;
  /** Marca un ingreso como "no sumar". false si ya se había decidido. */
  dismissIncome(userId: string, eventId: number): Promise<boolean>;
}

const CODE = /^[A-Z0-9]{8}$/;

export const HELP = [
  '<b>FinSmart · lo que puedo hacer</b>',
  '',
  '<b>Registrar un gasto:</b> escríbeme el concepto y el monto, por ejemplo',
  '<code>tinto 3500</code> · <code>almuerzo $15.000</code> · <code>uber 12k</code>',
  'Te sugiero la categoría y si es hormiga; tú confirmas con los botones.',
  '',
  '/resumen: saldo, próximo pago y gastos del mes',
  '/deudas: tus deudas y vencimientos',
  '/plan: tu plan para quedar sin deudas',
  '/gasto: cómo registrar un gasto',
  '/desvincular: dejar de recibir alertas aquí',
].join('\n');

const GASTO_HELP = 'Escríbeme el concepto y el monto en un solo mensaje, por ejemplo:\n'
  + '<code>tinto 3500</code> o <code>/gasto mercado 85.000</code>';

const NOT_LINKED = 'Este bot es privado y solo responde a cuentas de FinSmart vinculadas. '
  + 'Para vincular la tuya, abre la app: Ajustes de cuenta > Alertas por Telegram.';

/** Extrae el comando y su argumento: "/start@mi_bot ABC" → ["start", "ABC"]. */
export function parseCommand(text: string): { command: string; arg: string } | null {
  const match = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]+))?$/i.exec(text.trim());
  if (!match) return null;
  return { command: match[1].toLowerCase(), arg: (match[2] ?? '').trim() };
}

export async function handleUpdate(update: TelegramUpdate, deps: BotDeps): Promise<void> {
  if (update.callback_query) {
    await handleCallback(update.callback_query, deps);
    return;
  }

  const message = update.message;
  if (!message?.text) return;

  // Solo chats privados: el bot nunca publica datos financieros en grupos.
  if (message.chat.type !== 'private') return;

  const chatId = message.chat.id;
  const parsed = parseCommand(message.text);
  const userId = await deps.findUserByChat(chatId);

  if (parsed?.command === 'start') {
    await handleStart(chatId, parsed.arg, userId, message.from?.username ?? null, deps);
    return;
  }

  if (!userId) {
    await deps.reply(chatId, NOT_LINKED);
    return;
  }

  switch (parsed?.command) {
    case 'desvincular':
      await deps.unlink(chatId);
      await deps.reply(chatId, 'Listo, ya no recibirás alertas en este chat. Puedes volver a vincularlo desde la app.');
      return;
    case 'resumen':
      await deps.reply(chatId, formatSummary(await deps.loadState(userId), deps.today()));
      return;
    case 'deudas':
      await deps.reply(chatId, formatDebts(await deps.loadState(userId), deps.today()));
      return;
    case 'plan':
      await deps.reply(chatId, formatPlan(await deps.loadState(userId), deps.today()));
      return;
    case 'gasto':
      if (!parsed.arg) {
        await deps.reply(chatId, GASTO_HELP);
        return;
      }
      await proposeExpense(chatId, userId, parsed.arg, deps);
      return;
    case undefined:
      await proposeExpense(chatId, userId, message.text, deps);
      return;
    default:
      await deps.reply(chatId, HELP);
  }
}

async function handleStart(chatId: number, arg: string, userId: string | null, username: string | null, deps: BotDeps) {
  const code = arg.toUpperCase();
  if (!code) {
    await deps.reply(chatId, userId
      ? 'Este chat ya está vinculado a tu cuenta de FinSmart. Escribe /ayuda para ver qué puedo hacer.'
      : NOT_LINKED);
    return;
  }
  if (!CODE.test(code)) {
    await deps.reply(chatId, 'Ese código no es válido. Genera uno nuevo en la app.');
    return;
  }
  const result = await deps.linkWithCode(code, chatId, username);
  if (result.ok) {
    await deps.reply(chatId, '<b>Listo, quedaste vinculado.</b>\n'
      + 'Desde ahora tu agente FinSmart te escribirá aquí: vencimientos, pagos aplicados, '
      + 'tu plan sin deudas y gastos hormiga.\n\nEscribe /ayuda para ver los comandos.');
  } else if (result.reason === 'chat_de_otra_cuenta') {
    await deps.reply(chatId, 'Este chat ya está vinculado a otra cuenta de FinSmart. '
      + 'Usa /desvincular primero si quieres cambiarla.');
  } else {
    await deps.reply(chatId, 'Ese código no existe o ya venció (duran 10 minutos). Genera uno nuevo en la app.');
  }
}

/** Arma el borrador con la sugerencia del modelo (capa 5) y pide confirmación. */
async function proposeExpense(chatId: number, userId: string, text: string, deps: BotDeps) {
  const parsed = parseExpenseText(text);
  if (!parsed) {
    await deps.reply(chatId, 'No entendí ese gasto. ' + GASTO_HELP + '\n\nEscribe /ayuda para ver todo lo que puedo hacer.');
    return;
  }

  const draft = suggestDraft(await deps.loadState(userId), parsed.title, parsed.amount, null);
  const id = await deps.createDraft(userId, draft);
  await deps.reply(chatId, formatDraft({ ...draft, id }), draftKeyboard({ id, isAnt: draft.isAnt }));
}

/** Borrador con la categoría y el "¿es hormiga?" que sugiere el detector (capa 5). */
export function suggestDraft(state: UserState, title: string, amount: number, source: string | null): Omit<StoredDraft, 'id'> {
  const prediction = predictExpense(trainAntModel(state.expenses, state.feedback), title, amount);
  const category = prediction?.category ?? 'otros';
  const isAnt = prediction?.isAnt ?? false;
  return {
    title,
    amount,
    category,
    isAnt,
    confidence: prediction && prediction.knownTokens > 0 ? prediction.categoryConfidence : null,
    edited: false,
    suggestedCategory: category,
    suggestedAnt: isAnt,
    source,
  };
}

async function handleCallback(query: NonNullable<TelegramUpdate['callback_query']>, deps: BotDeps) {
  const message = query.message;
  const match = /^([sacbkxuin]):([\w-]{1,40})(?::(\d{1,2}))?$/.exec(query.data ?? '');
  if (!message || message.chat.type !== 'private' || !match) {
    await deps.answer(query.id);
    return;
  }

  const chatId = message.chat.id;
  const userId = await deps.findUserByChat(chatId);
  if (!userId) {
    await deps.answer(query.id, 'Este chat ya no está vinculado.');
    return;
  }

  const [, action, id, extra] = match;
  const messageId = message.message_id;

  if (action === 'u') {
    const balance = await deps.undoExpense(userId, id);
    if (balance === null) {
      await deps.answer(query.id, 'Ese gasto ya no existe.');
      await deps.edit(chatId, messageId, '<i>Ese gasto ya se había borrado.</i>');
      return;
    }
    await deps.answer(query.id, 'Gasto deshecho');
    await deps.edit(chatId, messageId, `↩ <b>Gasto deshecho.</b>\nSaldo en cuenta: ${formatCOP(balance)}`);
    return;
  }

  if (action === 'i' || action === 'n') {
    const eventId = Number(id);
    if (!Number.isSafeInteger(eventId)) {
      await deps.answer(query.id);
      return;
    }
    if (action === 'i') {
      const balance = await deps.addIncome(userId, eventId);
      await deps.answer(query.id, balance === null ? 'Ya lo habías decidido.' : 'Sumado');
      if (balance !== null) {
        await deps.edit(chatId, messageId, `➕ <b>Ingreso sumado.</b>\nSaldo en cuenta: ${formatCOP(balance)}`);
      }
    } else {
      const done = await deps.dismissIncome(userId, eventId);
      await deps.answer(query.id, done ? 'Listo' : 'Ya lo habías decidido.');
      if (done) await deps.edit(chatId, messageId, '<i>Listo, no lo sumé a tu saldo.</i>');
    }
    return;
  }

  const draft = await deps.getDraft(userId, id);
  if (!draft) {
    await deps.answer(query.id, 'Este borrador ya venció.');
    await deps.edit(chatId, messageId, '<i>Este borrador ya no está disponible. Escribe el gasto de nuevo.</i>');
    return;
  }

  switch (action) {
    case 's': {
      const saved = await deps.saveDraft(userId, id, deps.newExpenseId(), deps.today());
      if (!saved) {
        await deps.answer(query.id, 'Ya estaba guardado.');
        return;
      }
      await deps.answer(query.id, 'Guardado');
      await deps.edit(chatId, messageId, formatSaved(saved), savedKeyboard(saved.expenseId));
      return;
    }
    case 'a': {
      const next = { ...draft, isAnt: !draft.isAnt, edited: true };
      await deps.updateDraft(userId, id, { isAnt: next.isAnt, edited: true });
      await deps.answer(query.id);
      await deps.edit(chatId, messageId, formatDraft(next), draftKeyboard(next));
      return;
    }
    case 'c':
      await deps.answer(query.id);
      await deps.edit(chatId, messageId, `${formatDraft(draft)}\n\n<b>Elige la categoría:</b>`, categoryKeyboard(id));
      return;
    case 'k': {
      const category = CATEGORY_ORDER[Number(extra)];
      if (!category) {
        await deps.answer(query.id);
        return;
      }
      const next = { ...draft, category, edited: true };
      await deps.updateDraft(userId, id, { category, edited: true });
      await deps.answer(query.id, CATEGORY_LABELS[category]);
      await deps.edit(chatId, messageId, formatDraft(next), draftKeyboard(next));
      return;
    }
    case 'b':
      await deps.answer(query.id);
      await deps.edit(chatId, messageId, formatDraft(draft), draftKeyboard(draft));
      return;
    case 'x':
      await deps.deleteDraft(userId, id);
      await deps.answer(query.id, 'Cancelado');
      await deps.edit(chatId, messageId, `<s>${formatDraft(draft).split('\n').slice(1, 3).join(' · ')}</s>\n<i>Cancelado: no se guardó nada.</i>`);
      return;
  }
}
