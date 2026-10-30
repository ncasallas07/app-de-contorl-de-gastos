import React, { useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  Settings2,
  UserRound,
  X,
} from 'lucide-react';
import { useAuth } from '../../auth/authContext';
import { TelegramSettings } from './TelegramSettings';

interface Props {
  isOpen: boolean;
  userEmail: string;
  displayName: string;
  onClose: () => void;
  onOpenSalary: () => void;
}

interface Feedback {
  type: 'error' | 'success';
  text: string;
}

export const UserSettingsModal: React.FC<Props> = ({ isOpen, ...formProps }) => {
  if (!isOpen) return null;

  return <SettingsForm {...formProps} />;
};

const SettingsForm: React.FC<Omit<Props, 'isOpen'>> = ({
  userEmail,
  displayName,
  onClose,
  onOpenSalary,
}) => {
  const { updateDisplayName, changeEmail, changePassword } = useAuth();
  const [name, setName] = useState(displayName);
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nameFeedback, setNameFeedback] = useState<Feedback | null>(null);
  const [emailFeedback, setEmailFeedback] = useState<Feedback | null>(null);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const handleNameSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setNameFeedback(null);

    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameFeedback({ type: 'error', text: 'El nombre debe tener al menos 2 caracteres.' });
      return;
    }

    setSavingName(true);
    try {
      const result = await updateDisplayName(trimmed);
      if (result.error) {
        setNameFeedback({ type: 'error', text: result.error });
        return;
      }
      setName(trimmed);
      setNameFeedback({ type: 'success', text: result.message ?? 'Nombre actualizado.' });
    } finally {
      setSavingName(false);
    }
  };

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailFeedback(null);

    if (!newEmail.trim()) {
      setEmailFeedback({ type: 'error', text: 'Escribe el nuevo correo electrónico.' });
      return;
    }
    if (!emailPassword) {
      setEmailFeedback({ type: 'error', text: 'Confirma tu contraseña actual.' });
      return;
    }

    setSavingEmail(true);
    try {
      const result = await changeEmail(newEmail, emailPassword);
      if (result.error) {
        setEmailFeedback({ type: 'error', text: result.error });
        return;
      }
      setNewEmail('');
      setEmailPassword('');
      setEmailFeedback({
        type: 'success',
        text: result.message ?? 'Te enviamos un correo de confirmación.',
      });
    } finally {
      setSavingEmail(false);
    }
  };

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordFeedback(null);

    if (!currentPassword) {
      setPasswordFeedback({ type: 'error', text: 'Escribe tu contraseña actual.' });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordFeedback({ type: 'error', text: 'La contraseña nueva debe tener al menos 6 caracteres.' });
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordFeedback({ type: 'error', text: 'La contraseña nueva debe ser diferente a la actual.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: 'error', text: 'Las contraseñas nuevas no coinciden.' });
      return;
    }

    setSavingPassword(true);
    try {
      const result = await changePassword(currentPassword, newPassword);
      if (result.error) {
        setPasswordFeedback({ type: 'error', text: result.error });
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordFeedback({
        type: 'success',
        text: result.message ?? 'Contraseña actualizada.',
      });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div
        className="modal-content settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <div className="modal-head">
          <div>
            <p className="vt-kicker">TU CUENTA</p>
            <h3 id="settings-modal-title" className="modal-title">
              <Settings2 size={16} /> Ajustes de cuenta
            </h3>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={17} />
          </button>
        </div>

        <div className="settings-intro">
          <span className="settings-intro-badge">{name.trim().charAt(0).toUpperCase() || 'F'}</span>
          <div>
            <strong>{name.trim() || displayName}</strong>
            <span>{userEmail}</span>
          </div>
        </div>

        <section className="settings-section">
          <div className="settings-section-head">
            <span className="settings-icon"><UserRound size={16} /></span>
            <div>
              <h4>Nombre</h4>
              <p>Así te saludaremos dentro de FinSmart.</p>
            </div>
          </div>

          <form className="modal-form" onSubmit={handleNameSubmit}>
            <label className="field">
              <span className="field-label">Nombre visible</span>
              <input
                type="text"
                className="input-field"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                autoComplete="name"
                disabled={savingName}
                required
              />
            </label>

            {nameFeedback && (
              <div className={`auth-alert ${nameFeedback.type}`} role={nameFeedback.type === 'error' ? 'alert' : 'status'}>
                {nameFeedback.type === 'success' && <CheckCircle2 size={15} />}
                <span>{nameFeedback.text}</span>
              </div>
            )}

            <div className="settings-actions">
              <button type="submit" className="vt-btn vt-btn-sm vt-btn-lime" disabled={savingName}>
                {savingName ? <Loader2 size={14} className="auth-spin" /> : 'Guardar nombre'}
              </button>
            </div>
          </form>
        </section>

        <section className="settings-section">
          <div className="settings-section-head">
            <span className="settings-icon"><Mail size={16} /></span>
            <div>
              <h4>Correo electrónico</h4>
              <p>El cambio requiere confirmación por correo.</p>
            </div>
          </div>

          <form className="modal-form" onSubmit={handleEmailSubmit}>
            <label className="field">
              <span className="field-label">Correo actual</span>
              <input type="email" className="input-field" value={userEmail} disabled readOnly />
            </label>

            <div className="form-grid">
              <label className="field">
                <span className="field-label">Correo nuevo</span>
                <input
                  type="email"
                  className="input-field"
                  placeholder="nuevo@correo.com"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  autoComplete="email"
                  disabled={savingEmail}
                  required
                />
              </label>

              <label className="field">
                <span className="field-label">Contraseña actual</span>
                <input
                  type="password"
                  className="input-field"
                  placeholder="Para confirmar el cambio"
                  value={emailPassword}
                  onChange={(event) => setEmailPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={savingEmail}
                  required
                />
              </label>
            </div>

            {emailFeedback && (
              <div className={`auth-alert ${emailFeedback.type}`} role={emailFeedback.type === 'error' ? 'alert' : 'status'}>
                {emailFeedback.type === 'success' && <CheckCircle2 size={15} />}
                <span>{emailFeedback.text}</span>
              </div>
            )}

            <div className="settings-actions">
              <button type="submit" className="vt-btn vt-btn-sm vt-btn-lime" disabled={savingEmail}>
                {savingEmail ? <Loader2 size={14} className="auth-spin" /> : 'Solicitar cambio de correo'}
              </button>
            </div>
          </form>
        </section>

        <section className="settings-section">
          <div className="settings-section-head">
            <span className="settings-icon"><KeyRound size={16} /></span>
            <div>
              <h4>Contraseña</h4>
              <p>Verificamos tu contraseña actual antes de cambiarla.</p>
            </div>
          </div>

          <form className="modal-form" onSubmit={handlePasswordSubmit}>
            <label className="field">
              <span className="field-label">Contraseña actual</span>
              <input
                type="password"
                className="input-field"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                disabled={savingPassword}
                required
              />
            </label>

            <div className="form-grid">
              <label className="field">
                <span className="field-label">Contraseña nueva</span>
                <input
                  type="password"
                  className="input-field"
                  placeholder="Mínimo 6 caracteres"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={6}
                  disabled={savingPassword}
                  required
                />
              </label>

              <label className="field">
                <span className="field-label">Confirmar contraseña nueva</span>
                <input
                  type="password"
                  className="input-field"
                  placeholder="Repite la contraseña"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={6}
                  disabled={savingPassword}
                  required
                />
              </label>
            </div>

            {passwordFeedback && (
              <div className={`auth-alert ${passwordFeedback.type}`} role={passwordFeedback.type === 'error' ? 'alert' : 'status'}>
                {passwordFeedback.type === 'success' && <CheckCircle2 size={15} />}
                <span>{passwordFeedback.text}</span>
              </div>
            )}

            <div className="settings-actions">
              <button type="submit" className="vt-btn vt-btn-sm vt-btn-lime" disabled={savingPassword}>
                {savingPassword ? <Loader2 size={14} className="auth-spin" /> : 'Actualizar contraseña'}
              </button>
            </div>
          </form>
        </section>

        <TelegramSettings />

        <section className="settings-section settings-section-inline">
          <div className="settings-section-head">
            <span className="settings-icon"><LockKeyhole size={16} /></span>
            <div>
              <h4>Contrato y jornada</h4>
              <p>Edita tu contrato, tarifa, turno, horas y día de pago.</p>
            </div>
          </div>
          <button type="button" className="vt-btn vt-btn-sm" onClick={onOpenSalary}>
            Abrir configuración
          </button>
        </section>
      </div>
    </div>
  );
};
