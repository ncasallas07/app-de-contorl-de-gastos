// Recepción de los avisos de los bancos: del texto del SMS o correo a una
// acción del agente.
//
//   compra / envío → borrador en Telegram para confirmar o corregir
//   ingreso        → pregunta si se suma al saldo (la nómina ya la suma la capa 2)
//   rechazo        → aviso informativo; si el mismo comercio falla 2 o más
//                    veces en 30 días, alerta de "suscripción olvidada"
//
// El mismo aviso puede llegar al iPhone y al Android: la base de datos lo
// reconoce por su huella y lo registra una sola vez.

import type { AgentAction, StoredAction } from './agentTypes.ts';
import { type BankEvent, type BankEventKind, fingerprint, merchantKey, parseBankMessage } from './banks.ts';
import {
  draftKeyboard,
  formatDraft,
  formatIncome,
  formatRejected,
  formatRepeatedRejection,
  incomeKeyboard,
  type Keyboard,
} from './botViews.ts';
import type { UserState } from './orchestrator.ts';
import { type StoredDraft, suggestDraft } from './telegramBot.ts';

export type IngestSource = 'sms' | 'correo' | 'prueba';

export interface IngestInput {
  userId: string;
  text: string;
  sender?: string | null;
  source: IngestSource;
}

export interface RecordedEvent extends BankEvent {
  fingerprint: string;
  merchantKey: string;
  source: IngestSource;
  rawText: string;
}

export interface IngestDeps {
  /** Guarda el aviso. null si es repetido (llegó a otro celular hace poco). */
  recordEvent(userId: string, event: RecordedEvent): Promise<number | null>;
  /** Cobros rechazados del mismo comercio en los últimos `days` días (incluye el actual). */
  countRejections(userId: string, merchantKey: string, days: number): Promise<number>;
  getTelegramChatId(userId: string): Promise<number | null>;
  loadState(userId: string): Promise<UserState>;
  createDraft(userId: string, draft: Omit<StoredDraft, 'id'>): Promise<string>;
  send(chatId: number, text: string, keyboard?: Keyboard, silent?: boolean): Promise<boolean>;
  saveActions(userId: string, actions: AgentAction[]): Promise<StoredAction[]>;
  today(): string;
}

export type IngestStatus = 'ignorado' | 'duplicado' | 'sin_telegram' | 'enviado';

export interface IngestResult {
  status: IngestStatus;
  kind?: BankEventKind;
  bank?: string;
  amount?: number;
}

/** A partir de cuántos rechazos del mismo comercio se avisa. */
export const REPEATED_REJECTIONS = 2;
export const REJECTION_WINDOW_DAYS = 30;

export async function processBankMessage(input: IngestInput, deps: IngestDeps): Promise<IngestResult> {
  const event = parseBankMessage(input.text, input.sender);
  if (!event) return { status: 'ignorado' };

  const summary = { kind: event.kind, bank: event.bank, amount: event.amount };
  const key = merchantKey(event.merchant);
  const eventId = await deps.recordEvent(input.userId, {
    ...event,
    fingerprint: fingerprint(event),
    merchantKey: key,
    source: input.source,
    rawText: input.text.slice(0, 500),
  });
  if (eventId === null) return { status: 'duplicado', ...summary };

  const chatId = await deps.getTelegramChatId(input.userId);

  if (event.kind === 'rechazo') {
    // La alerta de cobros repetidos queda en la app aunque no haya Telegram.
    let alert: StoredAction | undefined;
    if (event.merchant) {
      const count = await deps.countRejections(input.userId, key, REJECTION_WINDOW_DAYS);
      if (count >= REPEATED_REJECTIONS) {
        const text = formatRepeatedRejection(event.merchant, count, event.amount);
        [alert] = await deps.saveActions(input.userId, [{
          layer: 1,
          kind: 'cobro_rechazado_repetido',
          severity: 'moderada',
          title: text.title,
          message: text.message,
          data: { bank: event.bank, merchant: event.merchant, amount: event.amount, count },
          // Una alerta por comercio al mes.
          dedupeKey: `banco:rechazos:${key}:${deps.today().slice(0, 7)}`,
          notify: false,
        }]);
      }
    }
    if (chatId === null) return { status: 'sin_telegram', ...summary };
    await deps.send(chatId, formatRejected(event.bank, event.amount, event.merchant), undefined, true);
    if (alert) await deps.send(chatId, `🔁 <b>${alert.title}</b>\n${alert.message}`);
    return { status: 'enviado', ...summary };
  }

  if (chatId === null) return { status: 'sin_telegram', ...summary };

  if (event.kind === 'ingreso') {
    await deps.send(chatId, formatIncome({ bank: event.bank, amount: event.amount, from: event.merchant }), incomeKeyboard(eventId));
    return { status: 'enviado', ...summary };
  }

  // Compra o envío: se propone el gasto con la sugerencia de la capa 5.
  const draft = suggestDraft(await deps.loadState(input.userId), event.title, event.amount, event.bank);
  const id = await deps.createDraft(input.userId, draft);
  await deps.send(chatId, formatDraft({ ...draft, id }), draftKeyboard({ id, isAnt: draft.isAnt }));
  return { status: 'enviado', ...summary };
}
