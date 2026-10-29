// ARCHIVO GENERADO desde src/types/finance.ts con "npm run agent:sync". No editar aquí.

export type CurrencyCode = 'COP';

export type CloudSyncStatus = 'loading' | 'saving' | 'synced' | 'error';

export type ContractType = 'indefinido' | 'obra_labor';
export type PayMode = 'mensual' | 'dia' | 'hora';
export type WorkShift = 'diurno' | 'nocturno' | 'mixto';

export interface SalaryProfile {
  contractType: ContractType;
  payMode: PayMode;
  monthlySalary: number;
  dailyRate: number;
  hourlyRate: number;
  workDaysPerWeek: number;
  paymentWeekday: number; // 1 = lunes, 7 = domingo
  defaultShift: WorkShift;
  hoursPerShift: number;
  paymentPeriod: 'mensual' | 'quincenal' | 'semanal';
  paymentDayOfMonth: number; // Ej. día 15 o 30
  workDaysPerMonthTarget: number; // Ej. 20 o 22 días estándar
  currentBalance: number;
  currency: CurrencyCode;
}

export type WorkDayType = 'laboral' | 'extra' | 'medio_dia' | 'descanso';

export interface WorkDayRecord {
  date: string; // YYYY-MM-DD
  type: WorkDayType;
  shift?: WorkShift;
  hoursWorked?: number;
  notes?: string;
  dailyEarnings?: number; // Calculado en base al salario o tarifa
}

export type ExpenseCategory = 
  | 'vivienda'
  | 'alimentacion'
  | 'transporte'
  | 'servicios'
  | 'salud'
  | 'educacion'
  | 'ocio'
  | 'cafe_snacks'
  | 'suscripciones'
  | 'compras_impulso'
  | 'otros';

export interface ExpenseRecord {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  category: ExpenseCategory;
  amount: number;
  isAntExpense: boolean; // Gasto hormiga identificado
  antTag?: 'cafe_chucherias' | 'delivery' | 'suscripcion_olvidada' | 'transporte_evitable' | 'antojo_impulso' | 'otro_hormiga';
  notes?: string;
}

export type DebtCategory = 'tarjeta_credito' | 'prestamo_personal' | 'prestamo_auto' | 'hipoteca' | 'amigo_familiar' | 'servicios_atrasados';

export interface DebtRecord {
  id: string;
  title: string;
  category: DebtCategory;
  totalAmount: number; // Saldo pendiente total
  monthlyPayment: number; // Cuota mínima o acordada
  annualInterestRate: number; // TAE / Tasa anual en % (ej. 24.5)
  dueDate: string; // YYYY-MM-DD fecha próxima cuota
  paymentStatus: 'pendiente' | 'pagado_mes' | 'liquidada';
  minimumPaymentOnly: boolean;
  notes?: string;
}

export type StrategyMethod = 'bola_de_nieve' | 'avalancha';

export interface FinancialHealthScore {
  score: number; // 0 - 100
  label: 'Crítico' | 'Regular' | 'Aceptable' | 'Saludable' | 'Excelente';
  debtToIncomeRatio: number; // Porcentaje de deudas vs sueldo
  savingsRate: number; // Porcentaje de ahorro mensual
  antExpenseImpact: number; // Porcentaje de sueldo fugado en gastos hormiga
}

export interface ActionAdvice {
  id: string;
  severity: 'urgente' | 'alta' | 'moderada' | 'positiva';
  title: string;
  description: string;
  impactEstimate?: string;
  category: 'deuda' | 'gasto_hormiga' | 'salario' | 'ahorro';
  suggestedActionText: string;
}
