import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarCheck, CircleCheck, Flag, PiggyBank, Target, Wallet } from 'lucide-react';
import type { DebtRecord, ExpenseRecord, SalaryProfile, StrategyMethod } from '../types/finance';
import { buildDebtPlan, type DebtPlan, monthName, remainingByMonth } from '../utils/debtPlanner';
import { formatCOP } from '../utils/money';
import { todayIso } from '../utils/date';
import { loadDebtGoal, saveDebtGoal } from '../services/goalRepository';

interface Props {
  userId: string;
  salary: SalaryProfile;
  debts: DebtRecord[];
  expenses: ExpenseRecord[];
  method: StrategyMethod;
  onSaved: (message: string) => void;
}

const DEFAULT_TARGET = 12;

function statusLine(plan: DebtPlan): { tone: 'ok' | 'warn' | 'danger'; text: string } {
  switch (plan.status) {
    case 'alcanzable':
      return {
        tone: 'ok',
        text: plan.requiredExtra > 0
          ? `Tu meta es alcanzable: abona ${formatCOP(plan.requiredExtra)} extra al mes a ${plan.priorityDebt?.title}.`
          : 'Tu meta es alcanzable solo con las cuotas mínimas.',
      };
    case 'inalcanzable':
      return {
        tone: 'warn',
        text: `Para ${plan.targetMonths} meses necesitas ${formatCOP(plan.requiredExtra)} extra al mes y te quedan `
          + `${formatCOP(plan.extraCapacity)}. Con eso terminas en ${plan.months} meses.`,
      };
    case 'sin_capacidad':
      return {
        tone: 'danger',
        text: plan.stuckDebts.length > 0
          ? `La cuota de ${plan.stuckDebts.join(', ')} no cubre los intereses y no te queda dinero para abonar extra.`
          : 'Con tus ingresos y gastos actuales no te queda dinero para abonar a las deudas.',
      };
    default:
      return { tone: 'ok', text: 'No tienes deudas activas.' };
  }
}

