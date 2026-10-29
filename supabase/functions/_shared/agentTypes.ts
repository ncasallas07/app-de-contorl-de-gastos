// Tipos comunes a todas las capas del agente.

export type AgentLayer = 1 | 2 | 3 | 4 | 5;

export type ActionSeverity = 'urgente' | 'alta' | 'moderada' | 'positiva' | 'info';

/** Una acción que una capa decide (se guarda en agent_actions). */
export interface AgentAction {
  layer: AgentLayer;
  kind: string;
  severity: ActionSeverity;
  title: string;
  message: string;
  data: Record<string, unknown>;
  /** Clave estable: la misma situación no se registra dos veces. */
  dedupeKey: string;
  /** Si además de quedar en la app debe llegar por correo. */
  notify: boolean;
}

/** Acción ya guardada, con su id en la base de datos. */
export interface StoredAction extends AgentAction {
  id: string;
}

export const formatCOP = (value: number): string =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
