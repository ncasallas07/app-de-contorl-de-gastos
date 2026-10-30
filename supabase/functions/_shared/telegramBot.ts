// Lógica del bot de Telegram (lo que responde a cada mensaje).
// No depende de Supabase ni de Telegram: recibe sus dependencias, así se
// prueba con datos falsos (tests/telegram_test.ts).

export interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    from?: { username?: string; first_name?: string };
    text?: string;
  };
}

export type LinkResult =
  | { ok: true }
  | { ok: false; reason: 'codigo_invalido' | 'chat_de_otra_cuenta' };

export interface BotDeps {
  /** Usuario de FinSmart vinculado a este chat, o null. */
  findUserByChat(chatId: number): Promise<string | null>;
  /** Usa un código de un solo uso para vincular el chat a su dueño. */
  linkWithCode(code: string, chatId: number, username: string | null): Promise<LinkResult>;
  unlink(chatId: number): Promise<void>;
  reply(chatId: number, text: string): Promise<unknown>;
}

const CODE = /^[A-Z0-9]{8}$/;

export const HELP = [
  '<b>FinSmart · comandos</b>',
  '/ayuda: ver esta lista',
  '/desvincular: dejar de recibir alertas en este chat',
  '',
  'Muy pronto: /resumen, /deudas, /plan y registrar gastos escribiéndome.',
].join('\n');

const NOT_LINKED = 'Este bot es privado y solo responde a cuentas de FinSmart vinculadas. '
  + 'Para vincular la tuya, abre la app: Ajustes de cuenta > Alertas por Telegram.';

/** Extrae el comando y su argumento: "/start@mi_bot ABC" → ["start", "ABC"]. */
export function parseCommand(text: string): { command: string; arg: string } | null {
  const match = /^\/([a-z_]+)(?:@\w+)?(?:\s+(.+))?$/i.exec(text.trim());
  if (!match) return null;
  return { command: match[1].toLowerCase(), arg: (match[2] ?? '').trim() };
}

export async function handleUpdate(update: TelegramUpdate, deps: BotDeps): Promise<void> {
  const message = update.message;
  if (!message?.text) return;

  // Solo chats privados: el bot nunca publica datos financieros en grupos.
  if (message.chat.type !== 'private') return;

  const chatId = message.chat.id;
  const parsed = parseCommand(message.text);
  const userId = await deps.findUserByChat(chatId);

  if (parsed?.command === 'start') {
    const code = parsed.arg.toUpperCase();
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
    const result = await deps.linkWithCode(code, chatId, message.from?.username ?? null);
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
    return;
  }

  if (!userId) {
    await deps.reply(chatId, NOT_LINKED);
    return;
  }

  if (parsed?.command === 'desvincular') {
    await deps.unlink(chatId);
    await deps.reply(chatId, 'Listo, ya no recibirás alertas en este chat. Puedes volver a vincularlo desde la app.');
    return;
  }

  await deps.reply(chatId, HELP);
}
