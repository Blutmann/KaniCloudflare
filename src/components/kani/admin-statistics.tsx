import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart2,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Clock3,
  CreditCard,
  DollarSign,
  Flame,
  Moon,
  PieChart as PieChartIcon,
  Receipt,
  RotateCcw,
  Scissors,
  ShieldAlert,
  Sun,
  Sunset,
  TrendingUp,
  User,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { useAdminStaff } from '@/lib/kani-admin-context';
import {
  appointmentErrorMessage,
  readRealAppointments,
  type RealAppointment,
} from '@/lib/kani-appointments';
import { money } from '@/lib/kani-model';
import {
  businessDateToday,
  BUSINESS_TIME_ZONE,
} from '@/lib/kani-mobile-appointments';
import { permittedBarberNames } from '@/lib/kani-role-scope';
import {
  aggregateClientsDirectory,
  computeDailyDemand,
  computeFinancialControl,
  computeHourlyDistribution,
  computeKpiSummary,
  computeServiceDemand,
  dateRangeForStatisticsPreset,
  filterStatisticsAppointments,
  statisticsPresets,
  getStatisticsPresetLabels,
  type StatisticsDatePreset,
  type TimeSlotFilter,
} from '@/lib/kani-statistics';
import {
  fetchServicePayments,
  filterServicePayments,
  computeServicePaymentsOperationalStats,
  computeServicePaymentsFinancialStats,
  type ServicePayment,
} from '@/lib/kani-payments';

const AdminClients = lazy(() => import('./admin-clients').then((m) => ({ default: m.AdminClients })));

const presets: StatisticsDatePreset[] = statisticsPresets;

