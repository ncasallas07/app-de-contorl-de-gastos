// Envío de correos con Resend (https://resend.com).
// Si no hay RESEND_API_KEY configurada, el agente sigue funcionando:
// las alertas quedan en la app y simplemente no se envía correo.

import type { AgentAction } from './agentTypes.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailResult {
  sent: boolean;
  reason?: string;
}

export type EmailSender = (message: EmailMessage) => Promise<EmailResult>;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function createResendSender(
  apiKey: string | undefined,
  from = 'FinSmart <onboarding@resend.dev>',
  fetchFn: FetchLike = fetch
): EmailSender {
  return async (message) => {
    if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY no configurada' };

    const response = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, ...message }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { sent: false, reason: `Resend respondió ${response.status} ${detail}`.trim() };
    }
    return { sent: true };
  };
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string
  ));

/** Un solo correo por ejecución con todas las alertas nuevas. */
export function buildAlertEmail(to: string, actions: AgentAction[]): EmailMessage {
  const subject = actions.length === 1
    ? `FinSmart: ${actions[0].title}`
    : `FinSmart: ${actions.length} alertas de tus deudas`;

  const text = [
    'Tu agente FinSmart encontró esto hoy:',
    '',
    ...actions.map((action) => `- ${action.title}. ${action.message}`),
    '',
    'Abre FinSmart para ver el detalle y registrar el pago.',
  ].join('\n');

  const items = actions
    .map((action) => `<li><strong>${escapeHtml(action.title)}</strong><br>${escapeHtml(action.message)}</li>`)
    .join('');

  const html = `<p>Tu agente FinSmart encontró esto hoy:</p><ul>${items}</ul>`
    + '<p>Abre FinSmart para ver el detalle y registrar el pago.</p>';

  return { to, subject, html, text };
}
