import React, { useEffect, useState } from 'react';
import { AlertTriangle, Bot, Check, CheckCheck, Info, TrendingUp } from 'lucide-react';
import {
  type AgentInboxItem,
  type AgentSeverity,
  loadAgentInbox,
  markAgentActionsRead,
} from '../services/agentRepository';

interface Props {
  /** Cambia cuando la app recarga los datos, para volver a pedir las alertas. */
  refreshKey: number;
}

const SEVERITY_BADGE: Record<AgentSeverity, { label: string; tone: string }> = {
  urgente: { label: 'Urgente', tone: 'danger' },
  alta: { label: 'Alta', tone: 'warn' },
  moderada: { label: 'Moderada', tone: 'neutral' },
  positiva: { label: 'Positiva', tone: 'ok' },
  info: { label: 'Info', tone: 'neutral' },
};

const LAYER_LABEL: Record<number, string> = {
  1: 'Vigilante',
  2: 'Cierre de ciclo',
  3: 'Planificador',
  4: 'Asesor de nómina',
  5: 'Gastos hormiga',
};

function SeverityIcon({ severity }: { severity: AgentSeverity }) {
  if (severity === 'urgente' || severity === 'alta') return <AlertTriangle size={15} />;
  if (severity === 'positiva') return <TrendingUp size={15} />;
  return <Info size={15} />;
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

export const AgentInbox: React.FC<Props> = ({ refreshKey }) => {
  const [items, setItems] = useState<AgentInboxItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Se piden las alertas al abrir, cuando la app recarga los datos y al volver
  // a la pestaña (el agente corre solo a las 5:00 a. m.).
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void loadAgentInbox().then((next) => {
        if (!cancelled) setItems(next);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshKey]);

  const markRead = async (ids: string[]) => {
    setBusy(true);
    try {
      await markAgentActionsRead(ids);
      setItems((current) => (current ?? []).filter((item) => !ids.includes(item.id)));
    } finally {
      setBusy(false);
    }
  };

  if (items === null || items.length === 0) return null;

  return (
    <section className="vt-card vt-agent-inbox" aria-label="Bandeja del agente">
      <div className="vt-card-head">
        <div>
          <p className="vt-kicker">Agente coach financiero</p>
          <h2 className="vt-card-title">
            <Bot size={16} />
            Lo que hizo tu agente
            <span className="vt-badge accent">{items.length}</span>
          </h2>
        </div>
        <button
          type="button"
          className="vt-text-btn"
          disabled={busy}
          onClick={() => void markRead(items.map((item) => item.id))}
        >
          <CheckCheck size={13} /> Marcar todo como leído
        </button>
      </div>

      <ul className="vt-agent-list">
        {items.map((item) => {
          const badge = SEVERITY_BADGE[item.severity] ?? SEVERITY_BADGE.info;
          return (
            <li key={item.id} className={`vt-agent-item ${badge.tone}`}>
              <span className="vt-agent-icon"><SeverityIcon severity={item.severity} /></span>
              <div className="vt-agent-body">
                <div className="vt-agent-top">
                  <strong>{item.title}</strong>
                  <span className={`vt-badge ${badge.tone}`}>{badge.label}</span>
                </div>
                <p>{item.message}</p>
                <small>{LAYER_LABEL[item.layer] ?? 'Agente'} · {timeAgo(item.createdAt)}</small>
              </div>
              <button
                type="button"
                className="vt-icon-btn"
                aria-label="Marcar como leída"
                title="Marcar como leída"
                disabled={busy}
                onClick={() => void markRead([item.id])}
              >
                <Check size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
