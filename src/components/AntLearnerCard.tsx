import React, { useMemo } from 'react';
import { BrainCircuit, CheckCheck, GraduationCap, TrendingUp } from 'lucide-react';
import type { ExpenseRecord, SalaryProfile } from '../types/finance';
import {
  type AntModel,
  type FeedbackRecord,
  forecastAntMonth,
  learningStats,
  topAntWords,
} from '../utils/antLearner';
import { getMonthlyIncome } from '../utils/contract';
import { formatCOP } from '../utils/money';
import { todayIso } from '../utils/date';

interface Props {
  model: AntModel;
  feedback: FeedbackRecord[];
  expenses: ExpenseRecord[];
  salary: SalaryProfile;
}

const HEALTHY = 5;
const HIGH = 10;
const pctLabel = (value: number) => `${value.toFixed(1).replace('.', ',')} %`;

export const AntLearnerCard: React.FC<Props> = ({ model, feedback, expenses, salary }) => {
  const stats = useMemo(() => learningStats(feedback), [feedback]);
  const words = useMemo(() => topAntWords(model), [model]);
  const forecast = useMemo(
    () => forecastAntMonth(expenses, todayIso(), getMonthlyIncome(salary)),
    [expenses, salary]
  );

  const tone = forecast.projectedPct >= HIGH ? 'danger' : forecast.projectedPct >= HEALTHY ? 'warn' : 'ok';
  // La barra va de 0 % a 15 % del ingreso; las marcas son 5 % y 10 %.
  const scale = 15;
  const fill = `${Math.min(100, (forecast.projectedPct / scale) * 100)}%`;

  return (
    <section className="vt-card vt-learn" aria-label="Detector de gastos hormiga que aprende">
      <div className="vt-card-head">
        <div>
          <p className="vt-kicker">Agente · capa 5 · aprendizaje</p>
          <h2 className="vt-card-title"><BrainCircuit size={15} /> Detector que aprende</h2>
          <p className="vt-card-sub">
            Sugiere la categoría y si un gasto es hormiga mientras escribes, y aprende de cada corrección tuya.
          </p>
        </div>
      </div>

      <div className="vt-metric-grid vt-dfp-metrics">
        <div className="vt-metric">
          <span><CheckCheck size={12} /> Aciertos recientes</span>
          <strong>{stats.recentHitRate === null ? 'Sin datos' : `${Math.round(stats.recentHitRate * 100)} %`}</strong>
          <small>
            {stats.total === 0
              ? 'Registra gastos para medir sus aciertos'
              : `${stats.hits} de ${stats.total} sugerencias aceptadas sin cambios`}
          </small>
        </div>
        <div className="vt-metric">
          <span><TrendingUp size={12} /> Hormiga este mes</span>
          <strong>{formatCOP(forecast.projected)}</strong>
          <small>Pronóstico: {pctLabel(forecast.projectedPct)} de tu ingreso · llevas {formatCOP(forecast.spentSoFar)}</small>
        </div>
        <div className="vt-metric">
          <span><GraduationCap size={12} /> Aprendió de</span>
          <strong>{model.examples.user + model.examples.corrections}</strong>
          <small>
            {model.examples.user} {model.examples.user === 1 ? 'gasto tuyo' : 'gastos tuyos'} y {model.examples.corrections}
            {' '}{model.examples.corrections === 1 ? 'corrección' : 'correcciones'}
          </small>
        </div>
      </div>

      <div className="vt-learn-forecast">
        <div className={`vt-learn-bar ${tone}`} role="img"
          aria-label={`Pronóstico de gastos hormiga: ${pctLabel(forecast.projectedPct)} del ingreso; sano hasta ${HEALTHY} %, alto desde ${HIGH} %`}>
          <i style={{ width: fill }} />
          <span className="mark" style={{ left: `${(HEALTHY / scale) * 100}%` }}><em>{HEALTHY} %</em></span>
          <span className="mark" style={{ left: `${(HIGH / scale) * 100}%` }}><em>{HIGH} %</em></span>
        </div>
        <p>
          {forecast.dayOfMonth < 7
            ? `Es el día ${forecast.dayOfMonth} del mes: el agente empieza a avisar desde el día 7, cuando el ritmo ya es confiable.`
            : tone === 'ok'
              ? 'Vas bien: por debajo del 5 % de tu ingreso.'
              : `A este ritmo superas el ${tone === 'danger' ? HIGH : HEALTHY} % de tu ingreso. El agente te avisará si sigue subiendo.`}
        </p>
      </div>

      <div className="vt-learn-words">
        <h3>Palabras que ya asocia contigo a gastos hormiga</h3>
        {words.length > 0 ? (
          <ul>{words.map((word) => <li key={word} className="vt-badge warn">{word}</li>)}</ul>
        ) : (
          <p>Aún no hay suficientes gastos hormiga tuyos. Mientras tanto usa su conocimiento inicial (tinto, Rappi, Netflix, taxi...).</p>
        )}
      </div>

      <p className="vt-dfp-note">
        Usa un clasificador bayesiano ingenuo (Naive Bayes) con las palabras del concepto y el rango del monto.
        Parte de un conocimiento inicial; tus gastos pesan el doble y tus correcciones el triple, así que con el uso
        se adapta a cómo clasificas tu dinero. Cada noche el agente se reentrena, pronostica el mes y señala gastos
        que parecen hormiga pero no marcaste.
      </p>
    </section>
  );
};
