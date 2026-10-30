// Cliente mínimo de la API de bots de Telegram y formato de los mensajes.
// https://core.telegram.org/bots/api

import type { ActionSeverity, AgentAction } from './agentTypes.ts';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface TelegramApi {
  /** Llama un método de la API. Devuelve `result` o lanza un error con la descripción. */
  call<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T>;
  sendMessage(chatId: number, text: string, options?: { silent?: boolean }): Promise<boolean>;
}

export function createTelegramApi(token: string, fetchFn: FetchLike = fetch): TelegramApi {
  const call = async <T>(method: string, payload: Record<string, unknown>): Promise<T> => {
    const response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; result?: T; description?: string };
    if (!response.ok || !body.ok) {
      throw new Error(`Telegram ${method}: ${body.description ?? response.status}`);
    }
    return body.result as T;
  };

  return {
    call,
    async sendMessage(chatId, text, options = {}) {
      try {
        await call('sendMessage', {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          disable_notification: options.silent ?? false,
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Telegram con parse_mode HTML solo exige escapar estos tres caracteres. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const ORDER: ActionSeverity[] = ['urgente', 'alta', 'moderada', 'positiva', 'info'];
const LABEL: Record<ActionSeverity, string> = {
  urgente: 'URGENTE',
  alta: 'Importante',
  moderada: 'Para revisar',
  positiva: 'Bien',
  info: 'Info',
};

/** Telegram corta los mensajes en 4096 caracteres. */
export const TELEGRAM_MAX = 4096;

/** Un solo mensaje con todo lo nuevo, de lo más urgente a lo menos. */
export function formatDigest(actions: Pick<AgentAction, 'severity' | 'title' | 'message'>[]): string {
  const sorted = [...actions].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  const header = actions.length === 1
    ? '<b>FinSmart · tu agente encontró esto</b>'
    : `<b>FinSmart · tu agente encontró ${actions.length} cosas</b>`;

  const parts: string[] = [header];
  let length = header.length;
  for (let i = 0; i < sorted.length; i += 1) {
    const action = sorted[i];
    const block = `\n\n<b>${LABEL[action.severity]} · ${escapeHtml(action.title)}</b>\n${escapeHtml(action.message)}`;
    const remaining = sorted.length - i;
    const tail = `\n\n… y ${remaining} más en la app.`;
    if (length + block.length + tail.length > TELEGRAM_MAX) {
      parts.push(tail);
      break;
    }
    parts.push(block);
    length += block.length;
  }
  return parts.join('');
}
