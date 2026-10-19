import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Calendar, CalendarPlus, Check, CheckCircle2, CircleDot, Clock, Clock3, Mail, RefreshCw, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { dateLabel, money, serviceFor } from '@/lib/kani-model';
import { formatPhoneDisplay, formatPhoneWithCountryAndWhatsApp, normalizePhone, type PhoneCountry } from '@/lib/kani-phone';
import { PhoneInput } from '@/components/kani/phone-input';
import { cn } from '@/lib/utils';
import { useAdminStaff } from '@/lib/kani-admin-context';
import { appointmentErrorMessage, createManualAppointment, readRealAppointments, retryRealAppointmentNotification, updateRealAppointmentStatus, type ManualFrequency, MANUAL_FREQUENCY_LABELS, type RealAppointment, type RealAppointmentStatus } from '@/lib/kani-appointments';
import { addCalendarDays, businessDateToday, dateRangeForAppointmentsPreset, filterMobileAppointments, appointmentsPresets, appointmentsPresetLabels, type AppointmentsDatePreset, type MobileStatusFilter } from '@/lib/kani-mobile-appointments';
import { permittedBarberNames } from '@/lib/kani-role-scope';
import { supabase } from '@/integrations/supabase/client';

type StatusFilter = MobileStatusFilter;

type StatusMeta = {
  label: string;
  tone: 'pending' | 'confirmed' | 'cancelled' | 'completed';
};

const statusMeta: Record<RealAppointmentStatus, StatusMeta> = {
  PENDING: { label: 'Pendiente', tone: 'pending' },
  CONFIRMED: { label: 'Confirmado', tone: 'confirmed' },
  CANCELLED: { label: 'Cancelado', tone: 'cancelled' },
  COMPLETED: { label: 'Confirmado', tone: 'confirmed' },
};

const statusFilters: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'Todos' },
  { value: 'PENDING', label: 'Pendientes' },
  { value: 'CONFIRMED', label: 'Confirmados' },
  { value: 'CANCELLED', label: 'Cancelados' },
];

const summaryFilters = statusFilters;

const summaryCardConfig: Record<StatusFilter, {
  icon: typeof Calendar;
  cardBase: string;
  labelTone: string;
  numberTone: string;
  iconTone: string;
}> = {
  ALL: {
    icon: Calendar,
    cardBase: 'border-border bg-surface',
    labelTone: 'text-muted-foreground',
    numberTone: 'text-foreground',
    iconTone: 'text-muted-foreground opacity-60',
  },
  CONFIRMED: {
    icon: CheckCircle2,
    cardBase: 'border-success/30 bg-success/5',
    labelTone: 'text-success font-medium',
    numberTone: 'text-success',
    iconTone: 'text-success',
  },
  PENDING: {
    icon: Clock,
    cardBase: 'border-amber-500/30 bg-amber-500/5',
    labelTone: 'text-amber-500 font-medium',
    numberTone: 'text-amber-500',
    iconTone: 'text-amber-500',
  },
  CANCELLED: {
    icon: XCircle,
    cardBase: 'border-destructive/30 bg-destructive/5',
    labelTone: 'text-destructive font-medium',
    numberTone: 'text-destructive',
    iconTone: 'text-destructive',
  },
};

const datePresets = appointmentsPresets;

function statusTone(value: StatusFilter) {
  return value === 'ALL' ? 'all' : statusMeta[value].tone;
}