export function AdminStatistics() {
  const staff = useAdminStaff();
  const { profile, barbers: permittedRows, refreshCount, setIsRefreshing } = staff;
  const permittedBarbers = useMemo(
    () => permittedBarberNames(profile, permittedRows),
    [profile, permittedRows],
  );

  const [mounted, setMounted] = useState(false);
  const [appointments, setAppointments] = useState<RealAppointment[]>([]);
  const [payments, setPayments] = useState<ServicePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filtros principales compartidos
  const [businessToday, setBusinessToday] = useState(() => businessDateToday());
  const [datePreset, setDatePreset] = useState<StatisticsDatePreset>('TODAY');
  const [specificDate, setSpecificDate] = useState(() => businessDateToday());
  const [timeSlotFilter, setTimeSlotFilter] = useState<TimeSlotFilter>('ALL');
  const [barberFilter, setBarberFilter] = useState('Todos');
  const [serviceFilter, setServiceFilter] = useState('Todos');

  const presetLabels = useMemo(
    () => getStatisticsPresetLabels(businessToday),
    [businessToday],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  async function loadData() {
    setLoading(true);
    setIsRefreshing(true);
    setError('');
    try {
      const [aptsData, paymentsData] = await Promise.all([
        readRealAppointments().catch((e) => {
          console.warn('[AdminStatistics] No se pudieron cargar turnos:', e);
          return [] as RealAppointment[];
        }),
        fetchServicePayments({}, staff).catch((e) => {
          console.warn('[AdminStatistics] No se pudieron cargar pagos:', e);
          return [] as ServicePayment[];
        }),
      ]);
      setAppointments(aptsData);
      setPayments(paymentsData);
    } catch (err) {
      setError(appointmentErrorMessage(err));
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (refreshCount > 0) void loadData();
  }, [refreshCount]);

  useEffect(() => {
    if (profile.role === 'BARBER' && permittedBarbers[0]) {
      setBarberFilter(permittedBarbers[0]);
    }
  }, [profile.role, permittedBarbers]);

  // Mantener fecha de negocio sincronizada
  useEffect(() => {
    const interval = window.setInterval(() => {
      const next = businessDateToday();
      setBusinessToday((curr) => (curr === next ? curr : next));
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // Rango de fechas activo
  const activeDateRange = useMemo(() => {
    return dateRangeForStatisticsPreset(datePreset, businessToday, specificDate);
  }, [datePreset, businessToday, specificDate]);

  const permittedBarberIds = useMemo(
    () => new Set(permittedRows.map((r) => r.id)),
    [permittedRows],
  );

  // 1. Turnos filtrados
  const filteredAppointments = useMemo(() => {
    return filterStatisticsAppointments(appointments, {
      dateRange: activeDateRange,
      timeSlotFilter,
      barberFilter,
      serviceFilter,
      role: profile.role,
      profileBarberId: profile.barber_id,
      permittedBarberIds,
    });
  }, [
    appointments,
    activeDateRange,
    timeSlotFilter,
    barberFilter,
    serviceFilter,
    profile.role,
    profile.barber_id,
    permittedBarberIds,
  ]);

  // 2. Cobros de servicios filtrados
  const filteredPayments = useMemo(() => {
    return filterServicePayments(payments, {
      dateRange: activeDateRange,
      timeSlotFilter,
      barberFilter,
      serviceFilter,
      role: profile.role,
      profileBarberId: profile.barber_id,
      permittedBarberIds,
    });
  }, [
    payments,
    activeDateRange,
    timeSlotFilter,
    barberFilter,
    serviceFilter,
    profile.role,
    profile.barber_id,
    permittedBarberIds,
  ]);

  // Clientes para directorio (histórico general respetando alcance de barberos)
  const clientsData = useMemo(() => {
    const scopedAppointments = appointments.filter((apt) => {
      if (!permittedBarberIds.has(apt.barberId)) return false;
      if (profile.role === 'BARBER') return apt.barberId === profile.barber_id;
      return true;
    });
    return aggregateClientsDirectory(scopedAppointments);
  }, [appointments, permittedBarberIds, profile.role, profile.barber_id]);

  const [showFinancialDetails, setShowFinancialDetails] = useState(false);

  // Métricas analíticas de cada bloque
  const kpis = useMemo(() => computeKpiSummary(filteredAppointments), [filteredAppointments]);
  const dailyDemand = useMemo(() => computeDailyDemand(filteredAppointments), [filteredAppointments]);
  const hourlyDemand = useMemo(() => computeHourlyDistribution(filteredAppointments), [filteredAppointments]);
  const financialControl = useMemo(() => computeFinancialControl(filteredAppointments), [filteredAppointments]);

  const operationalStats = useMemo(() => computeServicePaymentsOperationalStats(filteredPayments), [filteredPayments]);
  const financialStats = useMemo(() => computeServicePaymentsFinancialStats(filteredPayments), [filteredPayments]);

  return (
    <main className="site-container admin-stats-page pb-12">
      {/* Error state */}
      {error && (
        <div
          role="alert"
          className="mb-4 p-4 rounded-xl border border-destructive/40 bg-destructive/10 text-destructive text-sm flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadData()}>
            Reintentar
          </Button>
        </div>
      )}

      {/* 1. Panel de Filtros Compartidos */}
      <section
        className="p-3.5 sm:p-4 rounded-xl border border-border bg-surface shadow-xs mb-6 space-y-3"
        aria-label="Filtros principales de datos"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {/* Filtro 1: Período */}
          <div>
            <label htmlFor="stat-period-filter" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Período
            </label>
            <div className={datePreset === 'SPECIFIC' ? 'grid grid-cols-2 gap-2' : ''}>
              <select
                id="stat-period-filter"
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value as StatisticsDatePreset)}
                className="select-control w-full h-9 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
              >
                {presets.map((preset) => (
                  <option key={preset} value={preset}>
                    {presetLabels[preset]}
                  </option>
                ))}
              </select>
              {datePreset === 'SPECIFIC' && (
                <input
                  id="stat-specific-date"
                  type="date"
                  value={specificDate}
                  onChange={(e) => setSpecificDate(e.target.value)}
                  className="w-full h-9 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                  aria-label="Elegir fecha específica"
                />
              )}
            </div>
          </div>

          {/* Filtro 2: Franja horaria */}
          <div>
            <label htmlFor="stat-slot-filter" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Franja horaria
            </label>
            <select
              id="stat-slot-filter"
              value={timeSlotFilter}
              onChange={(e) => setTimeSlotFilter(e.target.value as TimeSlotFilter)}
              className="select-control w-full h-9 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
            >
              <option value="ALL">Todas las franjas</option>
              <option value="MORNING">Mañana (10:00 a 12:00)</option>
              <option value="AFTERNOON">Tarde (12:00 a 18:00)</option>
              <option value="NIGHT">Noche (18:00 a 20:00)</option>
            </select>
          </div>

          {/* Filtro 3: Barbero */}
          <div>
            <label htmlFor="stat-barber-filter" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Barbero
            </label>
            {profile.role === 'ADMIN' ? (
              <select
                id="stat-barber-filter"
                value={barberFilter}
                onChange={(e) => setBarberFilter(e.target.value)}
                className="select-control w-full h-9 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
              >
                <option value="Todos">Todos los barberos</option>
                {permittedBarbers.map((barber) => (
                  <option key={barber} value={barber}>
                    {barber}
                  </option>
                ))}
              </select>
            ) : (
              <select
                id="stat-barber-filter"
                value={profile.barber_id ? (permittedBarbers[0] || 'Mi agenda') : 'Mi agenda'}
                disabled
                className="select-control w-full h-9 px-3 text-xs bg-muted/40 border border-border rounded-lg text-muted-foreground cursor-not-allowed"
              >
                <option value={profile.barber_id ? (permittedBarbers[0] || 'Mi agenda') : 'Mi agenda'}>
                  {profile.barber_id ? (permittedBarbers[0] || 'Mi agenda') : 'Mi agenda'}
                </option>
              </select>
            )}
          </div>

          {/* Filtro 4: Servicio */}
          <div>
            <label htmlFor="stat-service-filter" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Servicio
            </label>
            <select
              id="stat-service-filter"
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="select-control w-full h-9 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 font-medium"
            >
              <option value="Todos">Todos los servicios</option>
              <option value="Corte">Corte</option>
              <option value="Corte y barba">Corte y barba</option>
              <option value="Barba">Barba</option>
              <option value="Otros">Otros</option>
            </select>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* BLOQUE 1: TURNOS (Agenda) */}
      {/* ========================================================================= */}
      <section className="mb-8" aria-label="Bloque de turnos y agenda">
        <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-border/60">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-foreground flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-primary" />
              <span>Turnos</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Agenda y reservas solicitadas a través del sistema web o manuales.
            </p>
          </div>
          <span className="text-xs font-medium text-muted-foreground bg-muted/40 px-2 py-0.5 rounded border border-border">
            Agenda
          </span>
        </div>

        {/* KPIs de Turnos */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
          {/* Total */}
          <div className="p-3.5 rounded-xl border border-border bg-surface flex flex-col justify-between shadow-xs">
            <span className="text-xs text-muted-foreground">Total de turnos</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-foreground">
                {loading ? '…' : kpis.total}
              </span>
              <Calendar size={16} className="text-muted-foreground opacity-60" />
            </div>
          </div>

          {/* Confirmados */}
          <div className="p-3.5 rounded-xl border border-success/30 bg-success/5 flex flex-col justify-between shadow-xs">
            <span className="text-xs text-success font-medium">Confirmados</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-success">
                {loading ? '…' : kpis.confirmed}
              </span>
              <CheckCircle2 size={16} className="text-success" />
            </div>
          </div>

          {/* Pendientes */}
          <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5 flex flex-col justify-between shadow-xs">
            <span className="text-xs text-amber-500 font-medium">Pendientes</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-amber-500">
                {loading ? '…' : kpis.pending}
              </span>
              <Clock size={16} className="text-amber-500" />
            </div>
          </div>

          {/* Cancelados */}
          <div className="p-3.5 rounded-xl border border-destructive/30 bg-destructive/5 flex flex-col justify-between shadow-xs">
            <span className="text-xs text-destructive font-medium">Cancelados</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-destructive">
                {loading ? '…' : kpis.cancelled}
              </span>
              <XCircle size={16} className="text-destructive" />
            </div>
          </div>

          {/* Inasistencias (no-show) */}
          <div className="p-3.5 rounded-xl border border-purple-500/30 bg-purple-500/5 flex flex-col justify-between shadow-xs col-span-2 sm:col-span-1">
            <span className="text-xs text-purple-400 font-medium">Inasistencias</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-purple-400">
                {loading ? '…' : kpis.noShow}
              </span>
              <ShieldAlert size={16} className="text-purple-400" />
            </div>
          </div>
        </div>

        {/* Gráficos de Demanda de Turnos */}
        {filteredAppointments.length === 0 ? (
          <div className="p-5 text-center border border-dashed border-border rounded-xl bg-surface/40 text-xs text-muted-foreground">
            No se registraron turnos en la agenda para el período y filtros seleccionados.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            {/* Demanda por Fecha (7 cols) */}
            <div className="lg:col-span-7 p-3.5 sm:p-4 rounded-xl border border-border bg-surface shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <TrendingUp size={14} className="text-primary" />
                    <span>Demanda por fecha</span>
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Evolución temporal de reservas registradas en el período.
                  </p>
                </div>
                {dailyDemand.peakDate && (
                  <div className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium">
                    <Flame size={11} className="text-amber-500" />
                    <span>Pico: {dailyDemand.peakDate} ({dailyDemand.peakCount} turnos)</span>
                  </div>
                )}
              </div>
              <div className="w-full h-52 pt-1">
                {mounted && dailyDemand.points.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyDemand.points} margin={{ top: 8, right: 8, left: -22, bottom: 15 }}>
                      <XAxis
                        dataKey="label"
                        tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
                        interval="preserveStartEnd"
                        stroke="var(--border)"
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
                        stroke="var(--border)"
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="p-2.5 rounded-lg border border-border bg-surface text-xs shadow-md space-y-1">
                                <p className="font-semibold text-foreground">{data.date}</p>
                                <p className="text-primary font-medium">Total: {data.count} turnos</p>
                                <p className="text-success text-[11px]">Confirmados: {data.confirmed}</p>
                                <p className="text-destructive text-[11px]">Cancelados: {data.cancelled}</p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={32}>
                        {dailyDemand.points.map((entry, index) => (
                          <Cell
                            key={`daily-cell-${index}`}
                            fill={entry.isPeak ? '#EAB308' : '#B99A5B'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                    Sin datos temporales suficientes.
                  </div>
                )}
              </div>
            </div>

            {/* Demanda por Horario (5 cols) */}
            <div className="lg:col-span-5 p-3.5 sm:p-4 rounded-xl border border-border bg-surface shadow-xs space-y-3">
              <div>
                <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Clock3 size={14} className="text-primary" />
                  <span>Demanda por franja</span>
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Distribución según mañana, tarde y noche.
                </p>
              </div>

              {/* 3 Franjas */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 rounded-lg bg-background border border-border flex flex-col justify-between">
                  <div className="flex items-center gap-1 text-muted-foreground mb-1">
                    <Sun size={12} className="text-amber-500 shrink-0" />
                    <span className="truncate text-[11px]">Mañana</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <strong className="text-sm text-foreground font-semibold">{hourlyDemand.morningCount}</strong>
                    <span className="text-[10px] text-muted-foreground">{hourlyDemand.morningPercentage}%</span>
                  </div>
                  <span className="text-[9px] text-muted-foreground/70 mt-0.5">10:00 - 12:00</span>
                </div>

                <div className="p-2 rounded-lg bg-background border border-border flex flex-col justify-between">
                  <div className="flex items-center gap-1 text-muted-foreground mb-1">
                    <Sunset size={12} className="text-indigo-400 shrink-0" />
                    <span className="truncate text-[11px]">Tarde</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <strong className="text-sm text-foreground font-semibold">{hourlyDemand.afternoonCount}</strong>
                    <span className="text-[10px] text-muted-foreground">{hourlyDemand.afternoonPercentage}%</span>
                  </div>
                  <span className="text-[9px] text-muted-foreground/70 mt-0.5">12:00 - 18:00</span>
                </div>

                <div className="p-2 rounded-lg bg-background border border-border flex flex-col justify-between">
                  <div className="flex items-center gap-1 text-muted-foreground mb-1">
                    <Moon size={12} className="text-blue-400 shrink-0" />
                    <span className="truncate text-[11px]">Noche</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <strong className="text-sm text-foreground font-semibold">{hourlyDemand.nightCount}</strong>
                    <span className="text-[10px] text-muted-foreground">{hourlyDemand.nightPercentage}%</span>
                  </div>
                  <span className="text-[9px] text-muted-foreground/70 mt-0.5">18:00 - 20:00</span>
                </div>
              </div>

              {/* Hora pico */}
              {hourlyDemand.peakHour && (
                <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-amber-500 font-medium text-[11px]">
                    <Flame size={12} /> Hora pico:
                  </span>
                  <span className="font-bold text-amber-500 text-[11px]">
                    {hourlyDemand.peakHour} ({hourlyDemand.peakHourCount} turnos)
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ========================================================================= */}
      {/* BLOQUE 2: SERVICIOS REALIZADOS (Operación) */}
      {/* ========================================================================= */}
      <section className="mb-8" aria-label="Bloque de servicios realizados">
        <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-border/60">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-foreground flex items-center gap-1.5">
              <Scissors className="w-4 h-4 text-primary" />
              <span>Servicios realizados</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Atenciones efectivamente ejecutadas en el local (registradas en Pagos).
            </p>
          </div>
          <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
            Operación
          </span>
        </div>

        {operationalStats.totalServices === 0 ? (
          <div className="p-6 text-center border border-dashed border-border rounded-xl bg-surface/40 text-xs text-muted-foreground">
            No se registraron servicios realizados en este período con los filtros seleccionados.
          </div>
        ) : (
          <div className="space-y-4">
            {/* KPIs de Servicios Realizados */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Total realizados */}
              <div className="p-3.5 rounded-xl border border-border bg-surface flex flex-col justify-between shadow-xs">
                <span className="text-xs text-muted-foreground">Total servicios</span>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-bold text-foreground">
                    {operationalStats.totalServices}
                  </span>
                  <Scissors size={16} className="text-primary opacity-80" />
                </div>
                <span className="text-[11px] text-muted-foreground block mt-1">Efectivamente atendidos</span>
              </div>

              {/* Con turno */}
              <div className="p-3.5 rounded-xl border border-primary/30 bg-primary/5 flex flex-col justify-between shadow-xs">
                <span className="text-xs text-primary font-medium">Con turno</span>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-bold text-primary">
                    {operationalStats.withAppointment}
                  </span>
                  <CalendarDays size={16} className="text-primary" />
                </div>
                <span className="text-[11px] text-primary/80 block mt-1">
                  {operationalStats.withAppointmentPercentage}% del total
                </span>
              </div>

              {/* Sin turno / Walk-in */}
              <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5 flex flex-col justify-between shadow-xs">
                <span className="text-xs text-amber-500 font-medium">Sin turno (walk-in)</span>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-bold text-amber-500">
                    {operationalStats.walkIn}
                  </span>
                  <User size={16} className="text-amber-500" />
                </div>
                <span className="text-[11px] text-amber-500/80 block mt-1">
                  {operationalStats.walkInPercentage}% del total
                </span>
              </div>

              {/* Relación proporcional */}
              <div className="p-3.5 rounded-xl border border-border bg-surface flex flex-col justify-between shadow-xs">
                <span className="text-xs text-muted-foreground">Proporción de origen</span>
                <div className="mt-2 text-xs font-semibold text-foreground">
                  {operationalStats.withAppointmentPercentage}% con turno
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {operationalStats.walkInPercentage}% sin turno
                </div>
                <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden flex mt-2">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${operationalStats.withAppointmentPercentage}%` }}
                    title={`Con turno: ${operationalStats.withAppointmentPercentage}%`}
                  />
                  <div
                    className="h-full bg-amber-500 transition-all"
                    style={{ width: `${operationalStats.walkInPercentage}%` }}
                    title={`Sin turno: ${operationalStats.walkInPercentage}%`}
                  />
                </div>
              </div>
            </div>

            {/* Visualización Con turno vs Sin turno y desglose por Barbero / Servicio */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Servicios por Barbero */}
              <div className="p-4 rounded-xl border border-border bg-surface shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Users size={14} className="text-primary" />
                    <span>Servicios realizados por barbero</span>
                  </h3>
                  <span className="text-[11px] text-muted-foreground">{operationalStats.byBarber.length} barberos</span>
                </div>
                <div className="space-y-2.5 pt-1">
                  {operationalStats.byBarber.map((b) => (
                    <div key={b.barberId} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{b.barberName}</span>
                        <span className="font-semibold text-foreground">
                          {b.count} {b.count === 1 ? 'servicio' : 'servicios'}{' '}
                          <span className="text-muted-foreground font-normal">
                            ({Math.round(b.percentage)}%)
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{b.withAppointmentCount} con turno</span>
                        <span>{b.walkInCount} sin turno</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.max(4, b.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Servicios por Tipo */}
              <div className="p-4 rounded-xl border border-border bg-surface shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Scissors size={14} className="text-primary" />
                    <span>Servicios realizados por tipo</span>
                  </h3>
                  <span className="text-[11px] text-muted-foreground">{operationalStats.byService.length} tipos</span>
                </div>
                <div className="space-y-2.5 pt-1">
                  {operationalStats.byService.map((s) => (
                    <div key={s.serviceName} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{s.serviceName}</span>
                        <span className="font-semibold text-foreground">
                          {s.count} {s.count === 1 ? 'atención' : 'atenciones'}{' '}
                          <span className="text-muted-foreground font-normal">
                            ({Math.round(s.percentage)}%)
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{s.withAppointmentCount} con turno</span>
                        <span>{s.walkInCount} sin turno</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${Math.max(4, s.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ========================================================================= */}
      {/* BLOQUE 3: COBRANZA (Finanzas) */}
      {/* ========================================================================= */}
      <section className="mb-8" aria-label="Bloque de cobranza y finanzas">
        <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-border/60">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-foreground flex items-center gap-1.5">
              <Wallet className="w-4 h-4 text-gold text-primary" />
              <span>Cobranza</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ingresos reales cobrados, ticket promedio y métodos de pago sin duplicación de señas.
            </p>
          </div>
          <span className="text-xs font-medium text-gold bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/20">
            Finanzas
          </span>
        </div>

        {financialStats.servicesCount === 0 ? (
          <div className="p-6 text-center border border-dashed border-border rounded-xl bg-surface/40 text-xs text-muted-foreground">
            No se registraron cobros ni ingresos en este período con los filtros seleccionados.
          </div>
        ) : (
          <div className="space-y-4">
            {/* KPIs Financieros */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Total cobrado */}
              <div className="p-3.5 rounded-xl border border-primary/30 bg-primary/5 flex flex-col justify-between shadow-xs">
                <span className="text-xs text-primary font-medium">Total cobrado</span>
                <div className="mt-2">
                  <span className="text-xl sm:text-2xl font-bold text-foreground">
                    {money(financialStats.totalCollected)}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  {financialStats.servicesCount} {financialStats.servicesCount === 1 ? 'servicio' : 'servicios'}
                </span>
              </div>

              {/* Ticket promedio */}
              <div className="p-3.5 rounded-xl border border-border bg-surface flex flex-col justify-between shadow-xs">
                <span className="text-xs text-muted-foreground">Ticket promedio</span>
                <div className="mt-2">
                  <span className="text-xl sm:text-2xl font-bold text-foreground">
                    {money(financialStats.averageTicket)}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground mt-1 block">Por servicio realizado</span>
              </div>

              {/* Descuentos aplicados */}
              <div className="p-3.5 rounded-xl border border-border bg-surface flex flex-col justify-between shadow-xs">
                <span className="text-xs text-muted-foreground">Descuentos</span>
                <div className="mt-2">
                  <span className="text-xl sm:text-2xl font-bold text-foreground">
                    {money(financialStats.totalDiscount)}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground mt-1 block">Bonificaciones comerciales</span>
              </div>

              {/* Desglose de Fondos (Señas vs Local) */}
              <div className="p-3.5 rounded-xl border border-border bg-surface flex flex-col justify-between shadow-xs">
                <span className="text-xs text-muted-foreground">Desglose de origen</span>
                <div className="mt-1 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[11px] text-muted-foreground">Señas online:</span>
                    <strong className="text-emerald-500 font-semibold">{money(financialStats.depositsPrepaid)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[11px] text-muted-foreground">Cobrado en local:</span>
                    <strong className="text-foreground font-semibold">{money(financialStats.collectedAtShop)}</strong>
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground/75 mt-1 block pt-1 border-t border-border/50">
                  Total conciliado: {money(financialStats.totalCollected)}
                </span>
              </div>
            </div>

            {/* Grid de Desglose: Método de Pago, Barbero y Servicio */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Cobranza por Método de Pago */}
              <div className="p-4 rounded-xl border border-border bg-surface shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <CreditCard size={14} className="text-primary" />
                    <span>Por método de pago</span>
                  </h3>
                  <span className="text-[11px] text-muted-foreground">{financialStats.byMethod.length} métodos</span>
                </div>
                <div className="space-y-2.5 pt-1">
                  {financialStats.byMethod.map((m) => (
                    <div key={m.method} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{m.method}</span>
                        <span className="font-semibold text-foreground">
                          {money(m.total)}{' '}
                          <span className="text-muted-foreground font-normal">
                            ({Math.round(m.percentage)}%)
                          </span>
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.max(4, m.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cobranza por Barbero */}
              <div className="p-4 rounded-xl border border-border bg-surface shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Users size={14} className="text-primary" />
                    <span>Cobranza por barbero</span>
                  </h3>
                  <span className="text-[11px] text-muted-foreground">{financialStats.byBarber.length} barberos</span>
                </div>
                <div className="space-y-2.5 pt-1">
                  {financialStats.byBarber.map((b) => (
                    <div key={b.barberId} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{b.barberName}</span>
                        <span className="font-semibold text-foreground">
                          {money(b.total)}{' '}
                          <span className="text-muted-foreground font-normal">
                            ({Math.round(b.percentage)}%)
                          </span>
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gold bg-amber-500 transition-all"
                          style={{ width: `${Math.max(4, b.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cobranza por Servicio */}
              <div className="p-4 rounded-xl border border-border bg-surface shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Scissors size={14} className="text-primary" />
                    <span>Cobranza por servicio</span>
                  </h3>
                  <span className="text-[11px] text-muted-foreground">{financialStats.byService.length} servicios</span>
                </div>
                <div className="space-y-2.5 pt-1">
                  {financialStats.byService.map((s) => (
                    <div key={s.serviceName} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{s.serviceName}</span>
                        <span className="font-semibold text-foreground">
                          {money(s.total)}{' '}
                          <span className="text-muted-foreground font-normal">
                            ({Math.round(s.percentage)}%)
                          </span>
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${Math.max(4, s.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Auditoría de inasistencias y excepciones */}
            {(financialControl.retainedNoShowDeposits.count > 0 || financialControl.refundsAndWaives.items.length > 0) && (
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFinancialDetails((curr) => !curr)}
                  className="text-xs h-8 px-2.5 gap-1 text-muted-foreground hover:text-foreground"
                >
                  {showFinancialDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  <span>{showFinancialDetails ? 'Ocultar auditoría de inasistencias' : 'Ver auditoría de inasistencias y excepciones'}</span>
                </Button>

                {showFinancialDetails && (
                  <div className="p-3.5 rounded-xl border border-border bg-surface/70 space-y-2.5 mt-3 animate-in fade-in duration-200">
                    <h4 className="text-xs font-semibold text-foreground tracking-tight">
                      Registro auditable de inasistencias del período
                    </h4>
                    <div className="space-y-2 text-xs">
                      {financialControl.retainedNoShowDeposits.items.map((item) => (
                        <div
                          key={`retained-${item.appointmentId}`}
                          className="p-2.5 rounded-lg border border-purple-500/20 bg-purple-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5"
                        >
                          <div>
                            <span className="font-semibold text-foreground">{item.clientName}</span>
                            <span className="text-muted-foreground"> · {item.serviceName} ({item.barberName})</span>
                            <span className="text-muted-foreground block text-[11px]">
                              {item.date} {item.time} hs {item.reason ? `· Motivo: ${item.reason}` : ''}
                            </span>
                          </div>
                          <div className="text-left sm:text-right shrink-0">
                            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                              Seña retenida: {money(item.depositAmountArs)}
                            </span>
                          </div>
                        </div>
                      ))}

                      {financialControl.refundsAndWaives.items.map((item) => (
                        <div
                          key={`exc-${item.appointmentId}`}
                          className="p-2.5 rounded-lg border border-rose-500/20 bg-rose-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5"
                        >
                          <div>
                            <span className="font-semibold text-foreground">{item.clientName}</span>
                            <span className="text-muted-foreground block text-[11px]">
                              {item.date} · Motivo: {item.reason} {item.actor ? `(Autorizado por: ${item.actor})` : ''}
                            </span>
                          </div>
                          <div className="text-left sm:text-right shrink-0">
                            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
                              {item.decision === 'REFUND' ? `Seña devuelta: ${money(item.amountArs)}` : `Penalización condonada: ${money(item.amountArs)}`}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ========================================================================= */}
      {/* DIRECTORIO HISTÓRICO DE CLIENTES */}
      {/* ========================================================================= */}
      <Suspense fallback={<div className="h-48 w-full animate-pulse rounded-xl border border-border bg-surface p-6" />}>
        <AdminClients
          clients={clientsData}
          loading={loading}
          onAppointmentStatusChange={(appointmentId, newStatus) => {
            setAppointments((curr) =>
              curr.map((apt) =>
                apt.id === appointmentId
                  ? {
                      ...apt,
                      statusCode: newStatus,
                      status: newStatus === 'CONFIRMED' ? 'Confirmado' : 'Cancelado',
                    }
                  : apt
              )
            );
          }}
        />
      </Suspense>
    </main>
  );
}
