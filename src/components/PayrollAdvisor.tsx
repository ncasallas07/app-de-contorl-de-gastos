import React, { useEffect, useMemo, useState } from 'react';
import { Scale } from 'lucide-react';
import type { DebtRecord, ExpenseRecord, SalaryProfile, StrategyMethod } from '../types/finance';
import { buildDebtPlan } from '../utils/debtPlanner';
import { advisePayroll, estimatePaycheck } from '../utils/payrollAdvisor';
import { getNextPaymentDate } from '../utils/contract';
import { formatCOP } from '../utils/money';
import { todayIso } from '../utils/date';
import { loadDebtGoal, saveEmergencyFund } from '../services/goalRepository';

interface Props {
  userId: string;
  salary: SalaryProfile;
  debts: DebtRecord[];
  expenses: ExpenseRecord[];
  method: StrategyMethod;
  onSaved: (message: string) => void;
}

const pct = (part: number, total: number) => (total > 0 ? `${(part / total) * 100}%` : '0%');

export const PayrollAdvisor: React.FC<Props> = ({ userId, salary, debts, expenses, method, onSaved }) => {
  const [targetMonths, setTargetMonths] = useState(12);
  const [savedFund, setSavedFund] = useState(0);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDebtGoal(userId).then((goal) => {
      if (cancelled || !goal) return;
      setTargetMonths(goal.targetMonths);
      setSavedFund(goal.emergencyFundMin);
      setDraft(goal.emergencyFundMin > 0 ? String(goal.emergencyFundMin) : '');
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const draftAmount = draft.trim() === '' ? 0 : Number(draft);
  const validDraft = Number.isFinite(draftAmount) && draftAmount >= 0;
  const fund = validDraft ? draftAmount : savedFund;

  // La misma función de utilidad que usa el agente el día de pago.
  const { advice, nextPay } = useMemo(() => {
    const plan = buildDebtPlan({ salary, debts, expenses, method, targetMonths, todayIso: todayIso() });
    const paycheck = estimatePaycheck(plan, salary);
    return {
      advice: advisePayroll({
        salary,
        debts,
        plan,
        paycheck,
        cushionNow: salary.currentBalance,
        emergencyFundMin: fund,
      }),
      nextPay: getNextPaymentDate(salary),
    };
  }, [salary, debts, expenses, method, targetMonths, fund]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validDraft) {
      setError('El colchón debe ser un monto en pesos, 0 o mayor.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveEmergencyFund(userId, Math.round(draftAmount));
      setSavedFund(Math.round(draftAmount));
      onSaved(draftAmount > 0
        ? `Colchón meta guardado: ${formatCOP(draftAmount)}.`
        : 'Colchón meta: un mes de gastos y cuotas.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el colchón.');
    } finally {
      setSaving(false);
    }
  };

  const nextPayLabel = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long' }).format(nextPay);
  const unsaved = validDraft && Math.round(draftAmount) !== savedFund;

  return (
    <section className="vt-card vt-pay" aria-label="Asesor de nómina">
      <div className="vt-card-head">
        <div>
          <p className="vt-kicker">Agente · capa 4 · utilidad</p>
          <h2 className="vt-card-title"><Scale size={15} /> Asesor de nómina</h2>
          <p className="vt-card-sub">
            Compara cómo repartir lo que te queda de cada pago y elige la opción de mayor utilidad.
          </p>
        </div>

        <form className="vt-dfp-goal" onSubmit={(event) => void save(event)}>
          <label htmlFor="pay-fund">Colchón meta</label>
          <input
            id="pay-fund"
            type="number"
            inputMode="numeric"
            min={0}
            step={50000}
            placeholder={String(advice.cushionTarget)}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="input-field vt-pay-fund"
          />
          <button type="submit" className="vt-btn vt-btn-sm vt-btn-lime" disabled={saving || !unsaved}>
            {unsaved ? 'Guardar' : 'Guardado'}
          </button>
        </form>
      </div>

      {error && <p className="vt-dfp-error" role="alert">{error}</p>}

      <div className="vt-pay-head">
        <span>Próximo pago · {nextPayLabel}</span>
        <strong>{formatCOP(advice.paycheck)}</strong>
      </div>

      <div className="vt-pay-bar" role="img"
        aria-label={`Gastos y cuotas ${formatCOP(advice.periodNeeds)}, a deuda ${formatCOP(advice.toDebt)}, a colchón ${formatCOP(advice.toSavings)}`}>
        <i className="needs" style={{ width: pct(Math.min(advice.periodNeeds, advice.paycheck), advice.paycheck) }} />
        <i className="debt" style={{ width: pct(advice.toDebt, advice.paycheck) }} />
        <i className="save" style={{ width: pct(advice.toSavings, advice.paycheck) }} />
      </div>
      <ul className="vt-pay-legend">
        <li><i className="needs" /> Gastos y cuotas <strong>{formatCOP(advice.periodNeeds)}</strong></li>
        <li><i className="debt" /> Abono a {advice.priorityDebt?.title ?? 'deudas'} <strong>{formatCOP(advice.toDebt)}</strong></li>
        <li><i className="save" /> Colchón <strong>{formatCOP(advice.toSavings)}</strong></li>
      </ul>

      {advice.available > 0 ? (
        <>
          <p className="vt-dfp-status ok">
            <Scale size={15} />
            <span>
              De los {formatCOP(advice.available)} disponibles, la mejor opción es
              {advice.toDebt > 0 && advice.priorityDebt ? ` abonar ${formatCOP(advice.toDebt)} a ${advice.priorityDebt.title}` : ''}
              {advice.toDebt > 0 && advice.toSavings > 0 ? ' y' : ''}
              {advice.toSavings > 0 ? ` ahorrar ${formatCOP(advice.toSavings)}` : ''}.
              {' '}Tienes {formatCOP(advice.cushionNow)} de un colchón de {formatCOP(advice.cushionTarget)}.
              {advice.meetsPlan === false && ` Tu plan sin deudas pide ${formatCOP(advice.planPerPayment ?? 0)} por pago: se prioriza el colchón.`}
            </span>
          </p>

          <div className="vt-pay-table-wrap">
            <table className="vt-pay-table">
              <caption>Opciones comparadas (pesos a 12 meses)</caption>
              <thead>
                <tr>
                  <th scope="col">A deuda</th>
                  <th scope="col">A colchón</th>
                  <th scope="col">Intereses ahorrados</th>
                  <th scope="col">Riesgo sin colchón</th>
                  <th scope="col">Utilidad</th>
                </tr>
              </thead>
              <tbody>
                {advice.options.map((option) => (
                  <tr key={option.toDebt} className={option.toDebt === advice.toDebt ? 'best' : ''}>
                    <td>{formatCOP(option.toDebt)}</td>
                    <td>{formatCOP(option.toSavings)}</td>
                    <td>{formatCOP(option.interestSaved)}</td>
                    <td>−{formatCOP(option.riskCost)}</td>
                    <td><strong>{formatCOP(option.utility)}</strong>{option.toDebt === advice.toDebt && <span className="vt-badge ok">Elegida</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="vt-dfp-status warn">
          <Scale size={15} />
          <span>Tu próximo pago se va completo en gastos y cuotas: no queda excedente para repartir.</span>
        </p>
      )}

      <p className="vt-dfp-note">
        Utilidad = intereses que te ahorras a 12 meses − costo esperado de quedarte sin colchón. El riesgo crece
        con el cuadrado de lo que le falta al colchón: el primer peso ahorrado vale mucho y cada peso extra vale
        menos. Un imprevisto sin colchón se valora al costo de un crédito caro (mínimo 30 % anual). Si todas
        las utilidades son negativas, el riesgo pesa más que el ahorro y se elige la menos negativa.
        El día de pago el agente hace este cálculo con el monto real y te lo envía.
      </p>
    </section>
  );
};
