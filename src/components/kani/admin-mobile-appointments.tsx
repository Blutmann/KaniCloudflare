import { useEffect, useMemo, useState } from 'react';
import { ArrowUp, CalendarPlus, Check, CircleDot, Clock3, RefreshCw, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { dateLabel, money, serviceFor } from '@/lib/kani-model';
import { formatPhoneDisplay } from '@/lib/kani-phone';
import { useAdminStaff } from '@/lib/kani-admin-context';
import { appointmentErrorMessage, createManualAppointment, readRealAppointments, retryRealAppointmentNotification, updateRealAppointmentStatus, type RealAppointment, type RealAppointmentStatus } from '@/lib/kani-appointments';
import { addCalendarDays, businessDateToday, dateRangeForMobilePreset, filterMobileAppointments, mobileDatePresetLabels, type MobileDatePreset, type MobileStatusFilter } from '@/lib/kani-mobile-appointments';
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

const datePresets: MobileDatePreset[] = ['TODAY', 'TOMORROW', 'NEXT_10_DAYS', 'THIS_WEEK', 'SPECIFIC'];

function statusTone(value: StatusFilter) {
  return value === 'ALL' ? 'all' : statusMeta[value].tone;
}

export function AdminMobileAppointments() {
  const { profile, barbers: permittedRows, refreshCount, setIsRefreshing } = useAdminStaff();
  const permittedBarbers = useMemo(() => permittedBarberNames(profile, permittedRows), [profile, permittedRows]);
  const [appointments, setAppointments] = useState<RealAppointment[]>([]);
  const [servicesList, setServicesList] = useState<Array<{ id: string; name: string; duration_minutes: number; price_ars: number }>>([]);
  const [businessToday, setBusinessToday] = useState(() => businessDateToday());
  const [datePreset, setDatePreset] = useState<MobileDatePreset>('TODAY');
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
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState('');
  const [manualDate, setManualDate] = useState(() => businessDateToday());
  const [manualTime, setManualTime] = useState('10:00');
  const [manualClientName, setManualClientName] = useState('');
  const [manualClientPhone, setManualClientPhone] = useState('');
  const [manualClientEmail, setManualClientEmail] = useState('');
  const [manualServiceId, setManualServiceId] = useState('');
  const [manualBarberId, setManualBarberId] = useState('');
  const [manualMode, setManualMode] = useState<'ONCE' | 'RECURRING'>('ONCE');
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
  const dateRange = useMemo(() => dateRangeForMobilePreset(datePreset, businessToday, specificDate), [businessToday, datePreset, specificDate]);
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
    : datePreset === 'ALL' ? 'en todos los días' : mobileDatePresetLabels[datePreset].toLowerCase();
  const appointmentCountLabel = `${filteredAppointments.length} ${filteredAppointments.length === 1 ? 'turno' : 'turnos'} ${countContext}`;

  function selectDatePreset(next: MobileDatePreset) {
    if (next === 'TODAY') setSpecificDate(businessToday);
    else if (next === 'TOMORROW') setSpecificDate(addCalendarDays(businessToday, 1));
    else if (next === 'SPECIFIC') setSpecificDate(current => current || businessToday);
    else setSpecificDate(businessToday);
    setDatePreset(next);
  }

  function selectSpecificDate(next: string) {
    const safeDate = next && next >= businessToday ? next : businessToday;
    setSpecificDate(safeDate);
    setDatePreset('SPECIFIC');
  }

  function openManualAppointmentDialog() {
    setManualError('');
    setManualDate(specificDate || businessToday);
    setManualTime('10:00');
    setManualClientName('');
    setManualClientPhone('');
    setManualClientEmail('');
    setManualNotes('');
    setManualMode('ONCE');
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
    if (manualClientPhone.trim().length < 6) {
      setManualError('El celular del cliente debe tener al menos 6 caracteres.');
      return;
    }

    setManualSaving(true);
    try {
      await createManualAppointment({
        barberId: manualBarberId,
        serviceId: manualServiceId,
        date: manualDate,
        time: manualTime,
        name: manualClientName,
        phone: manualClientPhone,
        email: manualClientEmail,
        notes: manualNotes,
        isRecurring: manualMode === 'RECURRING',
      });

      setNotice(
        manualMode === 'RECURRING'
          ? `Turno permanente registrado para ${manualClientName.trim()} y proyectado a las próximas 4 semanas.`
          : `Turno manual confirmado para ${manualClientName.trim()}.`
      );
      setManualOpen(false);
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
    return <span className={`admin-mobile-status ${meta.tone}`}><Icon size={14} />{meta.label}</span>;
  }

  return <main className="site-container admin-mobile-page">
    <div className="admin-mobile-shell">
      <section className="admin-mobile-summary" aria-label="Resumen de turnos">
        {summaryFilters.map(filter => <button key={filter.value} type="button" className={`admin-mobile-summary-card ${statusTone(filter.value)} ${statusFilter === filter.value ? 'is-active' : ''}`} aria-pressed={statusFilter === filter.value} onClick={() => setStatusFilter(filter.value)}><span>{filter.label}</span><strong>{counts[filter.value]}</strong></button>)}
      </section>

      <section className="admin-mobile-filters" aria-label="Filtros de agenda">
        <div className="admin-mobile-filter-field admin-mobile-filter-period">
          <label htmlFor="mobile-date-preset">Período y fecha</label>
          <div className="admin-mobile-period-control">
            <select id="mobile-date-preset" value={datePreset} onChange={event => selectDatePreset(event.target.value as MobileDatePreset)} aria-label="Filtrar por período">
              {datePresets.map(preset => <option key={preset} value={preset}>{mobileDatePresetLabels[preset]}</option>)}
            </select>
            <input id="mobile-date-filter" type="date" min={businessToday} value={specificDate} onChange={event => selectSpecificDate(event.target.value)} aria-label="Elegir fecha específica" />
          </div>
        </div>
        <div className="admin-mobile-filter-field"><label htmlFor="mobile-status-filter">Estado</label><select id="mobile-status-filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)}>{statusFilters.map(filter => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select></div>
        <div className="admin-mobile-filter-field"><label htmlFor="mobile-barber-filter">Barbero</label>{profile.role === 'ADMIN' ? <select id="mobile-barber-filter" value={barberFilter} onChange={event => setBarberFilter(event.target.value)}><option value="Todos">Todos</option>{permittedBarbers.map(barber => <option key={barber} value={barber}>{barber}</option>)}</select> : <output id="mobile-barber-filter" className="admin-mobile-filter-readonly">{permittedBarbers[0] ?? 'Tu agenda'}</output>}</div>
      </section>

      {notice && <div role="status" className="admin-mobile-notice"><Check size={16} />{notice}<Button variant="ghost" size="icon" aria-label="Cerrar aviso" onClick={() => setNotice('')}><X /></Button></div>}
      {error && <div role="alert" className="admin-mobile-notice is-error"><XCircle size={16} />{error}</div>}

      <section className="admin-mobile-agenda" aria-labelledby="mobile-agenda-title">
        <div className="admin-mobile-section-heading flex items-center justify-between gap-3">
          <div>
            <h2 id="mobile-agenda-title">{appointmentCountLabel}</h2>
            <span className="text-sm text-muted-foreground">{statusFilter === 'ALL' ? 'Todos los estados' : statusMeta[statusFilter].label}</span>
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

        {loading && <div className="admin-mobile-empty"><Clock3 size={28} /><p>Cargando turnos…</p></div>}
        {!loading && filteredAppointments.length === 0 && <div className="admin-mobile-empty"><Clock3 size={28} /><h3>No hay turnos para estos filtros.</h3><p>Probá con otro período, fecha o estado. Los turnos cancelados permanecen en el historial.</p></div>}
        <div className="admin-mobile-list">{filteredAppointments.map(appointment => {
          const fallbackService = serviceFor(appointment.service);
          const serviceName = appointment.serviceName ?? fallbackService.name;
          const serviceDuration = appointment.serviceDuration ?? fallbackService.duration;
          const phoneHref = appointment.phone.replace(/[^\d+]/g, '');
          const phoneLabel = formatPhoneDisplay(appointment.phone);
          const isManual = Boolean(appointment.isManual || appointment.origin === 'MANUAL');

          return <article className="admin-mobile-appointment" key={appointment.id}>
            <div className="admin-mobile-appointment-top">
              <div className="admin-mobile-time">
                <strong>{appointment.time}</strong>
                <span>hasta {appointment.endTime?.slice(0, 5) ?? '—'} · {dateLabel(appointment.date)}</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                {renderStatus(appointment.statusCode)}
                {isManual && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gold/15 text-gold border border-gold/30">
                    {appointment.recurringRuleId ? 'Turno permanente' : 'Turno manual'}
                  </span>
                )}
              </div>
            </div>

            <div className="admin-mobile-appointment-main">
              <h3>{appointment.name}</h3>
              <div className="admin-mobile-appointment-details">
                <div><span>Servicio</span><strong>{serviceName} · {serviceDuration} min</strong></div>
                <div><span>Barbero</span><strong>{appointment.barber}</strong></div>
                <div><span>Celular</span><a href={`tel:${phoneHref}`}>{phoneLabel}</a></div>
                <div><span>Email</span><a href={`mailto:${appointment.email}`}>{appointment.email}</a></div>
                {appointment.servicePrice !== undefined && <div><span>Importe total</span><strong>{money(appointment.servicePrice)}</strong></div>}
                {isManual && (
                  <div>
                    <span>Origen</span>
                    <strong className="text-gold font-medium">
                      Manual {appointment.createdByDisplayName ? `· Generado por: ${appointment.createdByDisplayName}` : ''}
                    </strong>
                  </div>
                )}
                {appointment.notes?.trim() && <div className="admin-mobile-detail-notes"><span>Observaciones</span><p>{appointment.notes.trim()}</p></div>}
              </div>
            </div>
            {(appointment.statusCode === 'PENDING' || appointment.statusCode === 'CONFIRMED' || appointment.statusCode === 'CANCELLED') && <div className="admin-mobile-card-actions">{appointment.statusCode === 'PENDING' && <><Button className="action-positive" disabled={busyId === appointment.id} onClick={() => void changeStatus(appointment, 'CONFIRMED')}><Check size={16} />Confirmar</Button><Button variant="outline" className="action-brand-outline" disabled={busyId === appointment.id} onClick={() => setCancelTarget(appointment)}><X size={16} />Rechazar</Button></>}{appointment.statusCode === 'CONFIRMED' && <Button variant="outline" className="action-brand-outline" disabled={busyId === appointment.id} onClick={() => setCancelTarget(appointment)}><X size={16} />Cancelar turno</Button>}<Button variant="outline" disabled={busyId === appointment.id} onClick={() => void retryNotification(appointment)}><RefreshCw size={16} />Reenviar notificación</Button></div>}
          </article>;
        })}</div>
      </section>
    </div>

    {showScrollTop && <Button type="button" variant="outline" size="icon" className="admin-mobile-scroll-top" aria-label="Volver arriba" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><ArrowUp size={17} /></Button>}

    <Dialog open={Boolean(cancelTarget)} onOpenChange={open => { if (!open) setCancelTarget(null); }}>
      <DialogContent className="admin-mobile-dialog"><DialogTitle>¿Cancelar este turno?</DialogTitle><DialogDescription>El turno quedará cancelado y seguirá disponible en el historial. Esta acción respeta la operación existente del sistema.</DialogDescription><DialogFooter><Button variant="outline" onClick={() => setCancelTarget(null)}>Volver</Button><Button className="action-brand" disabled={!cancelTarget || busyId === cancelTarget.id} onClick={() => cancelTarget && void changeStatus(cancelTarget, 'CANCELLED')}>Cancelar turno</Button></DialogFooter></DialogContent>
    </Dialog>

    {/* Diálogo para agregar turno manual */}
    <Dialog open={manualOpen} onOpenChange={open => { if (!open) setManualOpen(false); }}>
      <DialogContent className="admin-mobile-dialog max-w-lg">
        <form onSubmit={handleCreateManualAppointment}>
          <DialogHeader>
            <DialogTitle>Agregar turno manual</DialogTitle>
            <DialogDescription>
              Agendá un turno manual por única vez o recurrente semanalmente, sin requerir seña ni pasarela de pago.
            </DialogDescription>
          </DialogHeader>

          {manualError && (
            <div role="alert" className="admin-mobile-notice is-error my-3">
              <XCircle size={16} />
              {manualError}
            </div>
          )}

          <div className="grid gap-3.5 py-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="manual-date" className="font-medium text-foreground block mb-1">Fecha</label>
                <Input
                  id="manual-date"
                  type="date"
                  value={manualDate}
                  onChange={e => setManualDate(e.target.value)}
                  required
                  className="bg-background"
                />
              </div>
              <div>
                <label htmlFor="manual-time" className="font-medium text-foreground block mb-1">Horario de inicio</label>
                <Input
                  id="manual-time"
                  type="time"
                  value={manualTime}
                  onChange={e => setManualTime(e.target.value)}
                  required
                  className="bg-background"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="manual-service" className="font-medium text-foreground block mb-1">Servicio y duración</label>
                <select
                  id="manual-service"
                  value={manualServiceId}
                  onChange={e => setManualServiceId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {servicesList.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.duration_minutes} min) — {money(s.price_ars)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="manual-barber" className="font-medium text-foreground block mb-1">Barbero asignado</label>
                {profile.role === 'ADMIN' ? (
                  <select
                    id="manual-barber"
                    value={manualBarberId}
                    onChange={e => setManualBarberId(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {permittedRows.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                ) : (
                  <output id="manual-barber" className="flex items-center h-9 px-3 rounded-md border border-input bg-muted/40 font-medium">
                    {permittedRows[0]?.name ?? 'Tu agenda'}
                  </output>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="manual-client-name" className="font-medium text-foreground block mb-1">Nombre del cliente</label>
                <Input
                  id="manual-client-name"
                  type="text"
                  placeholder="Ej. Juan Pérez"
                  value={manualClientName}
                  onChange={e => setManualClientName(e.target.value)}
                  required
                  className="bg-background"
                />
              </div>
              <div>
                <label htmlFor="manual-client-phone" className="font-medium text-foreground block mb-1">Celular del cliente</label>
                <Input
                  id="manual-client-phone"
                  type="tel"
                  placeholder="Ej. 11 1234 5678"
                  value={manualClientPhone}
                  onChange={e => setManualClientPhone(e.target.value)}
                  required
                  className="bg-background"
                />
              </div>
            </div>

            <div>
              <label htmlFor="manual-client-email" className="font-medium text-foreground block mb-1">Email del cliente (opcional)</label>
              <Input
                id="manual-client-email"
                type="email"
                placeholder="cliente@ejemplo.com"
                value={manualClientEmail}
                onChange={e => setManualClientEmail(e.target.value)}
                className="bg-background"
              />
            </div>

            <div>
              <label className="font-medium text-foreground block mb-1.5">Modalidad de turno</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    manualMode === 'ONCE'
                      ? 'border-gold bg-gold/10 text-foreground font-semibold shadow-xs'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted/40'
                  }`}
                  onClick={() => setManualMode('ONCE')}
                >
                  <div className="text-xs">Guardar turno por única vez</div>
                  <div className="text-[10px] font-normal text-muted-foreground mt-0.5">
                    Se agenda únicamente en la fecha y hora seleccionada.
                  </div>
                </button>

                <button
                  type="button"
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    manualMode === 'RECURRING'
                      ? 'border-gold bg-gold/10 text-foreground font-semibold shadow-xs'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted/40'
                  }`}
                  onClick={() => setManualMode('RECURRING')}
                >
                  <div className="text-xs">Guardar turno permanente</div>
                  <div className="text-[10px] font-normal text-muted-foreground mt-0.5">
                    Recurrencia semanal (mismo día y hora durante 4 semanas).
                  </div>
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="manual-notes" className="font-medium text-foreground block mb-1">Observaciones (opcional)</label>
              <Textarea
                id="manual-notes"
                placeholder="Detalles sobre el turno o preferencias del cliente..."
                value={manualNotes}
                onChange={e => setManualNotes(e.target.value)}
                rows={2}
                className="bg-background text-xs resize-none"
              />
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              disabled={manualSaving}
              onClick={() => setManualOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="action-brand"
              disabled={manualSaving}
            >
              {manualSaving ? 'Guardando…' : manualMode === 'RECURRING' ? 'Crear turno permanente' : 'Guardar turno manual'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </main>;
}
