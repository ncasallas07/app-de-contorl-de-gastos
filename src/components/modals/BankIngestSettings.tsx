import React, { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Landmark, Loader2, ShieldAlert } from 'lucide-react';
import {
  type BankEventRow,
  bankIngestUrl,
  createIngestToken,
  type IngestStatus,
  loadIngestStatus,
  loadRecentBankEvents,
  revokeIngestToken,
} from '../../services/bankRepository';
import { formatCOP } from '../../utils/money';

const KIND_LABELS: Record<BankEventRow['kind'], string> = {
  compra: 'Compra',
  envio: 'Envío',
  rechazo: 'Rechazado',
  ingreso: 'Ingreso',
};

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Botón que copia un texto y confirma con un check durante 2 segundos. */
const CopyButton: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className="vt-btn vt-btn-sm" onClick={copy} aria-label={label}>
      {copied ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}
    </button>
  );
};

/** Sección de Ajustes: token y dirección para que los celulares envíen los avisos del banco. */
export const BankIngestSettings: React.FC = () => {
  const [status, setStatus] = useState<IngestStatus | null>(null);
  const [events, setEvents] = useState<BankEventRow[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'nuevo' | 'desactivar' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = bankIngestUrl();

  useEffect(() => {
    let alive = true;
    Promise.all([loadIngestStatus(), loadRecentBankEvents()]).then(([nextStatus, nextEvents]) => {
      if (!alive) return;
      setStatus(nextStatus);
      setEvents(nextEvents);
    });
    return () => {
      alive = false;
    };
  }, []);

  const generate = async () => {
    setError(null);
    setBusy(true);
    try {
      const value = await createIngestToken();
      setToken(value);
      setConfirming(null);
      setStatus(await loadIngestStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el token.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setError(null);
    setBusy(true);
    try {
      await revokeIngestToken();
      setToken(null);
      setConfirming(null);
      setStatus(await loadIngestStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo desactivar.');
    } finally {
      setBusy(false);
    }
  };

  const hasToken = Boolean(status?.createdAt);

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <span className="settings-icon"><Landmark size={16} /></span>
        <div>
          <h4>Avisos de los bancos</h4>
          <p>
            Tus celulares reenvían los SMS de Nequi y Daviplata a tu agente, que te propone el gasto en Telegram.
            Configura MacroDroid (Android) o Atajos (iPhone) con esta dirección y tu token.
          </p>
        </div>
      </div>

      {status === null && <p className="tg-note"><Loader2 size={14} className="auth-spin" /> Revisando…</p>}

      {status && !status.available && (
        <p className="tg-note">Aún no está activado en el servidor (falta ejecutar <code>supabase/banks.sql</code>).</p>
      )}

      {status?.available && (
        <div className="bk-body">
          {url && (
            <div className="bk-field">
              <span className="field-label">Dirección (URL)</span>
              <div className="bk-copy-row">
                <code className="bk-value">{url}</code>
                <CopyButton value={url} label="Copiar la dirección" />
              </div>
            </div>
          )}

          {token ? (
            <div className="bk-field">
              <span className="field-label">Tu token (encabezado <code>x-finsmart-token</code>)</span>
              <div className="bk-copy-row">
                <code className="bk-value bk-token">{token}</code>
                <CopyButton value={token} label="Copiar el token" />
              </div>
              <p className="bk-warn">
                <ShieldAlert size={13} /> Solo se muestra esta vez. Pégalo en tus celulares y no lo compartas:
                quien lo tenga puede enviarte avisos falsos. Si lo pierdes, genera otro.
              </p>
            </div>
          ) : hasToken ? (
            <p className="tg-note">
              <KeyRound size={13} /> Token activo desde el {dateTime(status.createdAt!)} ·{' '}
              {status.lastUsedAt ? `último aviso: ${dateTime(status.lastUsedAt)}` : 'aún no ha llegado ningún aviso'}
            </p>
          ) : null}

          {confirming ? (
            <div className="bk-confirm" role="alert">
              <span>
                {confirming === 'nuevo'
                  ? 'El token actual dejará de funcionar y tendrás que pegar el nuevo en tus celulares. ¿Continuar?'
                  : 'Tus celulares dejarán de enviar avisos hasta que generes otro token. ¿Desactivar?'}
              </span>
              <div className="settings-actions">
                <button type="button" className="vt-btn vt-btn-sm" onClick={() => setConfirming(null)} disabled={busy}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="vt-btn vt-btn-sm vt-btn-lime"
                  onClick={confirming === 'nuevo' ? generate : revoke}
                  disabled={busy}
                >
                  {busy ? <Loader2 size={14} className="auth-spin" /> : 'Sí, continuar'}
                </button>
              </div>
            </div>
          ) : (
            <div className="settings-actions">
              {hasToken && (
                <button type="button" className="vt-btn vt-btn-sm" onClick={() => setConfirming('desactivar')} disabled={busy}>
                  Desactivar
                </button>
              )}
              <button
                type="button"
                className="vt-btn vt-btn-sm vt-btn-lime"
                onClick={hasToken ? () => setConfirming('nuevo') : generate}
                disabled={busy}
              >
                {busy ? <Loader2 size={14} className="auth-spin" /> : hasToken ? 'Generar uno nuevo' : 'Generar token'}
              </button>
            </div>
          )}

          {events.length > 0 && (
            <div className="bk-events">
              <h5>Últimos avisos recibidos</h5>
              <ul>
                {events.map((event) => (
                  <li key={event.id}>
                    <span className={`vt-badge ${event.kind === 'rechazo' ? 'warn' : event.kind === 'ingreso' ? 'ok' : ''}`}>
                      {KIND_LABELS[event.kind]}
                    </span>
                    <span className="bk-event-main">
                      {event.bank}{event.merchant ? ` · ${event.merchant}` : ''}
                    </span>
                    <strong>{formatCOP(event.amount)}</strong>
                    <small>{dateTime(event.receivedAt)}{event.source === 'prueba' ? ' · prueba' : ''}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <div className="auth-alert error" role="alert"><span>{error}</span></div>}
    </section>
  );
};
