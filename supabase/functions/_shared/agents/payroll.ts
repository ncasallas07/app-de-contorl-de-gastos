// CAPA 4 · Agente basado en utilidad: "Asesor de nómina".
//
// Se activa el día en que la capa 2 suma un pago al balance. Compara formas
// de repartir lo que queda del pago (abono extra a la deuda prioritaria o
// colchón de emergencia) con una función de utilidad en pesos y recomienda la
// de mayor utilidad. Usa el plan de la capa 3 para saber el gasto mensual, la
// deuda prioritaria y cuánto pide la meta por cada pago.
//
// La función de utilidad vive en finance/payrollAdvisor.ts (la misma de la app).

import type { DebtRecord, SalaryProfile } from '../finance/finance.ts';
import type { DebtPlan } from '../finance/debtPlanner.ts';
import { advisePayroll, type PayrollAdvice } from '../finance/payrollAdvisor.ts';
import { type AgentAction, formatCOP } from '../agentTypes.ts';

export interface PayrollAgentInput {
  salary: SalaryProfile;
  debts: DebtRecord[];
  plan: DebtPlan;
  payday: string;
  paycheck: number;
  /** Balance ya con el pago sumado. */
  balanceAfter: number;
  emergencyFundMin: number | null;
}

export function runPayroll(input: PayrollAgentInput): { advice: PayrollAdvice; actions: AgentAction[] } {
  const advice = advisePayroll({
    salary: input.salary,
    debts: input.debts,
    plan: input.plan,
    paycheck: input.paycheck,
    // Lo que había antes de que llegara este pago es el colchón actual.
    cushionNow: input.balanceAfter - input.paycheck,
    emergencyFundMin: input.emergencyFundMin,
  });

  const data = {
    payday: input.payday,
    paycheck: advice.paycheck,
    available: advice.available,
    periodNeeds: advice.periodNeeds,
    toDebt: advice.toDebt,
    toSavings: advice.toSavings,
    utility: advice.utility,
    cushionNow: advice.cushionNow,
    cushionTarget: advice.cushionTarget,
    priorityDebtId: advice.priorityDebt?.id ?? null,
    planPerPayment: advice.planPerPayment,
    meetsPlan: advice.meetsPlan,
    options: advice.options,
  };

  if (advice.available <= 0) {
    return {
      advice,
      actions: [{
        layer: 4,
        kind: 'pago_sin_excedente',
        severity: 'moderada',
        title: 'Tu pago de hoy se va completo en gastos y cuotas',
        message: `De tu pago de ${formatCOP(advice.paycheck)}, los gastos y cuotas del periodo suman `
          + `${formatCOP(advice.periodNeeds)}. No queda excedente para abonar ni ahorrar: revisa tus gastos hormiga.`,
        data,
        dedupeKey: `payroll:${input.payday}`,
        notify: false,
      }],
    };
  }

  const best = advice.options.find((option) => option.toDebt === advice.toDebt);
  const parts: string[] = [];
  if (advice.toDebt > 0 && advice.priorityDebt) {
    parts.push(`abona ${formatCOP(advice.toDebt)} a ${advice.priorityDebt.title} (${advice.priorityDebt.annualRate} % anual)`);
  }
  if (advice.toSavings > 0) {
    parts.push(`guarda ${formatCOP(advice.toSavings)} en tu colchón (tienes ${formatCOP(advice.cushionNow)} de `
      + `${formatCOP(advice.cushionTarget)})`);
  }

  const planNote = advice.meetsPlan === false
    ? ` Ojo: tu plan sin deudas pide ${formatCOP(advice.planPerPayment ?? 0)} por pago; con este reparto terminas un poco después, pero con menos riesgo.`
    : '';

  return {
    advice,
    actions: [{
      layer: 4,
      kind: 'reparto_nomina',
      severity: 'moderada',
      title: `Cómo repartir tu pago de hoy: ${formatCOP(advice.available)} disponibles`,
      message: `Después de separar ${formatCOP(advice.periodNeeds)} para gastos y cuotas, ${parts.join(' y ')}. `
        + `Es la opción de mayor utilidad: te ahorra ${formatCOP(best?.interestSaved ?? 0)} en intereses a 12 meses `
        + `con un riesgo de ${formatCOP(best?.riskCost ?? 0)} por quedarte sin colchón.${planNote}`,
      data,
      dedupeKey: `payroll:${input.payday}`,
      notify: true,
    }],
  };
}
