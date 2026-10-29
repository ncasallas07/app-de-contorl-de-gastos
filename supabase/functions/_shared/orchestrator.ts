// Orquestador del agente: ejecuta las capas en orden para un usuario.
//
//   1. Reactivo (vigilante)        ← semana 1
//   2. Basado en modelo (ciclo)    ← semana 2
//   3. Objetivos (planificador)    ← semana 3
//   4. Utilidad (asesor)           ← versión completa
//   5. Aprendizaje (hormiga)       ← versión completa
//
// No depende de Supabase: recibe un `AgentStore` (base de datos) y un
// `EmailSender`. Así se puede probar con datos falsos (ver tests/).

import type { DebtRecord } from './finance/finance.ts';
import type { AgentAction, StoredAction } from './agentTypes.ts';
import { runWatcher } from './agents/watcher.ts';
import { buildAlertEmail, type EmailSender } from './notify.ts';

export interface AgentStore {
  listUserIds(onlyUserId?: string): Promise<string[]>;
  loadDebts(userId: string): Promise<DebtRecord[]>;
  /** Guarda las acciones y devuelve SOLO las nuevas (las repetidas se ignoran). */
  saveActions(userId: string, actions: AgentAction[]): Promise<StoredAction[]>;
  markEmailed(actionIds: string[]): Promise<void>;
  getUserEmail(userId: string): Promise<string | null>;
  logRun(entry: RunLog): Promise<void>;
}

export interface RunLog {
  userId: string;
  runDate: string;
  layers: string[];
  actionsCreated: number;
  emailsSent: number;
  status: 'ok' | 'error';
  error?: string;
}

export interface UserRunResult {
  userId: string;
  status: 'ok' | 'error';
  newActions: number;
  emailSent: boolean;
  error?: string;
}

export async function runAgentForUser(
  userId: string,
  todayIso: string,
  store: AgentStore,
  sendEmail: EmailSender
): Promise<UserRunResult> {
  const layers: string[] = [];
  try {
    // Percepción.
    const debts = await store.loadDebts(userId);

    // Capa 1: reactivo simple.
    layers.push('vigilante');
    const decided = runWatcher(debts, todayIso);

    // Actuar: registrar en la app.
    const created = await store.saveActions(userId, decided);

    // Actuar: avisar por correo solo lo nuevo que lo requiere.
    let emailSent = false;
    const toNotify = created.filter((action) => action.notify);
    if (toNotify.length > 0) {
      const email = await store.getUserEmail(userId);
      if (email) {
        const result = await sendEmail(buildAlertEmail(email, toNotify));
        if (result.sent) {
          emailSent = true;
          await store.markEmailed(toNotify.map((action) => action.id));
        }
      }
    }

    await store.logRun({
      userId,
      runDate: todayIso,
      layers,
      actionsCreated: created.length,
      emailsSent: emailSent ? 1 : 0,
      status: 'ok',
    });

    return { userId, status: 'ok', newActions: created.length, emailSent };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Un error con un usuario no detiene a los demás.
    await store.logRun({
      userId,
      runDate: todayIso,
      layers,
      actionsCreated: 0,
      emailsSent: 0,
      status: 'error',
      error: message,
    }).catch(() => undefined);
    return { userId, status: 'error', newActions: 0, emailSent: false, error: message };
  }
}

export async function runAgent(
  todayIso: string,
  store: AgentStore,
  sendEmail: EmailSender,
  onlyUserId?: string
): Promise<UserRunResult[]> {
  const userIds = await store.listUserIds(onlyUserId);
  const results: UserRunResult[] = [];
  // Secuencial a propósito: pocos usuarios y respeta los límites de Resend.
  for (const userId of userIds) {
    results.push(await runAgentForUser(userId, todayIso, store, sendEmail));
  }
  return results;
}
