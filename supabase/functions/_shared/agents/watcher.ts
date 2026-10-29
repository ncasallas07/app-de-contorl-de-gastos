// CAPA 1 · Agente reactivo simple: "Vigilante de vencimientos".
//
// Percepción: las deudas del usuario y la fecha de hoy.
// Acción:     crear alertas (y pedir correo) según reglas condición → acción.
// No guarda memoria: decide solo con lo que percibe ahora. Que una alerta no
// se repita cada día lo garantiza la base de datos (dedupe_key único), no el
// agente.

import type { DebtRecord } from '../finance/finance.ts';
import { type AgentAction, formatCOP } from '../agentTypes.ts';
import { daysBetween } from '../zone.ts';

export interface WatcherOptions {
  /** Días de anticipación para avisar. Por defecto 3 (igual que el motor de estrategia). */
  windowDays?: number;
}

type Bucket = 'vencida' | 'hoy' | 'proxima';

/** Regla 0: solo se vigilan deudas activas con saldo y cuota sin pagar este mes. */
export function isWatched(debt: DebtRecord): boolean {
  return debt.paymentStatus === 'pendiente' && debt.totalAmount > 0;
}

export function runWatcher(
  debts: DebtRecord[],
  todayIso: string,
  options: WatcherOptions = {}
): AgentAction[] {
  const windowDays = options.windowDays ?? 3;
  const actions: AgentAction[] = [];

  for (const debt of debts) {
    if (!isWatched(debt)) continue;

    const daysLeft = daysBetween(todayIso, debt.dueDate);
    const payment = Math.min(debt.monthlyPayment || debt.totalAmount, debt.totalAmount);
    const amount = formatCOP(payment);

    let bucket: Bucket;
    let title: string;
    let message: string;

    if (daysLeft < 0) {
      // Regla 1: cuota vencida y sin pagar.
      bucket = 'vencida';
      const days = Math.abs(daysLeft);
      title = `${debt.title}: cuota vencida`;
      message = `La cuota de ${amount} venció hace ${days} ${days === 1 ? 'día' : 'días'}. `
        + 'Págala cuanto antes para evitar intereses de mora y reportes.';
    } else if (daysLeft === 0) {
      // Regla 2: vence hoy.
      bucket = 'hoy';
      title = `${debt.title}: vence hoy`;
      message = `Hoy vence la cuota de ${amount}.`;
    } else if (daysLeft <= windowDays) {
      // Regla 3: vence dentro de la ventana de aviso.
      bucket = 'proxima';
      title = `${debt.title}: vence en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}`;
      message = `La cuota de ${amount} vence el ${debt.dueDate}. Separa el dinero desde ya.`;
    } else {
      // Sin regla que aplique: el agente no hace nada.
      continue;
    }

    actions.push({
      layer: 1,
      kind: bucket === 'vencida' ? 'deuda_vencida' : 'deuda_por_vencer',
      severity: bucket === 'proxima' && daysLeft > 1 ? 'alta' : 'urgente',
      title,
      message,
      data: {
        debtId: debt.id,
        debtTitle: debt.title,
        dueDate: debt.dueDate,
        daysLeft,
        payment,
      },
      // Una alerta por deuda, fecha de vencimiento y nivel: si pasa de
      // "próxima" a "hoy" o a "vencida", el usuario recibe el nuevo aviso.
      dedupeKey: `watcher:${debt.id}:${debt.dueDate}:${bucket}`,
      notify: true,
    });
  }

  // Lo más urgente primero.
  return actions.sort(
    (a, b) => (a.data.daysLeft as number) - (b.data.daysLeft as number)
  );
}