/** Gráfico del saldo total que queda cada mes, con la meta marcada. */
function BalanceChart({ plan }: { plan: DebtPlan }) {
  const series = remainingByMonth(plan).slice(0, 120);
  if (series.length < 2) return null;

  // La curva se estira al ancho disponible; las etiquetas son texto normal.
  const W = 100;
  const H = 40;
  const max = Math.max(...series.map((point) => point.remaining), 1);
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (value: number) => 2 + (1 - value / max) * (H - 2);
  const line = series.map((point, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(point.remaining).toFixed(2)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const targetIndex = plan.targetMonths - 1;
  const targetLeft = targetIndex < series.length ? (targetIndex / (series.length - 1)) * 100 : null;

  return (
    <figure className="vt-dfp-chart">
      <div className="vt-dfp-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
          aria-label={`Saldo total de deudas mes a mes: de ${formatCOP(series[0].remaining)} a cero en ${series.length} meses`}>
          <path d={area} className="vt-dfp-area" />
          <path d={line} className="vt-dfp-line" vectorEffect="non-scaling-stroke" />
        </svg>
        {targetLeft !== null && (
          <span className="vt-dfp-target" style={{ left: `${targetLeft}%` }}>
            <i>Meta</i>
          </span>
        )}
        <span className="vt-dfp-max">{formatCOP(max)}</span>
      </div>
      <div className="vt-dfp-axis">
        <span>{monthName(series[0].month)}</span>
        <span>{monthName(series[series.length - 1].month)}</span>
      </div>
      <figcaption>Saldo total de tus deudas al final de cada mes</figcaption>
    </figure>
  );
}

export const DebtFreePlan: React.FC<Props> = ({ userId, salary, debts, expenses, method, onSaved }) => {
  const [savedTarget, setSavedTarget] = useState<number | null>(null);
  const [draft, setDraft] = useState(String(DEFAULT_TARGET));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDebtGoal(userId).then((goal) => {
      if (cancelled || !goal) return;
      setSavedTarget(goal.targetMonths);
      setDraft(String(goal.targetMonths));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const draftMonths = Number(draft);
  const validDraft = Number.isInteger(draftMonths) && draftMonths >= 1 && draftMonths <= 120;
  const targetMonths = validDraft ? draftMonths : savedTarget ?? DEFAULT_TARGET;

  // La misma simulación que usa el agente cada día.
  const plan = useMemo(() => buildDebtPlan({
    salary,
    debts,
    expenses,
    method,
    targetMonths,
    todayIso: todayIso(),
  }), [salary, debts, expenses, method, targetMonths]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validDraft) {
      setError('La meta debe ser un número entero de meses entre 1 y 120.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveDebtGoal(userId, draftMonths);
      setSavedTarget(draftMonths);
      onSaved(`Meta guardada: sin deudas en ${draftMonths} meses. El agente la revisará cada día.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar la meta.');
    } finally {
      setSaving(false);
    }
  };

  const status = statusLine(plan);
  const unsaved = validDraft && draftMonths !== savedTarget;

  return (
    <section className="vt-card vt-dfp" aria-label="Plan sin deudas">
      <div className="vt-card-head">
        <div>
          <p className="vt-kicker">Agente · capa 3 · objetivos</p>
          <h2 className="vt-card-title"><Target size={15} /> Plan sin deudas</h2>
          <p className="vt-card-sub">
            Simula mes a mes tus deudas con sus intereses y calcula cuánto abonar para cumplir tu meta.
          </p>
        </div>

        <form className="vt-dfp-goal" onSubmit={(event) => void save(event)}>
          <label htmlFor="dfp-target">Meta</label>
          <input
            id="dfp-target"
            type="number"
            inputMode="numeric"
            min={1}
            max={120}
            step={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="input-field"
            aria-describedby="dfp-target-unit"
          />
          <span id="dfp-target-unit">meses</span>
          <button type="submit" className="vt-btn vt-btn-sm vt-btn-lime" disabled={saving || !unsaved}>
            {savedTarget === null ? 'Fijar meta' : unsaved ? 'Guardar' : 'Guardada'}
          </button>
        </form>
      </div>

      {error && <p className="vt-dfp-error" role="alert">{error}</p>}

      {plan.status === 'sin_deudas' ? (
        <div className="vt-clear-inline">
          <CircleCheck size={17} />
          <span>No tienes deudas activas. No hay nada que planificar.</span>
        </div>
      ) : (
        <>
          <p className={`vt-dfp-status ${status.tone}`}>
            {status.tone === 'ok' ? <CircleCheck size={15} /> : <AlertTriangle size={15} />}
            <span>{status.text}</span>
          </p>

          <div className="vt-metric-grid vt-dfp-metrics">
            <div className="vt-metric">
              <span><Wallet size={12} /> Abono extra al mes</span>
              <strong>{formatCOP(plan.planExtra)}</strong>
              <small>Te quedan {formatCOP(plan.extraCapacity)} libres al mes</small>
            </div>
            <div className="vt-metric">
              <span><CalendarCheck size={12} /> Terminas en</span>
              <strong>{plan.endMonth ? monthName(plan.endMonth) : 'Sin fecha'}</strong>
              <small>{plan.months !== null ? `${plan.months} meses · meta: ${plan.targetMonths}` : 'Al ritmo actual no termina'}</small>
            </div>
            <div className="vt-metric">
              <span><PiggyBank size={12} /> Intereses ahorrados</span>
              <strong>{formatCOP(plan.interestSaved)}</strong>
              <small>Frente a pagar solo las cuotas mínimas</small>
            </div>
          </div>

          <BalanceChart plan={plan} />

          <div className="vt-dfp-order">
            <h3><Flag size={13} /> Orden en que terminas cada deuda</h3>
            <ol>
              {plan.payoffOrder.map((item) => (
                <li key={item.debtId}>
                  <strong>{item.title}</strong>
                  <span>{item.month ? monthName(item.month) : 'No termina al ritmo actual'}</span>
                </li>
              ))}
            </ol>
          </div>

          <p className="vt-dfp-note">
            Ingreso {formatCOP(plan.monthlyIncome)} · gasto mensual {formatCOP(plan.monthlySpending)}
            {plan.spendingSource === 'gastos'
              ? ' (promedio de tus gastos de los últimos 90 días)'
              : ' (estimado: 50 % del ingreso, aún no registras gastos)'}
            {' '}· cuotas mínimas {formatCOP(plan.totalMinimums)}. Interés mensual = tasa anual ÷ 12.
            El agente revisa este plan cada día y te avisa si deja de alcanzar.
          </p>
        </>
      )}
    </section>
  );
};
