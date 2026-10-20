import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  BarChart2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Clock3,
  Filter,
  Flame,
  PieChart,
  Receipt,
  RefreshCw,
  RotateCcw,
  Scissors,
  ShieldAlert,
  Sun,
  Sunset,
  Moon,
  TrendingUp,
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
  statisticsPresetLabels,
  type StatisticsDatePreset,
  type TimeSlotFilter,
} from '@/lib/kani-statistics';
const AdminClients = lazy(() => import('./admin-clients').then(m => ({ default: m.AdminClients })));

const presets: StatisticsDatePreset[] = statisticsPresets;

export function AdminStatistics() {
  const { profile, barbers: permittedRows, refreshCount, setIsRefreshing } = useAdminStaff();
  const permittedBarbers = useMemo(
    () => permittedBarberNames(profile, permittedRows),
    [profile, permittedRows],
  );

  const [mounted, setMounted] = useState(false);
  const [appointments, setAppointments] = useState<RealAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [businessToday, setBusinessToday] = useState(() => businessDateToday());
  const [datePreset, setDatePreset] = useState<StatisticsDatePreset>('TODAY');
  const [specificDate, setSpecificDate] = useState(() => businessDateToday());
  const [timeSlotFilter, setTimeSlotFilter] = useState<TimeSlotFilter>('ALL');
  const [barberFilter, setBarberFilter] = useState('Todos');

  useEffect(() => {
    setMounted(true);
  }, []);

  async function loadData() {
    setLoading(true);
    setIsRefreshing(true);
    setError('');
    try {
      const data = await readRealAppointments();
      setAppointments(data);
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

  // Keep business date updated
  useEffect(() => {
    const interval = window.setInterval(() => {
      const next = businessDateToday();
      setBusinessToday((curr) => (curr === next ? curr : next));
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // Compute Active Date Range
  const activeDateRange = useMemo(() => {
    return dateRangeForStatisticsPreset(datePreset, businessToday, specificDate);
  }, [datePreset, businessToday, specificDate]);

  // Filter Appointments for Statistics
  const permittedBarberIds = useMemo(
    () => new Set(permittedRows.map((r) => r.id)),
    [permittedRows],
  );

  const filteredAppointments = useMemo(() => {
    return filterStatisticsAppointments(appointments, {
      dateRange: activeDateRange,
      timeSlotFilter,
      barberFilter,
      role: profile.role,
      profileBarberId: profile.barber_id,
      permittedBarberIds,
    });
  }, [
    appointments,
    activeDateRange,
    timeSlotFilter,
    barberFilter,
    profile.role,
    profile.barber_id,
    permittedBarberIds,
  ]);

  // Filter Appointments for Clients Directory (Scoped to permitted barbers, all time)
  const clientsData = useMemo(() => {
    const scopedAppointments = appointments.filter((apt) => {
      if (!permittedBarberIds.has(apt.barberId)) return false;
      if (profile.role === 'BARBER') return apt.barberId === profile.barber_id;
      return true;
    });
    return aggregateClientsDirectory(scopedAppointments);
  }, [appointments, permittedBarberIds, profile.role, profile.barber_id]);

  const [showFinancialDetails, setShowFinancialDetails] = useState(false);

  // Analytics Metrics
  const kpis = useMemo(() => computeKpiSummary(filteredAppointments), [filteredAppointments]);
  const financial = useMemo(() => computeFinancialControl(filteredAppointments), [filteredAppointments]);
  const dailyDemand = useMemo(() => computeDailyDemand(filteredAppointments), [filteredAppointments]);
  const hourlyDemand = useMemo(
    () => computeHourlyDistribution(filteredAppointments),
    [filteredAppointments],
  );
  const serviceDemand = useMemo(() => computeServiceDemand(filteredAppointments), [filteredAppointments]);

  return (
    <main className="site-container admin-stats-page">
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

      {/* Filter Controls Card - Unified controls group */}
      <section
        className="p-3.5 rounded-xl border border-border bg-surface shadow-xs mb-4 space-y-3"
        aria-label="Filtros de estadísticas"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {/* Selector 1: Período */}
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
                    {statisticsPresetLabels[preset]}
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

          {/* Selector 2: Franja horaria */}
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

          {/* Selector 3: Barbero */}
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
        </div>
      </section>

      {/* KPI Summary Cards - 4 visible categories */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4" aria-label="Indicadores clave">
        {/* Total */}
        <div className="p-3.5 rounded-xl border border-border bg-surface flex flex-col justify-between">
          <span className="text-xs text-muted-foreground">Total de turnos</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-foreground">
              {loading ? '…' : kpis.total}
            </span>
            <Calendar size={16} className="text-muted-foreground opacity-60" />
          </div>
        </div>

        {/* Confirmados */}
        <div className="p-3.5 rounded-xl border border-success/30 bg-success/5 flex flex-col justify-between">
          <span className="text-xs text-success font-medium">Confirmados</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-success">
              {loading ? '…' : kpis.confirmed}
            </span>
            <CheckCircle2 size={16} className="text-success" />
          </div>
        </div>

        {/* Pendientes */}
        <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5 flex flex-col justify-between">
          <span className="text-xs text-amber-500 font-medium">Pendientes</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-amber-500">
              {loading ? '…' : kpis.pending}
            </span>
            <Clock size={16} className="text-amber-500" />
          </div>
        </div>

        {/* Cancelados */}
        <div className="p-3.5 rounded-xl border border-destructive/30 bg-destructive/5 flex flex-col justify-between">
          <span className="text-xs text-destructive font-medium">Cancelados</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-destructive">
              {loading ? '…' : kpis.cancelled}
            </span>
            <XCircle size={16} className="text-destructive" />
          </div>
        </div>
      </section>

      {/* Apartado visual: Control de cobros */}
      <section className="mb-6 space-y-3" aria-label="Control de cobros">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Wallet size={16} className="text-gold" />
              <span>Control de cobros</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Ingresos efectivamente recibidos, saldos pendientes y señas retenidas por inasistencias en el período.
            </p>
          </div>
          {(financial.retainedNoShowDeposits.count > 0 || financial.refundsAndWaives.items.length > 0) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowFinancialDetails((curr) => !curr)}
              className="text-xs h-8 px-2.5 self-start sm:self-auto gap-1 text-muted-foreground hover:text-foreground"
            >
              {showFinancialDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              <span>{showFinancialDetails ? 'Ocultar auditoría' : 'Ver detalle de excepciones'}</span>
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* A. Señas cobradas */}
          <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-emerald-400 font-medium">Señas cobradas</span>
                <Receipt size={16} className="text-emerald-400" />
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">Dinero efectivamente recibido</p>
            </div>
            <div className="mt-3">
              <span className="text-xl sm:text-2xl font-bold text-foreground">
                {loading ? '…' : money(financial.depositsCollected.totalArs)}
              </span>
              <span className="text-[11px] text-muted-foreground block mt-0.5">
                {financial.depositsCollected.count} {financial.depositsCollected.count === 1 ? 'seña recibida' : 'señas recibidas'}
              </span>
            </div>
          </div>

          {/* B. Cobros pendientes */}
          <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-amber-500 font-medium">Cobros pendientes</span>
                <Clock size={16} className="text-amber-500" />
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">Saldo de turnos vigentes con seña</p>
            </div>
            <div className="mt-3">
              <span className="text-xl sm:text-2xl font-bold text-foreground">
                {loading ? '…' : money(financial.pendingBalances.totalArs)}
              </span>
              <span className="text-[11px] text-muted-foreground block mt-0.5">
                {financial.pendingBalances.count} {financial.pendingBalances.count === 1 ? 'turno por cobrar' : 'turnos por cobrar'}
              </span>
            </div>
          </div>

          {/* C. Total cobrado por servicios ejecutados */}
          <div className="p-3.5 rounded-xl border border-border bg-surface flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-foreground font-medium">Servicios ejecutados</span>
                <CheckCircle2 size={16} className="text-foreground/70" />
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">Cobro de servicios realizados</p>
            </div>
            <div className="mt-3">
              <span className="text-xl sm:text-2xl font-bold text-foreground">
                {loading ? '…' : money(financial.completedServices.totalCollectedArs)}
              </span>
              <span className="text-[11px] text-muted-foreground block mt-0.5">
                {financial.completedServices.count} {financial.completedServices.count === 1 ? 'servicio ejecutado' : 'servicios ejecutados'}
                {financial.completedServices.unpaidBalanceArs > 0 ? ` · Saldo impago: ${money(financial.completedServices.unpaidBalanceArs)}` : ''}
              </span>
            </div>
          </div>

          {/* D. Señas retenidas por inasistencias */}
          <div className="p-3.5 rounded-xl border border-purple-500/30 bg-purple-500/5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-purple-400 font-medium">Señas retenidas</span>
                <ShieldAlert size={16} className="text-purple-400" />
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">Inasistencias no devueltas</p>
            </div>
            <div className="mt-3">
              <span className="text-xl sm:text-2xl font-bold text-foreground">
                {loading ? '…' : money(financial.retainedNoShowDeposits.totalArs)}
              </span>
              <span className="text-[11px] text-muted-foreground block mt-0.5">
                {financial.retainedNoShowDeposits.count} {financial.retainedNoShowDeposits.count === 1 ? 'seña retenida' : 'señas retenidas'}
              </span>
            </div>
          </div>

          {/* E. Devoluciones y condonaciones */}
          <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-rose-400 font-medium">Devoluciones / Condonadas</span>
                <RotateCcw size={16} className="text-rose-400" />
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">Impacto de excepciones</p>
            </div>
            <div className="mt-3">
              <span className="text-xl sm:text-2xl font-bold text-foreground">
                {loading ? '…' : money(financial.refundsAndWaives.totalImpactArs)}
              </span>
              <span className="text-[11px] text-muted-foreground block mt-0.5">
                {financial.refundsAndWaives.refundsCount > 0 ? `${financial.refundsAndWaives.refundsCount} dev. (${money(financial.refundsAndWaives.refundsTotalArs)})` : '0 dev.'}
                {financial.refundsAndWaives.waivesCount > 0 ? ` · ${financial.refundsAndWaives.waivesCount} cond. (${money(financial.refundsAndWaives.waivesTotalArs)})` : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Desglose auditable de inasistencias y excepciones */}
        {showFinancialDetails && (financial.retainedNoShowDeposits.count > 0 || financial.refundsAndWaives.items.length > 0) && (
          <div className="p-3.5 rounded-xl border border-border bg-surface/70 space-y-3 mt-3 animate-in fade-in duration-200">
            <h4 className="text-xs font-semibold text-foreground tracking-tight">
              Registro auditable de inasistencias y excepciones del período
            </h4>
            <div className="space-y-2 text-xs">
              {financial.retainedNoShowDeposits.items.map((item) => (
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

              {financial.refundsAndWaives.items.map((item) => (
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
      </section>

      {/* Empty State */}
      {!loading && filteredAppointments.length === 0 && (
        <div className="p-8 text-center border border-dashed border-border rounded-xl bg-surface/50 my-6">
          <BarChart2 size={36} className="mx-auto text-muted-foreground/60 mb-2" />
          <h3 className="text-sm font-semibold text-foreground">Sin registros en este período</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            No se encontraron reservas con los filtros aplicados. Probá seleccionando otro rango de fechas o franja horaria.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDatePreset('TODAY');
              setTimeSlotFilter('ALL');
              setBarberFilter('Todos');
            }}
            className="mt-3 text-xs"
          >
            Restablecer filtros
          </Button>
        </div>
      )}

      {/* Main Charts Grid */}
      {!loading && filteredAppointments.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Demanda por Fecha (2 cols) */}
          <section
            className="lg:col-span-2 p-4 rounded-xl border border-border bg-surface shadow-xs space-y-4"
            aria-label="Demanda por fecha"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <TrendingUp size={16} className="stat-text-accent" />
                  <span>Demanda por Fecha</span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Evolución temporal de reservas registradas en el período.
                </p>
              </div>

              {dailyDemand.peakDate && (
                <div className="flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full stat-badge-peak border font-medium">
                  <Flame size={12} className="stat-text-peak" />
                  <span>Pico: {dailyDemand.peakDate} ({dailyDemand.peakCount} turnos)</span>
                </div>
              )}
            </div>

            {/* Recharts BarChart */}
            <div className="w-full h-64 pt-2">
              {mounted && dailyDemand.points.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyDemand.points} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                      interval="preserveStartEnd"
                      stroke="var(--border)"
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                      stroke="var(--border)"
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="p-2.5 rounded-lg border border-border bg-surface text-xs shadow-md space-y-1">
                              <p className="font-semibold text-foreground">{data.date}</p>
                              <p className="stat-text-accent">Total reservas: {data.count}</p>
                              <p className="text-success">Confirmados: {data.confirmed}</p>
                              <p className="text-destructive">Cancelados: {data.cancelled}</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
                      {dailyDemand.points.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.isPeak ? 'var(--stat-bar-peak)' : 'var(--stat-bar-normal)'}
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
          </section>

          {/* Demanda por Horario (1 col) */}
          <section
            className="p-4 rounded-xl border border-border bg-surface shadow-xs space-y-4"
            aria-label="Demanda por horario"
          >
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <Clock3 size={16} className="stat-text-accent" />
                <span>Demanda por Horario</span>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Distribución por franja horaria (mañana, tarde y noche) y horas pico.
              </p>
            </div>

            {/* Morning vs Afternoon vs Night Summary (3 categories) */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              {/* Mañana: 10:00 a 12:00 */}
              <div className="p-2.5 rounded-lg bg-background border border-border flex flex-col justify-between">
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <Sun size={13} className="text-amber-500 shrink-0" />
                  <span className="truncate">Mañana</span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <strong className="text-base text-foreground font-semibold">
                    {hourlyDemand.morningCount}
                  </strong>
                  <span className="text-[11px] text-muted-foreground font-medium">
                    {hourlyDemand.morningPercentage}%
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground/75 mt-0.5">10:00 - 12:00</span>
              </div>

              {/* Tarde: 12:00 a 18:00 */}
              <div className="p-2.5 rounded-lg bg-background border border-border flex flex-col justify-between">
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <Sunset size={13} className="text-indigo-400 shrink-0" />
                  <span className="truncate">Tarde</span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <strong className="text-base text-foreground font-semibold">
                    {hourlyDemand.afternoonCount}
                  </strong>
                  <span className="text-[11px] text-muted-foreground font-medium">
                    {hourlyDemand.afternoonPercentage}%
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground/75 mt-0.5">12:00 - 18:00</span>
              </div>

              {/* Noche: 18:00 a 20:00 */}
              <div className="p-2.5 rounded-lg bg-background border border-border flex flex-col justify-between">
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <Moon size={13} className="text-blue-400 shrink-0" />
                  <span className="truncate">Noche</span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <strong className="text-base text-foreground font-semibold">
                    {hourlyDemand.nightCount}
                  </strong>
                  <span className="text-[11px] text-muted-foreground font-medium">
                    {hourlyDemand.nightPercentage}%
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground/75 mt-0.5">18:00 - 20:00</span>
              </div>
            </div>

            {/* Peak Hour Badge */}
            {hourlyDemand.peakHour && (
              <div className="p-2 rounded-lg stat-badge-peak border flex items-center justify-between text-xs font-medium">
                <span className="flex items-center gap-1 opacity-90">
                  <Flame size={13} className="stat-text-peak" />
                  Hora de mayor concentración:
                </span>
                <span className="font-bold stat-text-peak">
                  {hourlyDemand.peakHour} ({hourlyDemand.peakHourCount} turnos)
                </span>
              </div>
            )}

            {/* Hourly breakdown bars */}
            <div className="space-y-2 pt-1 max-h-48 overflow-y-auto pr-1">
              {hourlyDemand.slots.map((slot) => (
                <div key={slot.hourSlot} className="text-xs space-y-1">
                  <div className="flex justify-between text-muted-foreground">
                    <span className="font-medium text-foreground">{slot.hourSlot}</span>
                    <span>
                      {slot.count} turnos ({slot.percentage}%)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        slot.isPeak ? 'stat-bar-fill-peak' : 'stat-bar-fill-normal'
                      }`}
                      style={{ width: `${Math.max(4, slot.percentage)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Servicios Más Solicitados (Full width or span 3) */}
          <section
            className="lg:col-span-3 p-4 rounded-xl border border-border bg-surface shadow-xs space-y-4"
            aria-label="Servicios más solicitados"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Scissors size={16} className="stat-text-accent" />
                  <span>Servicios más Solicitados</span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Desglose comparativo de servicios configurados en el sistema por volumen de demanda.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {serviceDemand.map((srv, index) => (
                <div
                  key={srv.serviceName}
                  className="p-3.5 rounded-xl border border-border bg-background flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold stat-text-accent uppercase tracking-wider">
                        #{index + 1} en demanda
                      </span>
                      <h4 className="font-semibold text-sm text-foreground truncate mt-0.5">
                        {srv.serviceName}
                      </h4>
                    </div>
                    <span className="text-xs font-bold text-foreground bg-muted/40 px-2 py-0.5 rounded-md shrink-0">
                      {srv.count} turnos
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Participación</span>
                      <span className="font-semibold text-foreground">{srv.percentage}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
                      <div
                        className="h-full rounded-full stat-bar-fill-service transition-all"
                        style={{ width: `${Math.max(4, srv.percentage)}%` }}
                      />
                    </div>
                  </div>

                  {srv.totalRevenue > 0 && (
                    <div className="text-[11px] text-muted-foreground pt-2 border-t border-border/40 flex justify-between">
                      <span>Monto estimado:</span>
                      <span className="font-semibold text-foreground">
                        ${srv.totalRevenue.toLocaleString('es-AR')}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Clientes Section (Directorio de Clientes) */}
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
