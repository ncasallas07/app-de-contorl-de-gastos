import React from 'react';
import { Banknote, BriefcaseBusiness, CalendarDays, Clock3, SunMoon, Wallet } from 'lucide-react';
import { ContractType, PayMode, WorkShift } from '../../types/finance';
import {
  CONTRACT_TYPE_LABELS,
  PAY_MODE_LABELS,
  SHIFT_LABELS,
  WEEKDAY_OPTIONS,
} from '../../utils/contract';
import type { ContractFormState } from './contractForm';
import { formatCOP } from '../../utils/money';

interface Props {
  values: ContractFormState;
  onChange: (patch: Partial<ContractFormState>) => void;
  variant: 'auth' | 'modal';
  showBalance?: boolean;
  disabled?: boolean;
}

export const ContractFields: React.FC<Props> = ({
  values,
  onChange,
  variant,
  showBalance = true,
  disabled = false,
}) => {
  const isObra = values.contractType === 'obra_labor';
  const fieldClass = variant === 'auth' ? 'auth-field' : 'field';
  const controlClass = variant === 'auth' ? 'auth-input' : '';
  const inputClass = variant === 'auth' ? '' : 'input-field';
  const labelClass = variant === 'auth' ? undefined : 'field-label';
  const gridClass = variant === 'auth' ? 'onboarding-grid' : 'form-grid';

  const field = (
    label: string,
    control: React.ReactNode,
    icon?: React.ReactNode,
    note?: string
  ) => (
    <label className={fieldClass}>
      <span className={labelClass}>{label}</span>
      {variant === 'auth' ? (
        <div className={controlClass}>
          {icon}
          {control}
        </div>
      ) : control}
      {note && <small className="field-note">{note}</small>}
    </label>
  );

  const numberInput = (
    value: string,
    onChangeValue: (value: string) => void,
    props: React.InputHTMLAttributes<HTMLInputElement>
  ) => (
    <input
      type="number"
      inputMode="decimal"
      value={value}
      onChange={(event) => onChangeValue(event.target.value)}
      disabled={disabled}
      className={inputClass}
      {...props}
    />
  );

  const select = (
    value: string,
    onChangeValue: (value: string) => void,
    options: { value: string; label: string }[]
  ) => (
    <select
      value={value}
      onChange={(event) => onChangeValue(event.target.value)}
      disabled={disabled}
      className={inputClass}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );

  const contractOptions = (Object.keys(CONTRACT_TYPE_LABELS) as ContractType[]).map((value) => ({
    value,
    label: CONTRACT_TYPE_LABELS[value],
  }));
  const shiftOptions = (Object.keys(SHIFT_LABELS) as WorkShift[]).map((value) => ({
    value,
    label: SHIFT_LABELS[value],
  }));
  const payModeOptions = (Object.keys(PAY_MODE_LABELS) as PayMode[])
    .filter((value) => value !== 'mensual')
    .map((value) => ({ value, label: PAY_MODE_LABELS[value] }));
  const weekdayOptions = WEEKDAY_OPTIONS.map((option) => ({
    value: String(option.value),
    label: option.label,
  }));

  const rate = isObra
    ? Number(values.payMode === 'hora' ? values.hourlyRate : values.dailyRate) || 0
    : 0;
  const fixedHours = Number(values.hoursPerShift) || 8;
  const workDaysPerWeek = Number(values.workDaysPerWeek) || 5;
  const dailyEstimate = isObra
    ? (values.payMode === 'hora' ? rate * fixedHours : rate)
    : Number(values.monthlySalary) > 0
      ? Number(values.monthlySalary) / (Number(values.workDaysPerMonthTarget) || 22)
      : 0;
  const weeklyEstimate = dailyEstimate * workDaysPerWeek;

  return (
    <>
      <div className={gridClass}>
        {field(
          'Tipo de contrato',
          select(values.contractType, (value) => {
            const contractType = value as ContractType;
            onChange({
              contractType,
              payMode: contractType === 'obra_labor'
                ? (values.payMode === 'hora' ? 'hora' : 'dia')
                : 'mensual',
            });
          }, contractOptions),
          <BriefcaseBusiness size={15} />
        )}
        {isObra
          ? field(
            'Forma de pago',
            select(values.payMode, (value) => onChange({ payMode: value as PayMode }), payModeOptions),
            <Banknote size={15} />
          )
          : field(
            'Salario mensual (COP)',
            numberInput(values.monthlySalary, (value) => onChange({ monthlySalary: value }), {
              min: '1',
              step: '1',
              placeholder: 'Ej. 2650000',
              required: true,
            }),
            <Wallet size={15} />
          )}
      </div>

      {isObra && (
        <div className={gridClass}>
          {field(
            values.payMode === 'hora' ? 'Valor por hora (COP)' : 'Tarifa diaria (COP)',
            numberInput(
              values.payMode === 'hora' ? values.hourlyRate : values.dailyRate,
              (value) => onChange(values.payMode === 'hora' ? { hourlyRate: value } : { dailyRate: value }),
              { min: '1', step: '1', placeholder: 'Ej. 120000', required: true }
            ),
            <Wallet size={15} />
          )}
          {field(
            'Día de pago semanal',
            select(values.paymentWeekday, (value) => onChange({ paymentWeekday: value }), weekdayOptions),
            <CalendarDays size={15} />
          )}
        </div>
      )}

      <div className={gridClass}>
        {field(
          'Días por semana',
          numberInput(values.workDaysPerWeek, (value) => onChange({ workDaysPerWeek: value }), {
            min: '1',
            max: '7',
            step: '1',
            required: true,
          }),
          <CalendarDays size={15} />
        )}
        {field(
          'Horas por jornada',
          numberInput(values.hoursPerShift, (value) => onChange({ hoursPerShift: value }), {
            min: '0.5',
            max: '24',
            step: '0.5',
            required: true,
          }),
          <Clock3 size={15} />
        )}
        {field(
          'Turno habitual',
          select(values.defaultShift, (value) => onChange({ defaultShift: value as WorkShift }), shiftOptions),
          <SunMoon size={15} />
        )}
      </div>

      {!isObra && (
        <div className={gridClass}>
          {field(
            'Periodicidad de pago',
            select(
              values.paymentPeriod,
              (value) => onChange({ paymentPeriod: value === 'quincenal' ? 'quincenal' : 'mensual' }),
              [
                { value: 'mensual', label: 'Mensual' },
                { value: 'quincenal', label: 'Quincenal (15 y fin de mes)' },
              ]
            ),
            <Banknote size={15} />
          )}
          {values.paymentPeriod === 'quincenal'
            ? field(
              'Días de cobro',
              <input type="text" value="15 y último día del mes" readOnly disabled className={inputClass} />,
              <CalendarDays size={15} />,
              'Cada pago es la mitad del salario.'
            )
            : field(
              'Día de cobro (1 - 31)',
              numberInput(values.paymentDayOfMonth, (value) => onChange({ paymentDayOfMonth: value }), {
                min: '1',
                max: '31',
                step: '1',
                required: true,
              }),
              <CalendarDays size={15} />
            )}
          {field(
            'Días laborables al mes',
            numberInput(values.workDaysPerMonthTarget, (value) => onChange({ workDaysPerMonthTarget: value }), {
              min: '1',
              max: '31',
              step: '1',
              required: true,
            }),
            <BriefcaseBusiness size={15} />,
            'Usualmente 20 o 22 días.'
          )}
        </div>
      )}

      {showBalance && (
        <div className={gridClass}>
          {field(
            'Balance actual en tu cuenta (COP)',
            numberInput(values.currentBalance, (value) => onChange({ currentBalance: value }), {
              min: '0',
              step: '0.01',
              required: true,
            }),
            <Wallet size={15} />
          )}
        </div>
      )}

      <div className="form-hint">
        <span>Ingreso estimado</span>
        <strong>{formatCOP(weeklyEstimate)} / semana</strong>
        <p>
          {formatCOP(dailyEstimate)} por jornada · {workDaysPerWeek} días por semana.
          {isObra ? ' El pago se calcula por jornada registrada.' : ' Se toma como referencia tu salario mensual.'}
        </p>
      </div>
    </>
  );
};
