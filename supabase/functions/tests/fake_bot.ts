// Bot con una base de datos en memoria para las pruebas.
import type { BotDeps, LinkResult, StoredDraft, TelegramUpdate } from '../_shared/telegramBot.ts';
import { handleUpdate } from '../_shared/telegramBot.ts';
import type { Keyboard, SavedExpense } from '../_shared/botViews.ts';
import type { UserState } from '../_shared/orchestrator.ts';
import type { DebtRecord, SalaryProfile } from '../_shared/finance/finance.ts';

export const salary: SalaryProfile = {
  contractType: 'indefinido',
  payMode: 'mensual',
  monthlySalary: 3_000_000,
  dailyRate: 136_364,
  hourlyRate: 17_045,
  workDaysPerWeek: 5,
  paymentWeekday: 5,
  defaultShift: 'diurno',
  hoursPerShift: 8,
  paymentPeriod: 'quincenal',
  paymentDayOfMonth: 30,
  workDaysPerMonthTarget: 22,
  currentBalance: 500_000,
  currency: 'COP',
};

export const debt: DebtRecord = {
  id: 'd1',
  title: 'Tarjeta <Nu>',
  category: 'tarjeta_credito',
  totalAmount: 2_000_000,
  monthlyPayment: 300_000,
  annualInterestRate: 28.5,
  dueDate: '2026-11-05',
  paymentStatus: 'pendiente',
  minimumPaymentOnly: false,
};

export function baseState(overrides: Partial<UserState> = {}): UserState {
  return {
    salary: { ...salary },
    debts: [{ ...debt }],
    workDays: [],
    expenses: [
      { id: 'e1', date: '2026-10-10', amount: 3_500, title: 'tinto', category: 'cafe_snacks', isAntExpense: true },
      { id: 'e2', date: '2026-10-12', amount: 80_000, title: 'mercado', category: 'alimentacion', isAntExpense: false },
    ],
    feedback: [],
    strategyMode: 'avalancha',
    goal: null,
    stateVersion: 1,
    lastPaymentApplied: null,
    ...overrides,
  };
}

interface Sent {
  chatId: number;
  text: string;
  keyboard?: Keyboard;
  messageId?: number;
}

export function fakeBot(today = '2026-10-30') {
  const links = new Map<number, string>();
  const codes = new Map<string, string>([['ABCD1234', 'ana'], ['ZZZZ9999', 'beto']]);
  const states = new Map<string, UserState>([['ana', baseState()], ['beto', baseState()]]);
  const drafts = new Map<string, StoredDraft & { userId: string }>();
  const feedback: { userId: string; concept: string; final: string; finalAnt: boolean }[] = [];
  const replies: Sent[] = [];
  const edits: Sent[] = [];
  const answers: (string | undefined)[] = [];
  const incomes = new Map<number, { userId: string; amount: number; status: string }>();
  let nextDraft = 1;
  let nextExpense = 1;

  const deps: BotDeps = {
    findUserByChat: (chatId) => Promise.resolve(links.get(chatId) ?? null),
    linkWithCode: (code, chatId): Promise<LinkResult> => {
      const userId = codes.get(code);
      if (!userId) return Promise.resolve({ ok: false, reason: 'codigo_invalido' });
      codes.delete(code);
      const owner = links.get(chatId);
      if (owner && owner !== userId) return Promise.resolve({ ok: false, reason: 'chat_de_otra_cuenta' });
      links.set(chatId, userId);
      return Promise.resolve({ ok: true });
    },
    unlink: (chatId) => {
      links.delete(chatId);
      return Promise.resolve();
    },
    reply: (chatId, text, keyboard) => {
      replies.push({ chatId, text, keyboard });
      return Promise.resolve(true);
    },
    edit: (chatId, messageId, text, keyboard) => {
      edits.push({ chatId, messageId, text, keyboard });
      return Promise.resolve(true);
    },
    answer: (_id, text) => {
      answers.push(text);
      return Promise.resolve(true);
    },
    today: () => today,
    loadState: (userId) => Promise.resolve(structuredClone(states.get(userId)!)),
    createDraft: (userId, draft) => {
      const id = `dr${nextDraft++}`;
      drafts.set(id, { ...draft, id, userId });
      return Promise.resolve(id);
    },
    getDraft: (userId, id) => {
      const draft = drafts.get(id);
      return Promise.resolve(draft && draft.userId === userId ? { ...draft } : null);
    },
    updateDraft: (userId, id, patch) => {
      const draft = drafts.get(id);
      if (draft && draft.userId === userId) Object.assign(draft, patch);
      return Promise.resolve();
    },
    deleteDraft: (_userId, id) => {
      drafts.delete(id);
      return Promise.resolve();
    },
    saveDraft: (userId, id, expenseId, date): Promise<SavedExpense | null> => {
      const draft = drafts.get(id);
      if (!draft || draft.userId !== userId) return Promise.resolve(null);
      drafts.delete(id);
      const state = states.get(userId)!;
      state.salary.currentBalance = Math.max(0, state.salary.currentBalance - draft.amount);
      state.stateVersion += 1;
      state.expenses.push({ id: expenseId, date, amount: draft.amount, title: draft.title, category: draft.category, isAntExpense: draft.isAnt });
      feedback.push({ userId, concept: draft.title, final: draft.category, finalAnt: draft.isAnt });
      return Promise.resolve({
        expenseId, title: draft.title, amount: draft.amount, category: draft.category,
        isAnt: draft.isAnt, balance: state.salary.currentBalance,
      });
    },
    undoExpense: (userId, expenseId) => {
      const state = states.get(userId)!;
      const index = state.expenses.findIndex((e) => e.id === expenseId && e.id.startsWith('tg-'));
      if (index < 0) return Promise.resolve(null);
      const [removed] = state.expenses.splice(index, 1);
      state.salary.currentBalance += removed.amount;
      state.stateVersion += 1;
      return Promise.resolve(state.salary.currentBalance);
    },
    newExpenseId: () => `tg-test-${nextExpense++}`,
    addIncome: (userId, eventId) => {
      const income = incomes.get(eventId);
      if (!income || income.userId !== userId || income.status !== 'nuevo') return Promise.resolve(null);
      income.status = 'sumado';
      const state = states.get(userId)!;
      state.salary.currentBalance += income.amount;
      return Promise.resolve(state.salary.currentBalance);
    },
    dismissIncome: (userId, eventId) => {
      const income = incomes.get(eventId);
      if (!income || income.userId !== userId || income.status !== 'nuevo') return Promise.resolve(false);
      income.status = 'ignorado';
      return Promise.resolve(true);
    },
  };

  const say = (chatId: number, text: string, type = 'private') =>
    handleUpdate({ update_id: 1, message: { message_id: 50, chat: { id: chatId, type }, text } }, deps);
  const tap = (chatId: number, data: string, messageId = 99) =>
    handleUpdate({
      update_id: 2,
      callback_query: { id: 'cb', data, message: { message_id: messageId, chat: { id: chatId, type: 'private' } } },
    } as TelegramUpdate, deps);

  return { deps, links, states, drafts, feedback, replies, edits, answers, incomes, say, tap };
}
