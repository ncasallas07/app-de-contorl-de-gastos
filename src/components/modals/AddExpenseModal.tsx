import React, { useMemo, useState } from 'react';
import { Bot, Bug, Plus, X } from 'lucide-react';
import { ExpenseCategory, ExpenseRecord } from '../../types/finance';
import { todayIso } from '../../utils/date';
import { antTagFor, type ExpensePrediction, type FeedbackRecord } from '../../utils/antLearner';

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  alimentacion: 'Alimentación',
  vivienda: 'Vivienda',
  servicios: 'Servicios',
  transporte: 'Transporte',
  salud: 'Salud',
  educacion: 'Educación',
  ocio: 'Ocio',
  cafe_snacks: 'Café y snacks',
  suscripciones: 'Suscripciones',
  compras_impulso: 'Compras de impulso',
  otros: 'Otros',
};

/** La sugerencia se muestra si el modelo conoce alguna palabra y tiene confianza suficiente. */
const MIN_CONFIDENCE = 0.4;

interface Props {
  isOpen: boolean;
  currency: string;
  initialDate?: string;
  onClose: () => void;
  onAdd: (expense: Omit<ExpenseRecord, 'id'>) => void;
  /** Detector que aprende (capa 5): sugiere categoría y si es hormiga. */
  suggest?: (title: string, amount?: number) => ExpensePrediction | null;
  /** Se llama al guardar un gasto que tuvo sugerencia (aceptada o corregida). */
  onFeedback?: (row: FeedbackRecord) => void;
}

export const AddExpenseModal: React.FC<Props> = ({ isOpen, ...formProps }) => {
  if (!isOpen) return null;

  return <ExpenseForm key={formProps.initialDate ?? 'today'} {...formProps} />;
};

