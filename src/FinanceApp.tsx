import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import confetti from 'canvas-confetti';
import { CheckCircle2, CloudOff, Loader2 } from 'lucide-react';
import { CloudSyncStatus, CurrencyCode, DebtRecord, ExpenseRecord, SalaryProfile, StrategyMethod, WorkDayRecord, WorkDayType, WorkShift } from './types/finance';
import { AiAppActions, AiFinanceContext } from './types/ai';
import { storageService } from './services/storageService';
import { strategyEngine } from './services/strategyEngine';
import {
  FinanceConflictError,
  FinanceSnapshot,
  fetchStateVersion,
  loadFinanceState,
  saveFinanceState,
} from './services/financeRepository';
import { formatCOP } from './utils/money';
import { createId } from './utils/id';
import { daysUntil, getToday, parseLocalDate, startOfDay, toIsoDate } from './utils/date';
import { getWorkDayEarnings } from './utils/contract';
import { TopNav } from './components/TopNav';
import { BottomTabs, TabType } from './components/BottomTabs';
import { HeroBalanceCard } from './components/HeroBalanceCard';
import { ObraLaborDashboard } from './components/ObraLaborDashboard';
import { DebtUrgencyAlert } from './components/DebtUrgencyAlert';
import { WorkDaysWidget } from './components/WorkDaysWidget';
import { AntExpensesWidget } from './components/AntExpensesWidget';
import { StrategyAdvisorWidget } from './components/StrategyAdvisorWidget';
import { ExpenseListView } from './components/ExpenseListView';
import { DebtListView } from './components/DebtListView';
import { AddExpenseModal } from './components/modals/AddExpenseModal';
import { AddDebtModal } from './components/modals/AddDebtModal';
import { SalaryConfigModal } from './components/modals/SalaryConfigModal';
import { UserSettingsModal } from './components/modals/UserSettingsModal';
import { OnboardingScreen, type OnboardingData } from './components/onboarding/OnboardingScreen';
import { AiAssistantView } from './components/AiAssistantView';
import { AiChatDock } from './components/AiChatDock';
import { AgentInbox } from './components/AgentInbox';

const LEGACY_SEED_DEBT_IDS = new Set(['debt-1', 'debt-2', 'debt-3', 'debt-4']);
const LEGACY_SEED_EXPENSE_IDS = new Set([
  'exp-1', 'exp-2', 'exp-3', 'exp-4', 'exp-5', 'exp-6', 'exp-7', 'exp-8', 'exp-9',
]);

/** Huella del estado para saber si hay cambios sin guardar. */
const snapshotKey = (snapshot: FinanceSnapshot) => JSON.stringify([
  snapshot.salary,
  snapshot.debts,
  snapshot.expenses,
  snapshot.workDays,
  snapshot.strategyMode,
]);

function isLegacySeedState(snapshot: FinanceSnapshot): boolean {
  return snapshot.salary.monthlySalary === 2650000
    && snapshot.salary.currentBalance === 4850400
    && snapshot.salary.paymentDayOfMonth === 28
    && snapshot.salary.workDaysPerMonthTarget === 22
    && snapshot.salary.paymentPeriod === 'mensual'
    && snapshot.strategyMode === 'avalancha'
    && snapshot.debts.length === 4
    && snapshot.debts.every((debt) => LEGACY_SEED_DEBT_IDS.has(debt.id))
    && snapshot.expenses.length === 9
    && snapshot.expenses.every((expense) => LEGACY_SEED_EXPENSE_IDS.has(expense.id));
}

