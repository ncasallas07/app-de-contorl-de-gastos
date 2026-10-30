import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, CheckCircle2, ExternalLink, Loader2, Send } from 'lucide-react';
import {
  createTelegramLinkCode,
  loadTelegramStatus,
  type TelegramStatus,
  telegramDeepLink,
  unlinkTelegram,
} from '../../services/telegramRepository';

const CODE_MINUTES = 10;
const POLL_MS = 4000;

/** Sección de Ajustes: conectar el bot de Telegram para recibir las alertas del agente. */
export const TelegramSettings: React.FC = () => {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [code, setCode] = useState<{ value: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await loadTelegramStatus();
    setStatus(next);
    if (next.link) setCode(null);
    return next;
  }, []);

  useEffect(() => {
    let alive = true;
    loadTelegramStatus().then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Mientras hay un código vigente, revisa si ya se vinculó desde Telegram.
  useEffect(() => {
    if (!code) return undefined;
    const timer = window.setInterval(() => {
      if (Date.now() > code.expiresAt) {
        setCode(null);
        setError('El código venció. Genera uno nuevo.');
        return;
      }
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [code, refresh]);

  const handleConnect = async () => {
    setError(null);
    setBusy(true);
    try {
      const value = await createTelegramLinkCode();
      setCode({ value, expiresAt: Date.now() + CODE_MINUTES * 60_000 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el código.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    setError(null);
    setBusy(true);
    try {
      await unlinkTelegram();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo desconectar.');
    } finally {
      setBusy(false);
    }
  };

  const bot = status?.botUsername ?? null;

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <span className="settings-icon"><BellRing size={16} /></span>
        <div>
          <h4>Alertas por Telegram</h4>
          <p>Tu agente te escribe allí cuando una cuota vence, llega tu pago o detecta gastos hormiga.</p>
        </div>
      </div>

      {status === null && (
        <p className="tg-note"><Loader2 size={14} className="auth-spin" /> Revisando conexión…</p>
      )}

      {status && !status.available && (
        <p className="tg-note">Aún no está activado en el servidor (falta ejecutar <code>supabase/telegram.sql</code>).</p>
      )}

      {status?.available && !bot && (
        <p className="tg-note">El bot todavía no está configurado en el servidor.</p>
      )}

      {status?.available && bot && status.link && (
        <div className="tg-linked">
          <div className="auth-alert success" role="status">
            <CheckCircle2 size={15} />
            <span>
              Conectado{status.link.username ? ` como @${status.link.username}` : ''} desde el{' '}
              {new Date(status.link.linkedAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}.
            </span>
          </div>
          <div className="settings-actions">
            <a className="vt-btn vt-btn-sm" href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">
              Abrir chat <ExternalLink size={13} />
            </a>
            <button type="button" className="vt-btn vt-btn-sm" onClick={handleUnlink} disabled={busy}>
              {busy ? <Loader2 size={14} className="auth-spin" /> : 'Desconectar'}
            </button>
          </div>
        </div>
      )}

      {status?.available && bot && !status.link && !code && (
        <div className="settings-actions">
          <button type="button" className="vt-btn vt-btn-sm vt-btn-lime" onClick={handleConnect} disabled={busy}>
            {busy ? <Loader2 size={14} className="auth-spin" /> : <><Send size={13} /> Conectar Telegram</>}
          </button>
        </div>
      )}

      {status?.available && bot && !status.link && code && (
        <div className="tg-code">
          <p>
            Abre el bot y pulsa <strong>Iniciar</strong>. Si lo abres en otro celular, envíale este mensaje:
          </p>
          <code className="tg-code-value">/start {code.value}</code>
          <div className="settings-actions">
            <a className="vt-btn vt-btn-sm vt-btn-lime" href={telegramDeepLink(bot, code.value)} target="_blank" rel="noreferrer">
              Abrir @{bot} <ExternalLink size={13} />
            </a>
          </div>
          <p className="tg-note"><Loader2 size={13} className="auth-spin" /> Esperando confirmación… el código vence en {CODE_MINUTES} minutos.</p>
        </div>
      )}

      {error && (
        <div className="auth-alert error" role="alert"><span>{error}</span></div>
      )}
    </section>
  );
};