export function AdminMobileAppointments() {
  const { profile, barbers: permittedRows, refreshCount, setIsRefreshing } = useAdminStaff();
  const permittedBarbers = useMemo(() => permittedBarberNames(profile, permittedRows), [profile, permittedRows]);
  const [appointments, setAppointments] = useState<RealAppointment[]>([]);
  const [servicesList, setServicesList] = useState<Array<{ id: string; name: string; duration_minutes: number; price_ars: number }>>([]);
  const [businessToday, setBusinessToday] = useState(() => businessDateToday());
  const [datePreset, setDatePreset] = useState<AppointmentsDatePreset>('TODAY');
  const [specificDate, setSpecificDate] = useState(() => businessDateToday());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [barberFilter, setBarberFilter] = useState('Todos');
  const [cancelTarget, setCancelTarget] = useState<RealAppointment | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Modal para agregar turno manual
  const scrollPosRef = useRef<number>(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState('');
  const [manualDate, setManualDate] = useState(() => businessDateToday());
  const [manualTime, setManualTime] = useState('10:00');
  const [manualClientName, setManualClientName] = useState('');
  const [manualClientPhone, setManualClientPhone] = useState('');
  const [phoneCountry, setPhoneCountry] = useState<PhoneCountry>('AR');
  const [manualClientEmail, setManualClientEmail] = useState('');
  const [manualEmailError, setManualEmailError] = useState('');
  const [manualEmailTouched, setManualEmailTouched] = useState(false);
  const [manualServiceId, setManualServiceId] = useState('');
  const [manualBarberId, setManualBarberId] = useState('');
  const [manualFrequency, setManualFrequency] = useState<ManualFrequency>('ONCE');
  const [manualDepositRequired, setManualDepositRequired] = useState(false);
  const [manualNotes, setManualNotes] = useState('');

  // Cargar lista de servicios activos
  useEffect(() => {
    async function loadServices() {
      const { data } = await supabase.from('services').select('id, name, duration_minutes, price_ars').eq('active', true).order('name');
      if (data && data.length) {
        setServicesList(data);
        setManualServiceId(data[0].id);
      }
    }
    void loadServices();
  }, []);

  async function reload() {
    setLoading(true);
    setIsRefreshing(true);
    try {
      setAppointments(await readRealAppointments());
      setError('');
    } catch (cause) {
      setError(appointmentErrorMessage(cause));
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    if (refreshCount > 0) void reload();
  }, [refreshCount]);
  useEffect(() => {
    if (profile.role === 'BARBER' && permittedBarbers[0]) setBarberFilter(permittedBarbers[0]);
  }, [profile.role, permittedBarbers]);
  useEffect(() => {
    const updateBusinessDate = () => {
      const next = businessDateToday();
      setBusinessToday(current => current === next ? current : next);
    };
    const interval = window.setInterval(updateBusinessDate, 60_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    const updateScrollState = () => setShowScrollTop(window.scrollY > 420);
    updateScrollState();
    window.addEventListener('scroll', updateScrollState, { passive: true });
    return () => window.removeEventListener('scroll', updateScrollState);
  }, []);

  const permittedBarberIds = useMemo(() => new Set(permittedRows.map(barber => barber.id)), [permittedRows]);
  const dateRange = useMemo(() => dateRangeForAppointmentsPreset(datePreset, businessToday, specificDate), [businessToday, datePreset, specificDate]);
  const dayAppointments = useMemo(() => filterMobileAppointments(appointments, {
    dateRange,
    statusFilter: 'ALL',
    barberFilter,
    role: profile.role,
    profileBarberId: profile.barber_id,
    permittedBarberIds,
  }), [appointments, barberFilter, dateRange, permittedBarberIds, profile.barber_id, profile.role]);
  const filteredAppointments = useMemo(() => {
    if (statusFilter === 'ALL') return dayAppointments;
    if (statusFilter === 'CONFIRMED') {
      return dayAppointments.filter(appointment => appointment.statusCode === 'CONFIRMED' || (appointment.statusCode as string) === 'COMPLETED');
    }
    return dayAppointments.filter(appointment => appointment.statusCode === statusFilter);
  }, [dayAppointments, statusFilter]);
  const counts = useMemo(() => ({
    ALL: dayAppointments.length,
    PENDING: dayAppointments.filter(appointment => appointment.statusCode === 'PENDING').length,
    CONFIRMED: dayAppointments.filter(appointment => appointment.statusCode === 'CONFIRMED' || (appointment.statusCode as string) === 'COMPLETED').length,
    CANCELLED: dayAppointments.filter(appointment => appointment.statusCode === 'CANCELLED').length,
  }), [dayAppointments]);
  const countContext = datePreset === 'SPECIFIC' && specificDate
    ? `el ${specificDate.split('-').reverse().join('/')}`
    : appointmentsPresetLabels[datePreset].toLowerCase();
  const appointmentCountLabel = `${filteredAppointments.length} ${filteredAppointments.length === 1 ? 'turno' : 'turnos'} ${countContext}`;

  function selectDatePreset(next: AppointmentsDatePreset) {
    if (next === 'TODAY') setSpecificDate(businessToday);
    else if (next === 'TOMORROW') setSpecificDate(addCalendarDays(businessToday, 1));
    else if (next === 'SPECIFIC') setSpecificDate(current => current || businessToday);
    else setSpecificDate(businessToday);
    setDatePreset(next);
  }

  function selectSpecificDate(next: string) {
    const safeDate = next || businessToday;
    setSpecificDate(safeDate);
    setDatePreset('SPECIFIC');
  }

  function validateManualEmail(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return 'El correo electrónico es obligatorio.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return 'Ingresá un formato de correo válido (ej. cliente@ejemplo.com).';
    }
    return '';
  }

  function openManualAppointmentDialog() {
    scrollPosRef.current = window.scrollY || document.documentElement.scrollTop;
    setManualError('');
    setManualEmailError('');
    setManualEmailTouched(false);
    setManualDate(specificDate || businessToday);
    setManualTime('10:00');
    setManualClientName('');
    setManualClientPhone('');
    setPhoneCountry('AR');
    setManualClientEmail('');
    setManualNotes('');
    setManualFrequency('ONCE');
    setManualDepositRequired(false);
    if (profile.role === 'BARBER') {
      setManualBarberId(profile.barber_id || permittedRows[0]?.id || '');
    } else {
      setManualBarberId(permittedRows[0]?.id || '');
    }
    if (servicesList.length && !manualServiceId) {
      setManualServiceId(servicesList[0].id);
    }
    setManualOpen(true);
  }

  function handleCancel() {
    const savedY = scrollPosRef.current;
    setManualOpen(false);
    setManualError('');
    setManualEmailError('');
    setManualEmailTouched(false);
    setManualDepositRequired(false);
    requestAnimationFrame(() => {
      window.scrollTo({ top: savedY, behavior: 'instant' });
      setTimeout(() => {
        window.scrollTo({ top: savedY, behavior: 'instant' });
      }, 40);
    });
  }

  async function handleCreateManualAppointment(e: React.FormEvent) {
    e.preventDefault();
    setManualError('');

    if (!manualBarberId) {
      setManualError('Seleccioná un barbero.');
      return;
    }
    if (!manualServiceId) {
      setManualError('Seleccioná un servicio.');
      return;
    }
    if (!manualDate) {
      setManualError('Seleccioná una fecha.');
      return;
    }
    if (!manualTime) {
      setManualError('Ingresá el horario de inicio.');
      return;
    }
    if (manualClientName.trim().length < 3) {
      setManualError('El nombre del cliente debe tener al menos 3 caracteres.');
      return;
    }
    const normalized = normalizePhone(manualClientPhone, phoneCountry);
    if (!normalized) {
      setManualError('Ingresá un celular válido para el país seleccionado.');
      return;
    }

    const emailValidation = validateManualEmail(manualClientEmail);
    if (emailValidation) {
      setManualEmailTouched(true);
      setManualEmailError(emailValidation);
      setManualError(emailValidation);
      return;
    }
    const cleanEmail = manualClientEmail.trim();

    setManualSaving(true);
    try {
      const isRecurring = manualFrequency !== 'ONCE';
      const freqLabel = MANUAL_FREQUENCY_LABELS[manualFrequency];
      const notesPayload = isRecurring
        ? (manualNotes.trim() ? `${manualNotes.trim()}\n[Frecuencia: ${freqLabel}]` : `[Frecuencia: ${freqLabel}]`)
        : manualNotes.trim() || undefined;

      await createManualAppointment({
        barberId: manualBarberId,
        serviceId: manualServiceId,
        date: manualDate,
        time: manualTime,
        name: manualClientName.trim(),
        phone: normalized.e164,
        email: cleanEmail,
        notes: notesPayload,
        isRecurring,
        frequency: manualFrequency,
        depositRequired: manualDepositRequired,
      });

      setNotice(
        isRecurring
          ? `Turno recurrente (${freqLabel.toLowerCase()}) registrado para ${manualClientName.trim()}.`
          : `Turno manual confirmado para ${manualClientName.trim()}.`
      );
      setManualOpen(false);
      setManualEmailError('');
      setManualEmailTouched(false);
      await reload();
    } catch (cause) {
      setManualError(appointmentErrorMessage(cause));
    } finally {
      setManualSaving(false);
    }
  }

  async function changeStatus(appointment: RealAppointment, next: 'CONFIRMED' | 'CANCELLED') {
    setBusyId(appointment.id);
    try {
      await updateRealAppointmentStatus(appointment.id, next);
      await reload();
      setNotice(`Turno de ${appointment.name}: ${statusMeta[next].label.toLowerCase()}.`);
      setCancelTarget(null);
    } catch (cause) {
      setError(appointmentErrorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function retryNotification(appointment: RealAppointment) {
    setBusyId(appointment.id);
    setError('');
    try {
      const result = await retryRealAppointmentNotification(appointment.id);
      setNotice(result === 'ALREADY_SENT' ? 'La notificación ya había sido enviada.' : 'Notificación reenviada correctamente.');
    } catch (cause) {
      setError(appointmentErrorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  function renderStatus(status: RealAppointmentStatus) {
    const meta = statusMeta[status];
    const Icon = status === 'PENDING' ? CircleDot : status === 'CANCELLED' ? XCircle : Check;
    const toneClasses =
      status === 'PENDING'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
        : status === 'CANCELLED'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-success/30 bg-success/10 text-success';
    return (
      <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border', toneClasses)}>
        <Icon size={13} />
        {meta.label}
      </span>
    );
  }

  return <main className="site-container admin-mobile-page">
    <div className="admin-mobile-shell">
      {/* 1. Filtros de agenda (idéntico a la card de filtros de Estadísticas) */}
      <section className="p-3.5 rounded-xl border border-border bg-surface shadow-xs mb-4" aria-label="Filtros de agenda">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label htmlFor="mobile-date-preset" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Período
            </label>
            <select
              id="mobile-date-preset"
              value={datePreset}
              onChange={event => selectDatePreset(event.target.value as AppointmentsDatePreset)}
              aria-label="Filtrar por período"
              className="select-control w-full h-9 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
            >
              {appointmentsPresets.map(preset => (
                <option key={preset} value={preset}>{appointmentsPresetLabels[preset]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="mobile-date-filter" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Fecha
            </label>
            <input
              id="mobile-date-filter"
              type="date"
              value={specificDate}
              onChange={event => selectSpecificDate(event.target.value)}
              aria-label="Elegir fecha específica"
              className="select-control w-full h-[44px] min-h-[44px] px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 leading-normal"
            />
          </div>
          <div>
            <label htmlFor="mobile-status-filter" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Estado
            </label>
            <select
              id="mobile-status-filter"
              value={statusFilter}
              onChange={event => setStatusFilter(event.target.value as StatusFilter)}
              className="select-control w-full h-9 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
            >
              {statusFilters.map(filter => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="mobile-barber-filter" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Barbero
            </label>
            {profile.role === 'ADMIN' ? (
              <select
                id="mobile-barber-filter"
                value={barberFilter}
                onChange={event => setBarberFilter(event.target.value)}
                className="select-control w-full h-9 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
              >
                <option value="Todos">Todos</option>
                {permittedBarbers.map(barber => (
                  <option key={barber} value={barber}>{barber}</option>
                ))}
              </select>
            ) : (
              <output id="mobile-barber-filter" className="select-control w-full h-[44px] min-h-[44px] px-3 text-xs bg-muted/40 border border-border rounded-lg text-muted-foreground flex items-center cursor-not-allowed">
                {permittedBarbers[0] ?? 'Tu agenda'}
              </output>
            )}
          </div>
        </div>
      </section>

      {/* 2. Cards de estado / resumen (idéntico a los KPI cards de Estadísticas con fondo bordó activo) */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4" aria-label="Resumen de turnos">
        {summaryFilters.map(filter => {
          const config = summaryCardConfig[filter.value];
          const Icon = config.icon;
          const isActive = statusFilter === filter.value;
          return (
            <button
              key={filter.value}
              type="button"
              className={cn(
                "p-3.5 rounded-xl border flex flex-col justify-between text-left transition-all cursor-pointer relative",
                isActive
                  ? "!bg-[#702B3A] !border-[#702B3A] !text-white shadow-xs"
                  : cn(config.cardBase, "hover:border-foreground/25 hover:shadow-xs")
              )}
              aria-pressed={isActive}
              onClick={() => setStatusFilter(filter.value)}
            >
              <div className="flex items-center justify-between w-full">
                <span className={cn("text-xs font-medium", isActive ? "!text-white" : config.labelTone)}>
                  {filter.label}
                </span>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-white" aria-hidden="true" />
                )}
              </div>
              <div className="mt-2 flex items-baseline justify-between w-full">
                <span className={cn("text-2xl font-bold", isActive ? "!text-white" : config.numberTone)}>
                  {counts[filter.value]}
                </span>
                <Icon size={16} className={isActive ? "!text-white" : config.iconTone} />
              </div>
            </button>
          );
        })}
      </section>

      {/* 3. Avisos contextuales */}
      {notice && (
        <div role="status" className="p-3.5 rounded-xl border border-success/30 bg-success/10 text-success text-xs font-medium flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Check size={16} />
            <span>{notice}</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-success hover:bg-success/20" aria-label="Cerrar aviso" onClick={() => setNotice('')}>
            <X size={14} />
          </Button>
        </div>
      )}
      {error && (
        <div role="alert" className="p-3.5 rounded-xl border border-destructive/40 bg-destructive/10 text-destructive text-xs font-medium flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <XCircle size={16} />
            <span>{error}</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:bg-destructive/20" aria-label="Cerrar error" onClick={() => setError('')}>
            <X size={14} />
          </Button>
        </div>
      )}

      {/* 4. Agenda y lista de turnos */}
      <section className="admin-mobile-agenda" aria-labelledby="mobile-agenda-title">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 id="mobile-agenda-title" className="text-sm font-semibold text-foreground">
              {appointmentCountLabel}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {statusFilter === 'ALL' ? 'Todos los estados' : statusMeta[statusFilter].label}
            </p>
          </div>
          <Button
            type="button"
            className="action-brand inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold shrink-0"
            onClick={openManualAppointmentDialog}
          >
            <CalendarPlus size={15} />
            <span>Agregar turno manual</span>
          </Button>
        </div>

        {loading && (
          <div className="p-8 text-center border border-dashed border-border rounded-xl bg-surface/50 my-6">
            <Clock3 size={32} className="mx-auto text-muted-foreground/60 mb-2 animate-spin" />
            <p className="text-xs text-muted-foreground">Cargando turnos…</p>
          </div>
        )}
        {!loading && filteredAppointments.length === 0 && (
          <div className="p-8 text-center border border-dashed border-border rounded-xl bg-surface/50 my-6">
            <Clock3 size={32} className="mx-auto text-muted-foreground/60 mb-2" />
            <h3 className="text-sm font-semibold text-foreground">No hay turnos para estos filtros</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Probá con otro período, fecha o estado. Los turnos cancelados permanecen en el historial.
            </p>
          </div>
        )}
        <div className="grid gap-3">{filteredAppointments.map(appointment => {
          const fallbackService = serviceFor(appointment.service);
          const serviceName = appointment.serviceName ?? fallbackService.name;
          const serviceDuration = appointment.serviceDuration ?? fallbackService.duration;
          const phoneInfo = formatPhoneWithCountryAndWhatsApp(appointment.phone);
          const phoneHref = phoneInfo.e164 || appointment.phone.replace(/[^\d+]/g, '');
          const phoneLabel = phoneInfo.display || appointment.phone;
          const isManual = Boolean(appointment.isManual || appointment.origin === 'MANUAL');

          return <article className="p-4 rounded-xl border border-border bg-surface shadow-xs space-y-3" key={appointment.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col">
                <strong className="text-xl font-bold text-foreground leading-none">{appointment.time}</strong>
                <span className="text-xs text-muted-foreground mt-1 capitalize">hasta {appointment.endTime?.slice(0, 5) ?? '—'} · {dateLabel(appointment.date)}</span>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                {renderStatus(appointment.statusCode)}
                {isManual && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-gold/15 text-gold border border-gold/30">
                    {appointment.recurringRuleId ? 'Turno permanente' : 'Turno manual'}
                  </span>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-border/60">
              <h3 className="font-semibold text-foreground text-sm">{appointment.name}</h3>
              <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                {/* Fila 1: Servicio | Barbero */}
                <div className="p-2 rounded-lg bg-background border border-border/70 min-w-0">
                  <span className="text-[11px] text-muted-foreground block">Servicio</span>
                  <strong className="font-medium text-foreground block truncate" title={`${serviceName} · ${serviceDuration} min`}>
                    {serviceName} · {serviceDuration} min
                  </strong>
                </div>
                <div className="p-2 rounded-lg bg-background border border-border/70 min-w-0">
                  <span className="text-[11px] text-muted-foreground block">Barbero</span>
                  <strong className="font-medium text-foreground block truncate" title={appointment.barber}>
                    {appointment.barber}
                  </strong>
                </div>

                {/* Fila 2: Celular | Abona seña */}
                <div className="p-2 rounded-lg bg-background border border-border/70 min-w-0">
                  <span className="text-[11px] text-muted-foreground block">Celular</span>
                  <a
                    href={`tel:${phoneHref}`}
                    className="font-medium text-foreground truncate block hover:underline"
                    title={phoneLabel}
                  >
                    {phoneLabel}
                  </a>
                </div>
                <div className="p-2 rounded-lg bg-background border border-border/70 min-w-0">
                  <span className="text-[11px] text-muted-foreground block">Abona seña</span>
                  <strong className="font-medium text-foreground block truncate">
                    {appointment.depositPaid || appointment.depositRequired ? 'Sí' : 'No'}
                  </strong>
                </div>

                {/* Fila 3: Email | Importe total */}
                <div className="p-2 rounded-lg bg-background border border-border/70 min-w-0">
                  <span className="text-[11px] text-muted-foreground block">Email</span>
                  <a
                    href={`mailto:${appointment.email}`}
                    className="font-medium text-foreground truncate block hover:underline"
                    title={appointment.email}
                  >
                    {appointment.email}
                  </a>
                </div>
                <div className="p-2 rounded-lg bg-background border border-border/70 min-w-0">
                  <span className="text-[11px] text-muted-foreground block">Importe total</span>
                  <strong className="font-medium text-foreground block truncate">
                    {appointment.servicePrice !== undefined ? money(appointment.servicePrice) : '—'}
                  </strong>
                </div>
              </div>

              {/* Origen manual en bloque inferior */}
              {isManual && (
                <div className="mt-2 p-2 rounded-lg bg-background border border-border/70 text-xs">
                  <span className="text-[11px] text-muted-foreground block">Origen</span>
                  <strong className="text-gold font-medium block truncate">
                    Manual {appointment.createdByDisplayName ? `· Generado por: ${appointment.createdByDisplayName}` : ''}
                  </strong>
                </div>
              )}

              {/* Observaciones en bloque inferior */}
              {appointment.notes?.trim() && (
                <div className="mt-2 p-2.5 rounded-lg bg-background border border-border/70 text-xs">
                  <span className="text-[11px] text-muted-foreground block mb-0.5">Observaciones</span>
                  <p className="text-foreground text-xs leading-relaxed break-words">{appointment.notes.trim()}</p>
                </div>
              )}
            </div>

            {(appointment.statusCode === 'PENDING' || appointment.statusCode === 'CONFIRMED' || appointment.statusCode === 'CANCELLED') && (
              <div className="pt-2 border-t border-border/60">
                {appointment.statusCode === 'PENDING' && (
                  <div className="grid grid-cols-3 gap-2 w-full">
                    <Button
                      size="sm"
                      className="action-positive h-9 text-xs px-2 w-full justify-center min-w-0"
                      disabled={busyId === appointment.id}
                      onClick={() => void changeStatus(appointment, 'CONFIRMED')}
                    >
                      <Check size={14} className="mr-1 shrink-0" />
                      <span className="truncate">Confirmar</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="action-brand-outline h-9 text-xs px-2 w-full justify-center min-w-0"
                      disabled={busyId === appointment.id}
                      onClick={() => setCancelTarget(appointment)}
                    >
                      <X size={14} className="mr-1 shrink-0" />
                      <span className="truncate">Rechazar</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 text-xs px-2 w-full justify-center min-w-0 text-muted-foreground hover:text-foreground"
                      disabled={busyId === appointment.id}
                      onClick={() => void retryNotification(appointment)}
                    >
                      <Mail size={14} className="mr-1 shrink-0" />
                      <span className="truncate">Enviar correo</span>
                    </Button>
                  </div>
                )}
                {appointment.statusCode === 'CONFIRMED' && (
                  <div className="grid grid-cols-2 gap-2 w-full">
                    <Button
                      size="sm"
                      variant="outline"
                      className="action-brand-outline h-9 text-xs px-2 w-full justify-center min-w-0"
                      disabled={busyId === appointment.id}
                      onClick={() => setCancelTarget(appointment)}
                    >
                      <X size={14} className="mr-1 shrink-0" />
                      <span className="truncate">Cancelar turno</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 text-xs px-2 w-full justify-center min-w-0 text-muted-foreground hover:text-foreground"
                      disabled={busyId === appointment.id}
                      onClick={() => void retryNotification(appointment)}
                    >
                      <Mail size={14} className="mr-1 shrink-0" />
                      <span className="truncate">Enviar correo</span>
                    </Button>
                  </div>
                )}
                {appointment.statusCode === 'CANCELLED' && (
                  <div className="w-full">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 text-xs px-2 w-full justify-center min-w-0 text-muted-foreground hover:text-foreground"
                      disabled={busyId === appointment.id}
                      onClick={() => void retryNotification(appointment)}
                    >
                      <Mail size={14} className="mr-1 shrink-0" />
                      <span className="truncate">Enviar correo</span>
                    </Button>
                  </div>
                )}
              </div>
            )}
          </article>;
        })}</div>
      </section>
    </div>

    {showScrollTop && <Button type="button" variant="outline" size="icon" className="admin-mobile-scroll-top" aria-label="Volver arriba" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><ArrowUp size={17} /></Button>}

    <Dialog open={Boolean(cancelTarget)} onOpenChange={open => { if (!open) setCancelTarget(null); }}>
      <DialogContent className="admin-mobile-dialog"><DialogTitle>¿Cancelar este turno?</DialogTitle><DialogDescription>El turno quedará cancelado y seguirá disponible en el historial. Esta acción respeta la operación existente del sistema.</DialogDescription><DialogFooter><Button variant="outline" onClick={() => setCancelTarget(null)}>Volver</Button><Button className="action-brand" disabled={!cancelTarget || busyId === cancelTarget.id} onClick={() => cancelTarget && void changeStatus(cancelTarget, 'CANCELLED')}>Cancelar turno</Button></DialogFooter></DialogContent>
    </Dialog>

    {/* Diálogo para agregar turno manual */}
    <Dialog open={manualOpen} onOpenChange={open => { if (!open) handleCancel(); }}>
      <DialogContent
        className={cn(
          "admin-manual-dialog",
          "fixed inset-0 top-0 left-0 right-0 bottom-0 z-50",
          "w-full h-[100dvh] max-w-none max-h-[100dvh]",
          "translate-x-0 translate-y-0",
          "rounded-none border-0 p-0 m-0",
          "bg-background text-foreground",
          "flex flex-col overflow-hidden",
          "sm:left-[50%] sm:top-[50%] sm:right-auto sm:bottom-auto",
          "sm:translate-x-[-50%] sm:translate-y-[-50%]",
          "sm:w-full sm:max-w-4xl sm:h-auto sm:max-h-[90vh]",
          "sm:rounded-xl sm:border sm:border-border sm:p-6 sm:shadow-2xl"
        )}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const savedY = scrollPosRef.current;
          window.scrollTo({ top: savedY, behavior: 'instant' });
        }}
      >
        <form onSubmit={handleCreateManualAppointment} className="flex flex-col h-full sm:h-auto overflow-hidden">
          {/* Encabezado: fijo en mobile, inmediatamente debajo del header */}
          <div className="shrink-0 px-4 sm:px-0 pt-3.5 sm:pt-0 pb-3 sm:pb-4 border-b border-border/60 sm:border-b-0">
            <DialogHeader className="space-y-0 text-left">
              <DialogTitle className="text-base sm:text-xl font-semibold text-foreground tracking-tight">
                Agregar turno manual
              </DialogTitle>
              <DialogDescription className="sr-only">
                Creación de turno manual
              </DialogDescription>
            </DialogHeader>
          </div>

          {/* Cuerpo con scroll interno */}
          <div className="manual-dialog-body flex-1 overflow-y-auto overscroll-contain px-4 sm:px-0 py-3.5 sm:py-4 space-y-3.5 sm:space-y-4">
            {manualError && (
              <div role="alert" className="admin-mobile-notice is-error">
                <XCircle size={16} />
                {manualError}
              </div>
            )}

            <div className="manual-appointment-grid grid grid-cols-2 sm:grid-cols-6 gap-3 sm:gap-4">
              {/* Fila 1 Columna izquierda en mobile | Col 1-2 en desktop */}
              <div className="manual-grid-field manual-field-fecha col-span-1 sm:col-span-2 sm:order-1 min-w-0">
                <label htmlFor="manual-date" className="font-medium text-foreground block mb-1.5 text-xs sm:text-sm">
                  Fecha
                </label>
                <Input
                  id="manual-date"
                  type="date"
                  value={manualDate}
                  onChange={e => setManualDate(e.target.value)}
                  required
                  className="bg-background h-10 text-xs sm:text-sm"
                />
              </div>

              {/* Fila 1 Columna derecha en mobile | Col 3-4 en desktop */}
              <div className="manual-grid-field manual-field-horario col-span-1 sm:col-span-2 sm:order-2 min-w-0">
                <label htmlFor="manual-time" className="font-medium text-foreground block mb-1.5 text-xs sm:text-sm">
                  Horario
                </label>
                <Input
                  id="manual-time"
                  type="time"
                  value={manualTime}
                  onChange={e => setManualTime(e.target.value)}
                  required
                  className="bg-background h-10 text-xs sm:text-sm"
                />
              </div>

              {/* Fila 2 Columna izquierda en mobile | Col 5-6 en desktop */}
              <div className="manual-grid-field manual-field-servicio col-span-1 sm:col-span-2 sm:order-3 min-w-0">
                <label htmlFor="manual-service" className="font-medium text-foreground block mb-1.5 text-xs sm:text-sm">
                  Servicio
                </label>
                <select
                  id="manual-service"
                  value={manualServiceId}
                  onChange={e => setManualServiceId(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-2.5 sm:px-3 py-2 text-xs sm:text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring truncate"
                >
                  {servicesList.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Fila 2 Columna derecha en mobile | Col 1-2 en desktop Fila 3 */}
              <div className="manual-grid-field manual-field-barbero col-span-1 sm:col-span-2 sm:order-7 min-w-0">
                <label htmlFor="manual-barber" className="font-medium text-foreground block mb-1.5 text-xs sm:text-sm">
                  Barbero
                </label>
                {profile.role === 'ADMIN' ? (
                  <select
                    id="manual-barber"
                    value={manualBarberId}
                    onChange={e => setManualBarberId(e.target.value)}
                    className="w-full h-10 rounded-md border border-input bg-background px-2.5 sm:px-3 py-2 text-xs sm:text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring truncate"
                  >
                    {permittedRows.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                ) : (
                  <output id="manual-barber" className="flex items-center h-10 px-3 rounded-md border border-input bg-muted/40 font-medium text-xs sm:text-sm truncate">
                    {permittedRows[0]?.name ?? 'Tu agenda'}
                  </output>
                )}
              </div>

              {/* Fila 3 ancho completo en mobile | Col 1-2 en desktop Fila 2 */}
              <div className="manual-grid-field manual-field-frecuencia col-span-2 sm:col-span-2 sm:order-4 min-w-0">
                <label htmlFor="manual-frequency" className="font-medium text-foreground block mb-1.5 text-xs sm:text-sm">
                  Frecuencia
                </label>
                <select
                  id="manual-frequency"
                  value={manualFrequency}
                  onChange={e => setManualFrequency(e.target.value as ManualFrequency)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-xs sm:text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="ONCE">Única vez</option>
                  <option value="WEEKLY">Una vez a la semana</option>
                  <option value="BIWEEKLY">Una vez cada dos semanas</option>
                  <option value="TRIWEEKLY">Una vez cada tres semanas</option>
                  <option value="MONTHLY">Una vez al mes</option>
                </select>
              </div>

              {/* Fila 4 ancho completo en mobile | Col 3-4 en desktop Fila 2 */}
              <div className="manual-grid-field manual-field-nombre col-span-2 sm:col-span-2 sm:order-5 min-w-0">
                <label htmlFor="manual-client-name" className="font-medium text-foreground block mb-1.5 text-xs sm:text-sm">
                  Nombre del cliente
                </label>
                <Input
                  id="manual-client-name"
                  type="text"
                  placeholder="Ej. Juan Pérez"
                  value={manualClientName}
                  onChange={e => setManualClientName(e.target.value)}
                  required
                  className="bg-background h-10 text-xs sm:text-sm"
                />
              </div>

              {/* Fila 5 ancho completo en mobile | Col 5-6 en desktop Fila 2 */}
              <div className="manual-grid-field manual-field-celular col-span-2 sm:col-span-2 sm:order-6 min-w-0">
                <label htmlFor="manual-client-phone" className="font-medium text-foreground block mb-1.5 text-xs sm:text-sm">
                  Celular del cliente
                </label>
                <PhoneInput
                  id="manual-client-phone"
                  value={manualClientPhone}
                  onChange={setManualClientPhone}
                  country={phoneCountry}
                  onCountryChange={setPhoneCountry}
                  required
                  size="sm"
                />
              </div>

              {/* Fila 6 ancho completo en mobile | Col 3-4 en desktop Fila 3 */}
              <div className="manual-grid-field manual-field-email col-span-2 sm:col-span-2 sm:order-8 min-w-0">
                <label htmlFor="manual-client-email" className="font-medium text-foreground block mb-1.5 text-xs sm:text-sm">
                  Mail del cliente <span className="text-destructive font-normal" aria-hidden="true">*</span> <span className="text-[11px] text-muted-foreground font-normal">(obligatorio)</span>
                </label>
                <Input
                  id="manual-client-email"
                  type="email"
                  required
                  placeholder="cliente@ejemplo.com"
                  value={manualClientEmail}
                  onChange={e => {
                    const val = e.target.value;
                    setManualClientEmail(val);
                    if (manualEmailTouched) {
                      setManualEmailError(validateManualEmail(val));
                    }
                  }}
                  onBlur={() => {
                    setManualEmailTouched(true);
                    setManualEmailError(validateManualEmail(manualClientEmail));
                  }}
                  aria-invalid={manualEmailTouched && Boolean(manualEmailError)}
                  aria-describedby={manualEmailTouched && manualEmailError ? 'manual-email-error' : undefined}
                  className={cn(
                    "bg-background h-10 text-xs sm:text-sm",
                    manualEmailTouched && manualEmailError && "border-destructive focus-visible:ring-destructive"
                  )}
                />
                {manualEmailTouched && manualEmailError && (
                  <span id="manual-email-error" className="field-validation-message text-xs text-destructive mt-1 block font-normal" role="alert">
                    {manualEmailError}
                  </span>
                )}
              </div>

              {/* Fila 7 ancho completo en mobile | Col 5-6 en desktop Fila 3 */}
              <div className="manual-grid-field manual-field-sena col-span-2 sm:col-span-2 sm:order-9 min-w-0">
                <label htmlFor="manual-deposit" className="font-medium text-foreground block mb-1.5 text-xs sm:text-sm">
                  Abona seña
                </label>
                <select
                  id="manual-deposit"
                  value={manualDepositRequired ? 'YES' : 'NO'}
                  onChange={e => setManualDepositRequired(e.target.value === 'YES')}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-xs sm:text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="NO">No</option>
                  <option value="YES">Sí</option>
                </select>
              </div>

              {/* Fila 8 ancho completo en mobile | Fila 4 ancho completo en desktop */}
              <div className="manual-grid-field manual-field-observaciones col-span-2 sm:col-span-6 sm:order-10 min-w-0">
                <label htmlFor="manual-notes" className="font-medium text-foreground block mb-1.5 text-xs sm:text-sm">
                  Observaciones <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
                </label>
                <Textarea
                  id="manual-notes"
                  placeholder="Detalles sobre el turno o preferencias del cliente..."
                  value={manualNotes}
                  onChange={e => setManualNotes(e.target.value)}
                  rows={2}
                  className="bg-background text-xs sm:text-sm resize-none"
                />
              </div>
            </div>
          </div>

          {/* Acciones del formulario: accesibles y fijas en mobile */}
          <div className="manual-dialog-footer shrink-0 px-4 sm:px-0 pt-3 sm:pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-0 border-t border-border/60 sm:border-t-0 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 bg-background">
            <Button
              type="button"
              variant="outline"
              disabled={manualSaving}
              onClick={handleCancel}
              className="w-full sm:w-auto h-10 text-xs sm:text-sm"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="action-brand w-full sm:w-auto h-10 text-xs sm:text-sm"
              disabled={manualSaving}
            >
              {manualSaving ? 'Guardando…' : 'Guardar turno'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </main>;
}