const PAGE_META: Record<TabType, { kicker: string; title: string; subtitle: string }> = {
  dashboard: {
    kicker: 'CENTRO DE CONTROL',
    title: 'Vista general',
    subtitle: 'Tu posición financiera, sin ruido.',
  },
  calendar: {
    kicker: 'JORNADA LABORAL',
    title: 'Calendario',
    subtitle: 'Marca tus días de trabajo y revisa el impacto de cada jornada.',
  },
  debts: {
    kicker: 'COMPROMISOS',
    title: 'Deudas y vencimientos',
    subtitle: 'Ordenadas por urgencia. Cada pago actualiza tu saldo al instante.',
  },
  expenses: {
    kicker: 'MOVIMIENTOS',
    title: 'Gastos y fugas',
    subtitle: 'Todo lo que sale de tu cuenta, con los gastos hormiga bajo control.',
  },
  strategies: {
    kicker: 'PLAN INTELIGENTE',
    title: 'Tu estrategia',
    subtitle: 'La siguiente acción con más impacto y cómo repartir tu nómina.',
  },
  assistant: {
    kicker: 'FINSMART AI',
    title: 'Asistente',
    subtitle: 'Pregunta por tu dinero en lenguaje normal. Conoce tus números.',
  },
};

interface FinanceAppProps {
  userId: string;
  userEmail: string;
  displayName: string;
  onSignOut: () => Promise<void>;
}