const ExpenseForm: React.FC<Omit<Props, 'isOpen'>> = ({
  currency,
  initialDate,
  onClose,
  onAdd,
  suggest,
  onFeedback,
}) => {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('alimentacion');
  const [date, setDate] = useState(() => initialDate || todayIso());
  const [isAntExpense, setIsAntExpense] = useState(false);
  const [antTag, setAntTag] = useState<ExpenseRecord['antTag']>('cafe_chucherias');
  const [notes, setNotes] = useState('');
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [antTouched, setAntTouched] = useState(false);
  const [tagTouched, setTagTouched] = useState(false);

  const prediction = useMemo(() => {
    if (!suggest || title.trim().length < 3) return null;
    const result = suggest(title, Number(amount) > 0 ? Number(amount) : undefined);
    return result && result.knownTokens > 0 && result.categoryConfidence >= MIN_CONFIDENCE ? result : null;
  }, [suggest, title, amount]);

  // Mientras el usuario no elija a mano, se usa lo que sugiere el agente.
  const finalCategory = categoryTouched || !prediction ? category : prediction.category;
  const finalAnt = antTouched || !prediction ? isAntExpense : prediction.isAnt;
  const finalTag = tagTouched ? antTag : antTagFor(finalCategory);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const num = parseFloat(amount);
    if (!title || isNaN(num) || num <= 0) return;

    onAdd({
      title,
      amount: num,
      category: finalCategory,
      date,
      isAntExpense: finalAnt,
      antTag: finalAnt ? finalTag : undefined,
      notes: notes.trim() ? notes.trim() : undefined,
    });

    // El crítico: se registra si la sugerencia se aceptó o se corrigió.
    if (prediction && onFeedback) {
      onFeedback({
        concept: title,
        suggestedCategory: prediction.category,
        finalCategory,
        suggestedAnt: prediction.isAnt,
        finalAnt,
      });
    }

    setTitle('');
    setAmount('');
    setIsAntExpense(false);
    setNotes('');
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="expense-modal-title">
        <div className="modal-head">
          <div>
            <p className="vt-kicker">Nuevo movimiento</p>
            <h3 id="expense-modal-title" className="modal-title">
              <Plus size={16} /> Registrar gasto
            </h3>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={17} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <label className="field">
            <span className="field-label">Concepto *</span>
            <input
              id="expense-title-input"
              type="text"
              required
              placeholder="Ej. Supermercado, almuerzo, gasolina..."
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="input-field"
              aria-describedby={prediction ? 'expense-agent-hint' : undefined}
            />
            {prediction && (
              <small id="expense-agent-hint" className="vt-agent-hint">
                <Bot size={12} />
                El agente sugiere: <strong>{CATEGORY_LABELS[prediction.category]}</strong>
                {' · '}
                {prediction.isAnt ? 'gasto hormiga' : 'no es hormiga'}
                {' '}({Math.min(99, Math.round((prediction.isAnt ? prediction.antProbability : 1 - prediction.antProbability) * 100))} %)
              </small>
            )}
          </label>

          <div className="form-grid">
            <label className="field">
              <span className="field-label">Monto ({currency}) *</span>
              <input
                id="expense-amount-input"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="input-field input-money"
              />
            </label>

            <label className="field">
              <span className="field-label">Fecha *</span>
              <input
                id="expense-date-input"
                type="date"
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="input-field"
              />
            </label>
          </div>

          <label className="field">
            <span className="field-label">Categoría</span>
            <select
              id="expense-category-select"
              value={finalCategory}
              onChange={(event) => {
                setCategory(event.target.value as ExpenseCategory);
                setCategoryTouched(true);
              }}
              className="input-field"
            >
              <option value="alimentacion">Alimentación / Supermercado</option>
              <option value="vivienda">Vivienda (alquiler, mantenimiento)</option>
              <option value="servicios">Servicios (luz, agua, gas, internet)</option>
              <option value="transporte">Transporte (gasolina, metro, bus)</option>
              <option value="salud">Salud y farmacia</option>
              <option value="educacion">Educación</option>
              <option value="ocio">Ocio y salidas</option>
              <option value="cafe_snacks">Café, golosinas y snacks</option>
              <option value="suscripciones">Suscripciones digitales</option>
              <option value="compras_impulso">Compras de impulso</option>
              <option value="otros">Otros</option>
            </select>
          </label>

          <div className={`ant-toggle ${finalAnt ? 'on' : ''}`}>
            <label className="ant-toggle-head">
              <div className="ant-toggle-copy">
                <Bug size={16} />
                <div>
                  <strong>¿Es un gasto hormiga?</strong>
                  <span>Micropago no planificado, delivery o antojo.</span>
                </div>
              </div>
              <input
                id="expense-ant-checkbox"
                type="checkbox"
                checked={finalAnt}
                onChange={(event) => {
                  setIsAntExpense(event.target.checked);
                  setAntTouched(true);
                }}
              />
            </label>

            {finalAnt && (
              <label className="field ant-toggle-field">
                <span className="field-label">Tipo de gasto hormiga</span>
                <select
                  value={finalTag}
                  onChange={(event) => {
                    setAntTag(event.target.value as ExpenseRecord['antTag']);
                    setTagTouched(true);
                  }}
                  className="input-field"
                >
                  <option value="cafe_chucherias">Café, snacks, golosinas</option>
                  <option value="delivery">Delivery de comida por pereza</option>
                  <option value="suscripcion_olvidada">Suscripción que no uso</option>
                  <option value="transporte_evitable">Taxi / VMP evitable</option>
                  <option value="antojo_impulso">Antojo o capricho en tienda</option>
                  <option value="otro_hormiga">Otro micropago</option>
                </select>
              </label>
            )}
          </div>

          <label className="field">
            <span className="field-label">Notas <em>opcional</em></span>
            <input
              type="text"
              placeholder="Detalles sobre este gasto..."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="input-field"
            />
          </label>

          <div className="modal-actions">
            <button type="button" className="vt-btn" onClick={onClose}>
              Cancelar
            </button>
            <button id="btn-submit-expense" type="submit" className="vt-btn vt-btn-lime">
              Guardar gasto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