const FinanceApp: React.FC<FinanceAppProps> = ({ userId, userEmail, displayName, onSignOut }) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('finsmart_theme_mode') !== 'light';
  });

  useEffect(() => {
    document.body.classList.toggle('light-theme', !isDarkMode);
    localStorage.setItem('finsmart_theme_mode', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(prev => !prev);

  const [salary, setSalary] = useState<SalaryProfile>(() => storageService.getSalaryProfile());
  const [debts, setDebts] = useState<DebtRecord[]>(() => storageService.getDebts());
  const [expenses, setExpenses] = useState<ExpenseRecord[]>(() => storageService.getExpenses());
  const [workDays, setWorkDays] = useState<WorkDayRecord[]>(() => storageService.getWorkDays());
  const [strategyMode, setStrategyMode] = useState<StrategyMethod>(() => storageService.getStrategyMode());
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [today] = useState(() => startOfDay(getToday()));
  const [hydrated, setHydrated] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus>('loading');
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [hydrationAttempt, setHydrationAttempt] = useState(0);

  // Control de versión con la nube: el agente también escribe el balance y
  // las deudas, así que la app guarda indicando qué versión cargó.
  const versionRef = useRef<number | null>(null);
  const lastSyncedRef = useRef('');
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  const changeTab = (tab: TabType) => {
    setActiveTab(tab);
    window.scrollTo(0, 0);
  };

  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);
  const [isSalaryModalOpen, setIsSalaryModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [prefilledDateForExpense, setPrefilledDateForExpense] = useState<string | undefined>(undefined);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => { storageService.saveSalaryProfile(salary); }, [salary]);
  useEffect(() => { storageService.saveDebts(debts); }, [debts]);
  useEffect(() => { storageService.saveExpenses(expenses); }, [expenses]);
  useEffect(() => { storageService.saveWorkDays(workDays); }, [workDays]);
  useEffect(() => { storageService.saveStrategyMode(strategyMode); }, [strategyMode]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const cloudState = await loadFinanceState(userId);
        if (cancelled) return;

        versionRef.current = cloudState?.version ?? null;

        if (cloudState && cloudState.salary.monthlySalary > 0 && !isLegacySeedState(cloudState)) {
          lastSyncedRef.current = snapshotKey(cloudState);
          setSalary(cloudState.salary);
          setDebts(cloudState.debts);
          setExpenses(cloudState.expenses);
          setWorkDays(cloudState.workDays);
          setStrategyMode(cloudState.strategyMode);
          setOnboarding(false);
          setHydrated(true);
          setCloudStatus('synced');
          return;
        }

        storageService.clearUserData();
        setSalary(storageService.getSalaryProfile());
        setDebts([]);
        setExpenses([]);
        setWorkDays([]);
        setStrategyMode('avalancha');
        setOnboarding(true);
        setCloudStatus('synced');
      } catch (error) {
        if (cancelled) return;
        setCloudStatus('error');
        setCloudError(error instanceof Error ? error.message : 'No se pudieron cargar tus datos.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, hydrationAttempt]);

  const snapshot = useMemo<FinanceSnapshot>(
    () => ({ salary, debts, expenses, workDays, strategyMode }),
    [salary, debts, expenses, workDays, strategyMode]
  );

  const snapshotRef = useRef(snapshot);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);

  /** Vuelve a cargar los datos de la nube sin sacar al usuario de la pantalla. */
  const reloadFromCloud = useCallback(() => {
    setCloudStatus('loading');
    setHydrationAttempt((attempt) => attempt + 1);
  }, []);

  const persist = useCallback(() => {
    const current = snapshot;
    const key = snapshotKey(current);

    const run = async () => {
      // Nada nuevo que guardar (por ejemplo, justo después de cargar).
      if (key === lastSyncedRef.current) {
        setCloudStatus('synced');
        return;
      }

      setCloudStatus('saving');
      try {
        versionRef.current = await saveFinanceState(current, versionRef.current);
        lastSyncedRef.current = key;
        setCloudStatus('synced');
        setCloudError(null);
      } catch (error) {
        if (error instanceof FinanceConflictError) {
          showToast(error.message);
          reloadFromCloud();
          return;
        }
        setCloudStatus('error');
        setCloudError(error instanceof Error ? error.message : 'No se pudieron guardar tus datos.');
      }
    };

    // Un guardado a la vez: cada uno usa la versión que dejó el anterior.
    saveChainRef.current = saveChainRef.current.then(run, run);
    return saveChainRef.current;
  }, [snapshot, reloadFromCloud]);

  useEffect(() => {
    if (!hydrated) return;

    const timer = window.setTimeout(() => {
      void persist();
    }, 650);

    return () => window.clearTimeout(timer);
  }, [hydrated, persist]);

  // Al volver a la pestaña: si el agente cambió algo y no hay cambios locales
  // pendientes, se recargan los datos para mostrar el balance actualizado.
  useEffect(() => {
    if (!hydrated) return;

    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      if (snapshotKey(snapshotRef.current) !== lastSyncedRef.current) return;
      try {
        const remote = await fetchStateVersion(userId);
        if (remote !== null && versionRef.current !== null && remote !== versionRef.current) {
          showToast('Tu agente actualizó tus datos.');
          reloadFromCloud();
        }
      } catch {
        // Sin conexión: se revisará la próxima vez.
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [hydrated, userId, reloadFromCloud]);

  const retryHydration = () => {
    setCloudError(null);
    setCloudStatus('loading');
    setHydrationAttempt((attempt) => attempt + 1);
  };

  const strategyReport = useMemo(() => {
    return strategyEngine.calculateStrategy(salary, debts, expenses, strategyMode);
  }, [salary, debts, expenses, strategyMode]);

  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const workedDaysCount = useMemo(() => {
    return workDays.filter(wd => {
      const d = parseLocalDate(wd.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear && (wd.type === 'laboral' || wd.type === 'extra');
    }).length;
  }, [workDays, currentMonth, currentYear]);

  const totalExpensesMonth = useMemo(() => {
    return expenses
      .filter(e => {
        const d = parseLocalDate(e.date);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      })
      .reduce((sum, e) => sum + e.amount, 0);
  }, [expenses, currentMonth, currentYear]);

  const totalDebtAmount = useMemo(() => {
    return debts
      .filter(d => d.paymentStatus !== 'liquidada')
      .reduce((sum, d) => sum + d.totalAmount, 0);
  }, [debts]);

  const urgentDebtCount = useMemo(() => {
    return debts.filter(d => {
      if (d.paymentStatus === 'liquidada') return false;
      return daysUntil(d.dueDate, today) <= 5;
    }).length;
  }, [debts, today]);

  const antExpenseCount = useMemo(() => {
    return expenses.filter(e => e.isAntExpense).length;
  }, [expenses]);

  const handleToggleWorkDay = (dateStr: string, currentType?: WorkDayType) => {
    let nextType: WorkDayType = 'laboral';
    if (currentType === 'laboral' || currentType === 'medio_dia') nextType = 'descanso';
    else if (currentType === 'descanso') nextType = 'extra';
    else if (currentType === 'extra') nextType = 'descanso';

    const existingIndex = workDays.findIndex(w => w.date === dateStr);

    if (existingIndex >= 0) {
      const updated = [...workDays];
      const existingHours = updated[existingIndex].hoursWorked ?? 0;
      const nextHours = nextType === 'descanso'
        ? 0
        : existingHours > 0
          ? existingHours
          : salary.hoursPerShift;
      updated[existingIndex] = {
        ...updated[existingIndex],
        type: nextType,
        hoursWorked: nextHours,
        dailyEarnings: getWorkDayEarnings(salary, nextType, nextHours),
      };
      setWorkDays(updated);
    } else {
      setWorkDays([
        ...workDays,
        {
          date: dateStr,
          type: nextType,
          shift: salary.defaultShift,
          hoursWorked: nextType === 'descanso' ? 0 : salary.hoursPerShift,
          dailyEarnings: getWorkDayEarnings(salary, nextType, salary.hoursPerShift),
        }
      ]);
    }
    showToast(`Jornada actualizada · ${dateStr}`);
  };

  const handlePayInstallment = (debtId: string, amount?: number) => {
    const target = debts.find(d => d.id === debtId);
    if (!target) return;
    const requested = amount && amount > 0 ? amount : target.monthlyPayment;
    const paid = Math.min(requested, target.totalAmount);
    setDebts(prev => prev.map(d => {
      if (d.id === debtId) {
        const remaining = Math.max(0, d.totalAmount - paid);
        return {
          ...d,
          totalAmount: remaining,
          paymentStatus: remaining === 0 ? ('liquidada' as const) : ('pagado_mes' as const),
        };
      }
      return d;
    }));
    setSalary(prev => ({
      ...prev,
      currentBalance: Math.max(0, prev.currentBalance - paid),
    }));

    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#2d9468', '#e1ba39', '#7fa6cc']
    });

    showToast(`Pago registrado · ${target.title}`);
  };

  const handleLiquidateDebt = (debtId: string) => {
    const target = debts.find(d => d.id === debtId);
    if (!target) return;

    setDebts(prev => prev.map(d => {
      if (d.id === debtId) {
        return { ...d, totalAmount: 0, paymentStatus: 'liquidada' as const };
      }
      return d;
    }));
    setSalary(prev => ({
      ...prev,
      currentBalance: Math.max(0, prev.currentBalance - target.totalAmount),
    }));

    confetti({
      particleCount: 150,
      spread: 90,
      origin: { y: 0.5 },
      colors: ['#2d9468', '#e1ba39', '#c6481f']
    });

    showToast(`Deuda liquidada · ${target.title}`);
  };

  const handleDeleteDebt = (debtId: string) => {
    setDebts(prev => prev.filter(d => d.id !== debtId));
    showToast('Deuda eliminada.');
  };

  const handleAddExpense = (newExpense: Omit<ExpenseRecord, 'id'>) => {
    const item: ExpenseRecord = { ...newExpense, id: createId('exp') };
    setExpenses(prev => [item, ...prev]);
    setSalary(prev => ({ ...prev, currentBalance: Math.max(0, prev.currentBalance - item.amount) }));

    showToast(`Gasto registrado · -${formatCOP(item.amount)}`);
  };

  const handleUpdateExpense = (id: string, patch: Partial<Omit<ExpenseRecord, 'id'>>) => {
    const item = expenses.find(e => e.id === id);
    if (!item) return;
    const nextAmount = patch.amount ?? item.amount;
    setExpenses(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
    if (nextAmount !== item.amount) {
      setSalary(prev => ({
        ...prev,
        currentBalance: Math.max(0, prev.currentBalance + item.amount - nextAmount),
      }));
    }
    showToast(`Gasto actualizado · ${patch.title || item.title}`);
  };

  const handleDeleteExpense = (id: string) => {
    const item = expenses.find(e => e.id === id);
    if (item) {
      setSalary(prev => ({ ...prev, currentBalance: prev.currentBalance + item.amount }));
    }
    setExpenses(prev => prev.filter(e => e.id !== id));
    showToast('Gasto eliminado.');
  };

  const handleAddDebt = (newDebt: Omit<DebtRecord, 'id' | 'paymentStatus'>) => {
    const item: DebtRecord = { ...newDebt, id: createId('debt'), paymentStatus: 'pendiente' };
    setDebts(prev => [item, ...prev]);
    showToast(`Deuda añadida · ${item.title}`);
  };

  const handleUpdateDebt = (id: string, patch: Partial<Omit<DebtRecord, 'id'>>) => {
    const item = debts.find(d => d.id === id);
    if (!item) return;
    setDebts(prev => prev.map(d => (d.id === id ? { ...d, ...patch } : d)));
    showToast(`Deuda actualizada · ${patch.title || item.title}`);
  };

  const handleSaveSalary = (updated: Partial<SalaryProfile>) => {
    const nextSalary = { ...salary, ...updated };
    setSalary(nextSalary);
    setWorkDays(prev => prev.map(day => ({
      ...day,
      shift: day.shift ?? nextSalary.defaultShift,
      dailyEarnings: getWorkDayEarnings(
        nextSalary,
        day.type,
        day.hoursWorked ?? nextSalary.hoursPerShift
      ),
    })));
    showToast('Contrato y jornada actualizados.');
  };

  const handleOnboardingComplete = async (data: OnboardingData) => {
    const nextSalary: SalaryProfile = {
      ...salary,
      ...data,
      currency: 'COP',
    };
    const nextSnapshot: FinanceSnapshot = {
      salary: nextSalary,
      debts: [],
      expenses: [],
      workDays: [],
      strategyMode: 'avalancha',
    };

    versionRef.current = await saveFinanceState(nextSnapshot, null);
    lastSyncedRef.current = snapshotKey(nextSnapshot);
    setSalary(nextSalary);
    setDebts([]);
    setExpenses([]);
    setWorkDays([]);
    setStrategyMode('avalancha');
    setOnboarding(false);
    setHydrated(true);
    setCloudStatus('synced');
    setCloudError(null);
    showToast('Datos iniciales guardados. Bienvenido a FinSmart.');
  };

  const handleOpenAddExpenseForDate = (dateStr: string) => {
    setPrefilledDateForExpense(dateStr);
    setIsExpenseModalOpen(true);
  };

  const handleSetWorkDay = (
    dateStr: string,
    nextType: WorkDayType,
    details?: { hoursWorked?: number; notes?: string; dailyEarnings?: number; shift?: WorkShift }
  ) => {
    const requestedHours = details?.hoursWorked ?? salary.hoursPerShift;
    const hoursWorked = nextType === 'descanso' ? 0 : Math.max(0.5, requestedHours);
    const dailyEarnings = details?.dailyEarnings
      ?? getWorkDayEarnings(salary, nextType, hoursWorked);
    const record: WorkDayRecord = {
      date: dateStr,
      type: nextType,
      shift: details?.shift ?? salary.defaultShift,
      dailyEarnings,
      hoursWorked,
      notes: details?.notes,
    };
    setWorkDays(prev => {
      const existingIndex = prev.findIndex(w => w.date === dateStr);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = { ...updated[existingIndex], ...record };
        return updated;
      }
      return [...prev, record];
    });
    showToast(`Día ${dateStr} marcado como ${nextType}`);
  };

  const handleClearWorkDay = (dateStr: string) => {
    setWorkDays(prev => prev.filter(w => w.date !== dateStr));
    showToast(`Jornada eliminada · ${dateStr}`);
  };

  const todayString = toIsoDate(today);

  const aiContext: AiFinanceContext = {
    salary,
    debts,
    expenses,
    workDays,
    strategyMode,
    strategyReport,
    isDarkMode,
    today: todayString,
  };

  const aiActions: AiAppActions = {
    addExpense: handleAddExpense,
    addDebt: handleAddDebt,
    updateExpense: handleUpdateExpense,
    updateDebt: handleUpdateDebt,
    saveSalary: handleSaveSalary,
    setWorkDay: handleSetWorkDay,
    clearWorkDay: handleClearWorkDay,
    payInstallment: handlePayInstallment,
    liquidateDebt: handleLiquidateDebt,
    deleteExpense: handleDeleteExpense,
    deleteDebt: handleDeleteDebt,
    setStrategy: setStrategyMode,
    navigate: changeTab,
    setDarkMode: setIsDarkMode,
    setCurrency: (c: CurrencyCode) => setSalary(prev => ({ ...prev, currency: c })),
  };

  if (onboarding) {
    return <OnboardingScreen userEmail={userEmail} onComplete={handleOnboardingComplete} />;
  }

  if (!hydrated) {
    return (
      <div className="auth-loading">
        <div className="auth-brand">
          <span className="auth-brand-mark">F</span>
          <span>FINSMART <em>OS</em></span>
        </div>

        {cloudStatus === 'error' ? (
          <div className="cloud-boot">
            <CloudOff size={24} />
            <h2>No se pudieron cargar tus datos</h2>
            <p>{cloudError}</p>
            <div className="cloud-boot-actions">
              <button type="button" className="vt-btn" onClick={() => void onSignOut()}>
                Cerrar sesión
              </button>
              <button type="button" className="vt-btn vt-btn-lime" onClick={retryHydration}>
                Reintentar
              </button>
            </div>
          </div>
        ) : (
          <div className="auth-loading-copy">
            <Loader2 size={18} className="auth-spin" />
            <span>Cargando tus datos seguros...</span>
          </div>
        )}
      </div>
    );
  }

  const pageMeta = PAGE_META[activeTab];
  const dateLabel = new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(today);
  const kicker = activeTab === 'dashboard'
    ? `${pageMeta.kicker} / ${dateLabel.toUpperCase()}`
    : pageMeta.kicker;
  const pageSubtitle = activeTab === 'dashboard' && salary.contractType === 'obra_labor'
    ? 'Tu ciclo semanal, jornadas y pago por obra o labor.'
    : pageMeta.subtitle;

  return (
    <div className="app-shell">
      {toastMessage && (
        <div className="vt-toast" role="status">
          <CheckCircle2 size={15} />
          <span>{toastMessage}</span>
        </div>
      )}

      <TopNav
        activeTab={activeTab}
        onTabChange={changeTab}
        urgentDebtCount={urgentDebtCount}
        antExpenseCount={antExpenseCount}
        isDarkMode={isDarkMode}
        onToggleDarkMode={toggleDarkMode}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        userEmail={userEmail}
        displayName={displayName}
        syncStatus={cloudStatus}
        onSignOut={onSignOut}
      />

      <main className="vt-main">
        <header className="vt-pagehead">
          <div>
            <p className="vt-kicker">{kicker}</p>
            <h1>{pageMeta.title}</h1>
            <p className="vt-page-sub">{pageSubtitle}</p>
          </div>
          <div className="vt-page-status">
            <span className="vt-live"><i /> {cloudStatus === 'saving' ? 'Guardando cambios' : cloudStatus === 'error' ? 'Pendiente de sincronizar' : 'Todo sincronizado'}</span>
            <span>Cuenta privada · {userEmail}</span>
          </div>
        </header>

        {cloudStatus === 'error' && cloudError && (
          <div className="vt-sync-alert" role="alert">
            <CloudOff size={17} />
            <div>
              <strong>No se pudieron guardar los cambios</strong>
              <span>{cloudError}</span>
            </div>
            <button type="button" className="vt-btn vt-btn-sm" onClick={() => void persist()}>
              Reintentar
            </button>
          </div>
        )}

        <div className="vt-view" key={activeTab}>
          {activeTab === 'calendar' && (
            <WorkDaysWidget
              salary={salary}
              workDays={workDays}
              expenses={expenses}
              onToggleWorkDay={handleToggleWorkDay}
              onSetWorkDay={handleSetWorkDay}
              onOpenAddExpenseForDate={handleOpenAddExpenseForDate}
            />
          )}

          {activeTab === 'dashboard' && (
            <>
              {salary.contractType === 'obra_labor' ? (
                <ObraLaborDashboard
                  salary={salary}
                  report={strategyReport}
                  debts={debts}
                  expenses={expenses}
                  workDays={workDays}
                  onOpenExpenseModal={() => { setPrefilledDateForExpense(undefined); setIsExpenseModalOpen(true); }}
                  onGoToCalendar={() => changeTab('calendar')}
                  onGoToStrategy={() => changeTab('strategies')}
                  onGoToDebts={() => changeTab('debts')}
                />
              ) : (
                <HeroBalanceCard
                  salary={salary}
                  report={strategyReport}
                  debts={debts}
                  expenses={expenses}
                  workedDaysCount={workedDaysCount}
                  totalExpensesMonth={totalExpensesMonth}
                  totalDebtAmount={totalDebtAmount}
                  onOpenExpenseModal={() => { setPrefilledDateForExpense(undefined); setIsExpenseModalOpen(true); }}
                  onOpenDebtModal={() => setIsDebtModalOpen(true)}
                  onGoToStrategy={() => changeTab('strategies')}
                  onGoToDebts={() => changeTab('debts')}
                />
              )}
              <AgentInbox refreshKey={hydrationAttempt} />
              <DebtUrgencyAlert
                debts={debts}
                onPayDebt={handlePayInstallment}
                onGoToDebtsTab={() => changeTab('debts')}
              />
            </>
          )}

          {activeTab === 'debts' && (
            <div className="vt-view-stack">
              <DebtUrgencyAlert
                debts={debts}
                onPayDebt={handlePayInstallment}
                onGoToDebtsTab={() => {}}
              />
              <DebtListView
                debts={debts}
                salary={salary}
                onOpenAddModal={() => setIsDebtModalOpen(true)}
                onPayInstallment={handlePayInstallment}
                onLiquidateDebt={handleLiquidateDebt}
                onDeleteDebt={handleDeleteDebt}
              />
            </div>
          )}

          {activeTab === 'expenses' && (
            <div className="vt-view-stack">
              <AntExpensesWidget
                salary={salary}
                antSummary={strategyReport.antExpenseSummary}
                onOpenExpenseModal={() => { setPrefilledDateForExpense(undefined); setIsExpenseModalOpen(true); }}
              />
              <ExpenseListView
                expenses={expenses}
                onOpenAddModal={() => { setPrefilledDateForExpense(undefined); setIsExpenseModalOpen(true); }}
                onDeleteExpense={handleDeleteExpense}
              />
            </div>
          )}

          {activeTab === 'strategies' && (
            <StrategyAdvisorWidget
              report={strategyReport}
              salary={salary}
              onMethodChange={(m: StrategyMethod) => setStrategyMode(m)}
              onOpenDebtPayment={handlePayInstallment}
            />
          )}

          {activeTab === 'assistant' && (
            <AiAssistantView context={aiContext} actions={aiActions} />
          )}
        </div>

        <footer className="vt-foot">
          <span>FinSmart OS · {userEmail}</span>
          <span>Datos privados sincronizados con Supabase</span>
        </footer>
      </main>

      <BottomTabs
        activeTab={activeTab}
        onTabChange={changeTab}
        urgentDebtCount={urgentDebtCount}
        antExpenseCount={antExpenseCount}
      />

      <AddExpenseModal
        isOpen={isExpenseModalOpen}
        currency={salary.currency}
        initialDate={prefilledDateForExpense}
        onClose={() => { setIsExpenseModalOpen(false); setPrefilledDateForExpense(undefined); }}
        onAdd={handleAddExpense}
      />

      <AddDebtModal
        isOpen={isDebtModalOpen}
        currency={salary.currency}
        onClose={() => setIsDebtModalOpen(false)}
        onAdd={handleAddDebt}
      />

      <SalaryConfigModal
        isOpen={isSalaryModalOpen}
        salary={salary}
        onClose={() => setIsSalaryModalOpen(false)}
        onSave={handleSaveSalary}
      />

      <UserSettingsModal
        isOpen={isSettingsModalOpen}
        userEmail={userEmail}
        displayName={displayName}
        onClose={() => setIsSettingsModalOpen(false)}
        onOpenSalary={() => {
          setIsSettingsModalOpen(false);
          setIsSalaryModalOpen(true);
        }}
      />

      <AiChatDock
        context={aiContext}
        actions={aiActions}
        hidden={activeTab === 'assistant'}
      />
    </div>
  );
};

export default FinanceApp;
