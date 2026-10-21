import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, Clock3, CalendarDays, UserRound, ChevronLeft, ChevronRight, ArrowLeft, CircleAlert, MapPin, Instagram } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { services, barbers, serviceFor, money, bookingEndDateFor, parseDate, isoDate, dateLabel, isBookingDate, type ServiceId, type Barber, type Appointment } from '@/lib/kani-model';
import { availabilityStartTimesForServiceDate, eligibleBarbersForAvailabilityStart, readConfiguredServices, readPublicAvailabilityStarts, type ConfiguredService, type PublicAvailabilityStart } from '@/lib/kani-availability';
import { businessDateToday } from '@/lib/kani-mobile-appointments';
import { appointmentErrorMessage, createRealAppointment } from '@/lib/kani-appointments';
import { getDynamicDownPayment } from '@/lib/kani-mercadopago';
import { createBookingOrderFn } from '@/lib/kani-mercadopago.functions';
import { normalizePhone, type PhoneCountry } from '@/lib/kani-phone';
const PhoneInput = lazy(() => import('@/components/kani/phone-input').then(m => ({ default: m.PhoneInput })));
import { MobileMenuAction } from '@/components/kani/site-header';
import { useKani } from '@/components/kani/store';
const steps = ['Servicio', 'Barbero', 'Fecha', 'Horario', 'Datos', 'Resumen'];
const serviceIconById: Record<ServiceId, { light: string; dark: string }> = {
  corte: { light: '/service-corte-light.png', dark: '/service-corte-dark-strokes.png' },
  'corte-barba': { light: '/service-corte-barba-light.png', dark: '/service-corte-barba-dark-strokes.png' },
  barba: { light: '/service-barba-light.png', dark: '/service-barba-dark-strokes.png' },
};
type ContactField = 'name' | 'phone' | 'email' | 'notes';
type ContactValues = { name: string; email: string; phone: string; notes: string };
type FieldStatus = 'idle' | 'valid' | 'invalid';

function fieldStatus(field: ContactField, values: ContactValues, country: PhoneCountry, touched: boolean): FieldStatus {
  if (!touched) return 'idle';
  if (field === 'notes') return values.notes.trim() ? 'valid' : 'idle';
  if (field === 'name') return values.name.trim().length >= 3 ? 'valid' : 'invalid';
  if (field === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()) ? 'valid' : 'invalid';
  return normalizePhone(values.phone, country) ? 'valid' : 'invalid';
}

function fieldMessage(field: ContactField) {
  if (field === 'name') return 'Escribí tu nombre y apellido (mínimo 3 caracteres).';
  if (field === 'phone') return 'Ingresá un celular válido para el país seleccionado.';
  if (field === 'email') return 'Ingresá un email válido, por ejemplo nombre@email.com.';
  return '';
}
export function Booking() {
  const { mobileMenuOpen, setMobileMenuOpen } = useKani();
  const [step, setStep] = useState(0);
  const [service, setService] = useState<ServiceId | null>(null);
  const [barber, setBarber] = useState<Barber | null>(null);
  const [barberDeferred, setBarberDeferred] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [businessToday, setBusinessToday] = useState(() => businessDateToday());
  const [month, setMonth] = useState(() => parseDate(businessDateToday()));
  const [contact, setContact] = useState({ name: '', email: '', phone: '', notes: '' });
  const [touched, setTouched] = useState<Record<ContactField, boolean>>({ name: false, phone: false, email: false, notes: false });
  const [phoneCountry, setPhoneCountry] = useState<PhoneCountry>('AR');
  const [pendingAppointment, setPendingAppointment] = useState<{ id: string; requestNumber: number; expiresAt: number } | null>(null);
  const [returnStatus, setReturnStatus] = useState<'IDLE' | 'LOADING' | 'CONFIRMED' | 'PENDING' | 'CANCELLED'>('IDLE');
  const [returnedAppointment, setReturnedAppointment] = useState<{
    appointment_id: string;
    appointment_status: string;
    booking_date: string;
    start_time: string;
    end_time: string;
    barber_name: string;
    service_name: string;
    service_price_ars: number;
    down_payment_ars: number;
    client_name: string;
    client_email: string;
    client_phone: string;
  } | null>(null);
  const [result, setResult] = useState<Appointment | null>(null);
  const [paymentInitPoint, setPaymentInitPoint] = useState<string | null>(null);
  const [creatingPaymentOrder, setCreatingPaymentOrder] = useState(false);
  const [paymentOrderError, setPaymentOrderError] = useState<string | null>(null);
  const [dynamicDownPayment, setDynamicDownPayment] = useState(5000);
  const [error, setError] = useState('');
  const [publicSlots, setPublicSlots] = useState<PublicAvailabilityStart[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [configuredServices, setConfiguredServices] = useState<ConfiguredService[]>(() => services.map(service => ({ ...service })));
  const [submitting, setSubmitting] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    if (step >= 2) void import('@/components/kani/phone-input');
  }, [step]);
  const formRef = useRef<HTMLFormElement>(null);
  // Recuperación automática de posición y visualización del header al cerrar el teclado en mobile
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleFocusOut = () => {
      // Pequeño retardo para verificar si el foco pasó a otro campo del mismo formulario
      window.setTimeout(() => {
        const active = document.activeElement;
        const isFormField = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
        if (!isFormField && window.scrollY > 0) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 100);
    };

    let prevHeight = window.visualViewport?.height ?? window.innerHeight;
    const handleViewportResize = () => {
      const currentHeight = window.visualViewport?.height ?? window.innerHeight;
      // Cuando el viewport se expande tras cerrarse el teclado virtual (mínimo 60px de diferencia)
      if (currentHeight > prevHeight + 60) {
        if (window.scrollY > 0) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
      prevHeight = currentHeight;
    };

    const form = formRef.current;
    if (form) {
      form.addEventListener('focusout', handleFocusOut);
    }
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportResize);
    } else {
      window.addEventListener('resize', handleViewportResize);
    }

    return () => {
      if (form) {
        form.removeEventListener('focusout', handleFocusOut);
      }
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportResize);
      } else {
        window.removeEventListener('resize', handleViewportResize);
      }
    };
  }, [step]);
  const ctaRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [progressStart, setProgressStart] = useState(0);
  const [progressWidth, setProgressWidth] = useState(0);
  useLayoutEffect(() => {
    const cta = ctaRef.current;
    if (!cta) return;
    const updateHeight = () => document.documentElement.style.setProperty('--booking-cta-height', `${cta.getBoundingClientRect().height}px`);
    updateHeight();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateHeight) : null;
    observer?.observe(cta);
    window.addEventListener('resize', updateHeight);
    return () => { observer?.disconnect(); window.removeEventListener('resize', updateHeight); document.documentElement.style.removeProperty('--booking-cta-height'); };
  }, [mobileMenuOpen, step]);
  useLayoutEffect(() => {
    const progress = progressRef.current;
    if (!progress) return;
    const updateProgress = () => {
      const buttons = Array.from(progress.querySelectorAll<HTMLButtonElement>(':scope > button'));
      const active = buttons[step];
      if (!active) return;
      const progressRect = progress.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      const next = buttons[step + 1];
      const start = 0;
      const endpoint = next
        ? (activeRect.right + next.getBoundingClientRect().left) / 2 - progressRect.left
        : progressRect.width;
      setProgressStart(Math.max(0, Math.min(progressRect.width, start)));
      setProgressWidth(Math.max(0, Math.min(progressRect.width - start, endpoint - start)));
    };
    updateProgress();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateProgress) : null;
    observer?.observe(progress);
    window.addEventListener('resize', updateProgress);
    return () => { observer?.disconnect(); window.removeEventListener('resize', updateProgress); };
  }, [step]);

  useEffect(() => {
    let cancelled = false;
    void readConfiguredServices().then(next => {
      if (!cancelled && next.length) setConfiguredServices(next);
    }).catch(() => {
      // Conservamos la configuración inicial mientras la consulta remota se recupera.
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = businessDateToday();
      setBusinessToday(current => current === next ? current : next);
      setClock(new Date());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const selected = service ? configuredServices.find(item => item.id === service) ?? serviceFor(service) : null;

  useEffect(() => {
    let cancelled = false;
    void getDynamicDownPayment(barber).then(amount => {
      if (!cancelled && typeof amount === 'number' && amount > 0) {
        setDynamicDownPayment(Math.min(5000, amount));
      }
    });
    return () => { cancelled = true; };
  }, [barber]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const appointmentId = params.get('appointment_id') || params.get('external_reference');
    if (appointmentId && /^[0-9a-f-]{36}$/i.test(appointmentId)) {
      setReturnStatus('LOADING');
      import('@/integrations/supabase/client').then(({ supabase }) => {
        supabase.rpc('get_appointment_payment_details', { p_appointment_id: appointmentId }).then(({ data, error }) => {
          if (!error && data && data.length > 0) {
            const apt = data[0];
            setReturnedAppointment(apt);
            if (apt.appointment_status === 'CONFIRMED') {
              setReturnStatus('CONFIRMED');
            } else if (apt.appointment_status === 'PENDING') {
              setReturnStatus('PENDING');
            } else {
              setReturnStatus('CANCELLED');
            }
          } else {
            setReturnStatus('IDLE');
          }
        }).catch(() => setReturnStatus('IDLE'));
      });
    }
  }, []);
  const depositArs = 5000;
  const remainingPaymentArs = selected ? Math.max(0, selected.price - depositArs) : 0;
  const todayValue = businessToday;
  const bookingEndValue = bookingEndDateFor(todayValue);
  const availabilityBarber = barberDeferred ? null : barber;
  const availabilityStartsByDate = useMemo(() => {
    const grouped = new Map<string, PublicAvailabilityStart[]>();
    for (const start of publicSlots) {
      const current = grouped.get(start.slot_date);
      if (current) current.push(start);
      else grouped.set(start.slot_date, [start]);
    }
    return grouped;
  }, [publicSlots]);
  const serviceName = selected?.name ?? (service ? serviceFor(service).name : '');
  const availabilityTimesForDate = useCallback(
    (targetDate: string, targetBarber = availabilityBarber) =>
      service && targetDate
        ? availabilityStartTimesForServiceDate(availabilityStartsByDate.get(targetDate) ?? [], targetDate, serviceName, clock, targetBarber)
        : [],
    [availabilityBarber, availabilityStartsByDate, clock, service, serviceName]
  );
  const visibleSlots = useMemo(() => {
    if (!service || !date || !availabilityBarber && !barberDeferred) return [];
    return availabilityStartTimesForServiceDate(availabilityStartsByDate.get(date) ?? [], date, serviceName, clock, availabilityBarber)
      .map(time => ({ time, status: 'AVAILABLE' as const }));
  }, [availabilityBarber, availabilityStartsByDate, barberDeferred, clock, date, service, serviceName]);
  const slots = visibleSlots.filter(slot => slot.status === 'AVAILABLE').map(slot => slot.time);
  const availableDates = useMemo(() => {
    if (!service || !availabilityBarber && !barberDeferred) return [];
    return [...availabilityStartsByDate.keys()]
      .filter(slotDate => availabilityStartTimesForServiceDate(availabilityStartsByDate.get(slotDate) ?? [], slotDate, serviceName, clock, availabilityBarber).length > 0)
      .sort();
  }, [availabilityBarber, availabilityStartsByDate, barberDeferred, clock, service, serviceName]);
  const availableDatesSet = useMemo(() => new Set(availableDates), [availableDates]);
  useEffect(() => {
    let cancelled = false;
    async function loadAvailability() {
      if (!barber && !barberDeferred) {
        setPublicSlots([]);
        setAvailabilityError('');
        return;
      }
      setAvailabilityLoading(true);
      setAvailabilityError('');
      try {
        const nextSlots = await readPublicAvailabilityStarts(availabilityBarber, todayValue, bookingEndValue);
        if (!cancelled) setPublicSlots(nextSlots);
      } catch (cause) {
        if (!cancelled) {
          setPublicSlots([]);
          setAvailabilityError(cause instanceof Error ? cause.message : 'No se pudo consultar la disponibilidad.');
        }
      } finally {
        if (!cancelled) setAvailabilityLoading(false);
      }
    }
    void loadAvailability();
    return () => { cancelled = true; };
  }, [availabilityBarber, barber, barberDeferred, bookingEndValue, todayValue]);
  useEffect(() => {
    if (!service || availabilityLoading) return;
    const todayHasSlots = availableDates.includes(todayValue);
    if (!todayHasSlots && (!date || date === todayValue)) {
      const nextDate = availableDates[0];
      if (nextDate && nextDate !== date) {
        setDate(nextDate);
        setTime('');
        setMonth(parseDate(nextDate));
      }
    }
  }, [availabilityLoading, availableDates, barberDeferred, date, service, todayValue]);
  function move(next: number) { setStep(next); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  const statusFor = (field: ContactField) => fieldStatus(field, contact, phoneCountry, touched[field]);
  const markTouched = (field: ContactField) => setTouched(current => ({ ...current, [field]: true }));
  const feedbackFor = (field: ContactField) => {
    const status = statusFor(field);
    if (status === 'idle') return null;
    return <span className={`field-validation-icon ${status}`} aria-hidden="true">{status === 'valid' ? <Check size={14} /> : <CircleAlert size={14} />}</span>;
  };
  function chooseService(nextService: ServiceId) {
    setService(nextService);
    const serviceName = configuredServices.find(item => item.id === nextService)?.name ?? serviceFor(nextService).name;
    const compatibleTimes = date ? availabilityStartTimesForServiceDate(availabilityStartsByDate.get(date) ?? [], date, serviceName, clock, barberDeferred ? null : barber) : [];
    if (!date || (time && !compatibleTimes.includes(time))) setTime('');
    if (!date || compatibleTimes.length === 0) setDate('');
  }
  function chooseBarber(nextBarber: Barber) {
    setBarber(nextBarber);
    setBarberDeferred(false);
    setPublicSlots([]);
    setAvailabilityError('');
    const compatibleTimes = service && date ? availabilityStartTimesForServiceDate(availabilityStartsByDate.get(date) ?? [], date, serviceName, clock, nextBarber) : [];
    if (!date || compatibleTimes.length === 0) { setDate(''); setTime(''); return; }
    if (time && !compatibleTimes.includes(time)) setTime('');
  }
  function next() {
    if (step === 1 && !barber && !barberDeferred) { setError('Elegí un barbero o seleccioná “Elegir más adelante”.'); return; }
    if (step === 3 && (!date || !time || !barber)) { setError('Elegí una fecha, un horario y un barbero para continuar.'); return; }
    if (step === 4) {
      setTouched({ name: true, phone: true, email: true, notes: true });
      if (!formRef.current?.reportValidity()) return;
      const normalized = normalizePhone(contact.phone, phoneCountry);
      if (!normalized) { setError('Ingresá un número de teléfono válido para el país seleccionado.'); return; }
      setContact(current => ({ ...current, phone: normalized.display }));
    }
    move(step + 1);
  }
  async function submit() {
    if (!service || !barber || !date || !time || submitting) return;
    const normalizedPhone = normalizePhone(contact.phone, phoneCountry);
    if (!normalizedPhone) {
      move(4);
      setError('Ingresá un número de teléfono válido para el país seleccionado.');
      return;
    }
    if (!pendingAppointment && !slots.includes(time)) {
      move(3);
      setError('Ese horario ya no está disponible. Elegí otro para continuar.');
      return;
    }
    setSubmitting(true);
    setError('');

    try {
      let appointmentId: string;
      let requestNumber: number;

      // Reutilizar la reserva pendiente si existe y sigue vigente (10 min) para evitar duplicados
      if (pendingAppointment && Date.now() < pendingAppointment.expiresAt) {
        appointmentId = pendingAppointment.id;
        requestNumber = pendingAppointment.requestNumber;
      } else {
        const created = await createRealAppointment({
          barber,
          serviceName: selected?.name ?? serviceFor(service).name,
          date,
          time,
          name: contact.name.trim(),
          phone: normalizedPhone.e164,
          email: contact.email.trim(),
          notes: contact.notes,
        });
        appointmentId = created.appointment_id;
        requestNumber = created.request_number;
        setPendingAppointment({
          id: appointmentId,
          requestNumber,
          expiresAt: Date.now() + 10 * 60 * 1000,
        });
      }

      // Crear la orden de pago en Mercado Pago en el servidor
      const orderRes = await createBookingOrderFn({
        data: {
          appointmentId,
          serviceName: selected?.name ?? serviceFor(service).name,
          barberName: barber,
          servicePrice: selected?.price ?? serviceFor(service).price,
          clientName: contact.name.trim(),
          clientEmail: contact.email.trim(),
          clientPhone: normalizedPhone.e164,
        },
      });

      const checkoutUrl = orderRes?.checkoutUrl || orderRes?.initPoint;

      if (orderRes?.success && checkoutUrl) {
        // Redirigir directamente al checkout seguro de Mercado Pago
        if (typeof window !== 'undefined') {
          window.location.assign(checkoutUrl);
        }
        return;
      }

      // Si falla la creación de la orden:
      // Conservar el identificador y el estado pendiente para reintentar sin duplicar la reserva
      const errorMsg = orderRes?.error || 'ORDER_CREATION_FAILED';
      console.error('[Mercado Pago] No se pudo inicializar la orden:', errorMsg);
      setError(`No pudimos iniciar el pago (${errorMsg}). Tus datos no se perdieron. Podés volver a intentarlo.`);
      setSubmitting(false);
    } catch (cause) {
      const causeMsg = cause instanceof Error ? cause.message : String(cause);
      console.error('[Mercado Pago] Error durante el proceso de reserva/pago:', causeMsg);
      setError(`No pudimos iniciar el pago (${causeMsg}). Tus datos no se perdieron. Podés volver a intentarlo.`);
      setSubmitting(false);
    }
  }

  if (returnStatus === 'LOADING') return (
    <main className="site-container confirmation">
      <div className="py-20 text-center space-y-4">
        <Clock3 size={36} className="mx-auto text-gold animate-spin" />
        <h1 className="text-2xl font-bold">Verificando estado del turno…</h1>
        <p className="text-muted-foreground text-sm">Consultando la acreditación de la seña en Mercado Pago.</p>
      </div>
    </main>
  );

  if (returnStatus === 'CONFIRMED' && returnedAppointment) return (
    <main className="site-container confirmation">
      <div className="confirmation-mark"><Check size={30} /></div>
      <h1>¡Tu turno está confirmado!</h1>
      <p className="confirmation-lead text-muted-foreground">Recibimos la seña correctamente a través de Mercado Pago.</p>
      <div className="confirmation-details">
        <dl className="summary-list">
          <div><dt>Servicio</dt><dd>{returnedAppointment.service_name}</dd></div>
          <div><dt>Barbero</dt><dd>{returnedAppointment.barber_name}</dd></div>
          <div><dt>Cuándo</dt><dd className="capitalize">{dateLabel(returnedAppointment.booking_date)} · {returnedAppointment.start_time.slice(0, 5)}</dd></div>
          <div><dt>A nombre de</dt><dd>{returnedAppointment.client_name}</dd></div>
          <div><dt>Seña abonada</dt><dd>{money(returnedAppointment.down_payment_ars)}</dd></div>
          <div><dt>Saldo restante</dt><dd>{money(Math.max(0, returnedAppointment.service_price_ars - returnedAppointment.down_payment_ars))}</dd></div>
        </dl>
      </div>
      <section className="confirmation-place">
        <h2 className="text-sm font-medium">Kani Barber Studio</h2>
        <p className="mt-2 text-sm text-muted-foreground">San Isidro Labrador 7 · Martínez, Provincia de Buenos Aires</p>
        <div className="confirmation-actions">
          <Button asChild className="confirmation-home action-brand" aria-label="Volver a reservar">
            <a href="/reservar">Volver al inicio</a>
          </Button>
          <Button asChild variant="outline" className="confirmation-secondary">
            <a href="https://www.google.com/maps/place/KANI+BARBER+STUDIO/data=!4m2!3m1!1s0x0:0x48bcfe7b2ea7ba60" target="_blank" rel="noreferrer"><MapPin size={16} /> Ver ubicación</a>
          </Button>
          <Button asChild variant="outline" className="confirmation-secondary">
            <a href="https://www.instagram.com/kanibarberstudio/" target="_blank" rel="noreferrer"><Instagram size={16} /> Instagram</a>
          </Button>
        </div>
      </section>
    </main>
  );

  if (returnStatus === 'PENDING' && returnedAppointment) return (
    <main className="site-container confirmation">
      <div className="confirmation-mark"><Clock3 size={30} className="text-gold" /></div>
      <h1>Estamos procesando tu pago</h1>
      <p className="confirmation-lead text-muted-foreground">
        Tu turno se confirmará automáticamente en cuanto Mercado Pago notifique la acreditación de la seña.
      </p>
      <div className="confirmation-details">
        <dl className="summary-list">
          <div><dt>Servicio</dt><dd>{returnedAppointment.service_name}</dd></div>
          <div><dt>Barbero</dt><dd>{returnedAppointment.barber_name}</dd></div>
          <div><dt>Cuándo</dt><dd className="capitalize">{dateLabel(returnedAppointment.booking_date)} · {returnedAppointment.start_time.slice(0, 5)}</dd></div>
          <div><dt>A nombre de</dt><dd>{returnedAppointment.client_name}</dd></div>
          <div><dt>Seña requerida</dt><dd>{money(returnedAppointment.down_payment_ars)}</dd></div>
        </dl>
      </div>
      <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
        <Button
          className="action-brand h-11 px-6"
          onClick={() => {
            if (returnedAppointment?.appointment_id) {
              setReturnStatus('LOADING');
              import('@/integrations/supabase/client').then(({ supabase }) => {
                supabase.rpc('get_appointment_payment_details', { p_appointment_id: returnedAppointment.appointment_id }).then(({ data, error }) => {
                  if (!error && data && data.length > 0) {
                    const apt = data[0];
                    setReturnedAppointment(apt);
                    setReturnStatus(apt.appointment_status === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING');
                  } else {
                    setReturnStatus('PENDING');
                  }
                });
              });
            }
          }}
        >
          Actualizar estado
        </Button>
        <Button asChild variant="outline" className="h-11 px-6">
          <a href="/reservar">Volver al inicio</a>
        </Button>
      </div>
    </main>
  );

  if (returnStatus === 'CANCELLED') return (
    <main className="site-container confirmation">
      <div className="confirmation-mark"><CircleAlert size={30} className="text-destructive" /></div>
      <h1>El turno no fue confirmado</h1>
      <p className="confirmation-lead text-muted-foreground">
        El pago no fue acreditado o expiró el plazo de 10 minutos para abonar la seña.
      </p>
      <div className="mt-8 flex justify-center">
        <Button asChild className="action-brand h-11 px-6">
          <a href="/reservar">Reservar nuevamente</a>
        </Button>
      </div>
    </main>
  );

  if (result) return (
    <main className="site-container confirmation">
      <div className="confirmation-mark"><Check size={30} /></div>
      <h1>Solicitaste un turno</h1>
      <p className="confirmation-lead text-muted-foreground">Recibimos tu solicitud correctamente.</p>

      <div className="confirmation-deposit-section my-6 p-6 rounded-lg border border-gold/30 bg-surface text-center">
        <p className="confirmation-deposit-title text-xl font-semibold m-0">
          Aboná la seña para confirmar tu turno.
        </p>
        <p className="confirmation-deposit-copy text-sm text-muted-foreground mt-2 mb-5">
          Tenés 10 minutos para abonar la seña de {money(depositArs)} y confirmar tu reserva de forma automática.
        </p>

        {creatingPaymentOrder ? (
          <p className="text-sm text-muted-foreground animate-pulse py-2">
            Preparando checkout seguro de Mercado Pago...
          </p>
        ) : paymentInitPoint ? (
          <Button asChild size="lg" className="action-positive h-12 px-8 text-base font-semibold w-full sm:w-auto">
            <a href={paymentInitPoint} rel="noopener noreferrer">
              Pagar seña
            </a>
          </Button>
        ) : (
          <div className="text-xs text-muted-foreground">
            {paymentOrderError && (
              <p className="text-destructive mb-2 font-medium">
                No pudimos inicializar el checkout de Mercado Pago automáticamente.
              </p>
            )}
            <p>
              Para confirmar la reserva, deberás abonar la seña correspondiente. Encontrarás el importe y los datos para realizar la transferencia en el email que te enviamos.
            </p>
          </div>
        )}
      </div>

      <p className="confirmation-pending-copy text-muted-foreground text-sm">
        Tu turno se confirmará automáticamente en cuanto Mercado Pago acredite la seña.
      </p>
      <div className="confirmation-details">
        <div className="confirmation-request-number">Solicitud #{result.requestNumber}</div>
        <dl className="summary-list">
          <div><dt>Servicio</dt><dd>{serviceFor(result.service).name}</dd></div>
          <div><dt>Barbero</dt><dd>{result.barber}</dd></div>
          <div><dt>Cuándo</dt><dd className="capitalize">{dateLabel(result.date)} · {result.time}</dd></div>
          <div><dt>Duración · total</dt><dd>{serviceFor(result.service).duration} min · {money(serviceFor(result.service).price)}</dd></div>
          <div><dt>A nombre de</dt><dd>{result.name}</dd></div>
          {result.notes?.trim() && <div><dt>Observaciones</dt><dd className="max-w-[65%] whitespace-pre-wrap">{result.notes.trim()}</dd></div>}
        </dl>
      </div>
      <section className="confirmation-place">
        <h2 className="text-sm font-medium">Kani Barber Studio</h2>
        <p className="mt-2 text-sm text-muted-foreground">San Isidro Labrador 7 · Martínez, Provincia de Buenos Aires</p>
        <div className="confirmation-actions">
          <Button asChild className="confirmation-home action-brand" aria-label="Volver a reservar">
            <a href="/reservar">Volver al inicio</a>
          </Button>
          <Button asChild variant="outline" className="confirmation-secondary">
            <a href="https://www.google.com/maps/place/KANI+BARBER+STUDIO/data=!4m2!3m1!1s0x0:0x48bcfe7b2ea7ba60" target="_blank" rel="noreferrer"><MapPin size={16} /> Ver ubicación</a>
          </Button>
          <Button asChild variant="outline" className="confirmation-secondary">
            <a href="https://www.instagram.com/kanibarberstudio/" target="_blank" rel="noreferrer"><Instagram size={16} /> Instagram</a>
          </Button>
        </div>
      </section>
    </main>
  );
  const titles = ['Elegí un servicio', 'Elegí un barbero', 'Elegí una fecha', 'Elegí un horario', 'Completá tus datos', 'Resumen'];
  const subtitles = ['', '', '', '', '', ''];
  const contactReady = contact.name.trim().length >= 3
    && Boolean(normalizePhone(contact.phone, phoneCountry))
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim());
  const canNext = [Boolean(service), Boolean(barber || barberDeferred), Boolean(date), Boolean(time && barber), contactReady, true][step];
  const today = parseDate(todayValue);
  const lastBookingDay = parseDate(bookingEndValue);
  const candidateBarbers = service && date && time && barberDeferred ? eligibleBarbersForAvailabilityStart(availabilityStartsByDate.get(date) ?? [], date, time, serviceName, clock) : [];
  const timeSlots = visibleSlots;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  return <main className={`site-container booking-page ${step === 5 ? 'booking-summary-page' : ''}`}><div ref={progressRef} className="booking-progress" style={{ '--progress-start': `${progressStart}px`, '--progress-width': `${progressWidth}px` } as CSSProperties} aria-label={`Paso ${step + 1} de 6: ${steps[step]}`}>{steps.map((name, i) => <Button key={name} variant="ghost" disabled={i > step} aria-current={i === step ? 'step' : undefined} onClick={() => move(i)} className={i === step ? 'current' : i < step ? 'complete' : ''}><span>{i < step ? <Check size={13} /> : String(i + 1).padStart(2, '0')}</span><small>{name}</small></Button>)}</div><div className="booking-layout"><section className="min-w-0"><div className={`booking-title-row ${step === 0 ? 'booking-service-heading' : ''} ${step === 1 ? 'booking-barber-heading' : ''} ${step === 2 ? 'booking-date-heading' : ''} ${step === 3 ? 'booking-time-heading' : ''} ${step === 4 ? 'booking-contact-heading' : ''} ${step === 5 ? 'booking-summary-heading' : ''}`}><h1 className="section-title">{titles[step]}</h1>{step === 3 && date && <span className="booking-time-heading-date"><CalendarDays size={16} />{dateLabel(date)}</span>}</div>{subtitles[step] && <p className="mb-8 mt-3 text-muted-foreground">{subtitles[step]}</p>}
    {step === 0 && <div className="booking-service-options space-y-3">{configuredServices.map(s => <Button key={s.id} variant="outline" aria-pressed={service === s.id} className={`booking-option service-option ${service === s.id ? 'selected' : ''}`} onClick={() => { if (service !== s.id) chooseService(s.id) }}><span className="option-icon"><span className="service-icon-mask service-icon-mask-light" style={{ maskImage: `url(${serviceIconById[s.id].light})`, WebkitMaskImage: `url(${serviceIconById[s.id].light})` }} aria-hidden="true" /><span className="service-icon-mask service-icon-mask-dark" style={{ maskImage: `url(${serviceIconById[s.id].dark})`, WebkitMaskImage: `url(${serviceIconById[s.id].dark})` }} aria-hidden="true" /><img className="service-icon-light" src={serviceIconById[s.id].light} alt="" aria-hidden="true" width={44} height={44} /><img className="service-icon-dark" src={serviceIconById[s.id].dark} alt="" aria-hidden="true" width={44} height={44} /></span><span className="booking-option-copy min-w-0 flex-1 text-left"><span className="booking-option-name block text-lg font-medium">{s.name}</span><span className="booking-option-meta"><span className="booking-option-duration block text-sm text-muted-foreground">{s.duration} minutos</span><span className="booking-option-price block text-base">{money(s.price)}</span></span></span><span className="selection-circle">{service === s.id && <Check size={12} />}</span></Button>)}</div>}
    {step === 1 && <div className="booking-barber-options space-y-3">{barbers.map((b, i) => <Button key={b} variant="outline" aria-pressed={barber === b && !barberDeferred} className={`booking-option ${barber === b && !barberDeferred ? 'selected' : ''}`} onClick={() => chooseBarber(b)}><span className={`barber-avatar avatar-${i}`}>{b.charAt(0)}</span><span className="booking-option-copy flex-1 text-center"><span className="booking-barber-name block text-lg">{b}</span><span className="booking-barber-handle mt-1 block text-sm text-muted-foreground">{({ Lautaro: '@lautarodejesus_', Gonzalo: '@gonzalopierucci', 'Valentín': '@valentincarrizo_' } as Record<Barber, string>)[b]}</span></span><span className="selection-circle">{barber === b && !barberDeferred && <Check size={12} />}</span></Button>)}<Button variant="outline" aria-pressed={barberDeferred} className={`booking-defer-option ${barberDeferred ? 'selected' : ''}`} onClick={() => { setBarber(null); setBarberDeferred(true); setPublicSlots([]); setAvailabilityError(''); setDate(''); setTime(''); }}><span className="barber-defer-mark">?</span><span className="booking-defer-copy booking-option-copy flex-1 text-center"><span className="block text-base font-medium">Elegir más adelante</span><span className="mt-1 block text-xs text-muted-foreground">Elegir según fecha y horario</span></span><span className="selection-circle">{barberDeferred && <Check size={12} />}</span></Button></div>}
    {step === 2 && <div className="calendar-panel"><div className="calendar-header mb-7 flex items-center justify-between"><h2 className="capitalize">{month.toLocaleDateString('es-AR', { month: 'long' }).replace(/^./, letter => letter.toUpperCase()) + ' ' + month.getFullYear()}</h2><div className="flex gap-2"><Button variant="ghost" size="icon" aria-label="Mes anterior" disabled={month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth()} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></Button><Button variant="ghost" size="icon" aria-label="Mes siguiente" disabled={month.getFullYear() === lastBookingDay.getFullYear() && month.getMonth() === lastBookingDay.getMonth()} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></Button></div></div><div className="calendar-grid">{['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => <span key={i} className="calendar-weekday">{d}</span>)}{Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} />)}{Array.from({ length: daysInMonth }, (_, i) => { const day = new Date(month.getFullYear(), month.getMonth(), i + 1); const value = isoDate(day); const disabled = availabilityLoading || !service || !availabilityBarber && !barberDeferred || !isBookingDate(value, todayValue, bookingEndValue) || !availableDatesSet.has(value); return <Button key={value} variant="ghost" className={`calendar-day ${date === value ? 'selected' : ''} ${value === todayValue ? 'today' : ''}`} disabled={disabled} aria-label={dateLabel(value)} aria-pressed={date === value} onClick={() => { if (date !== value) { setDate(value); setTime(''); if (barberDeferred) setBarber(null); } }}>{i + 1}</Button>; })}</div>{availabilityError && <p role="alert" className="mt-5 text-destructive">{availabilityError}</p>}<p className="calendar-note mt-6 flex items-center gap-2 text-xs text-muted-foreground"><span className="h-1 w-1 rounded-full bg-gold" /> Atendemos de lunes a sábado de 10 a 20 hs.</p></div>}
    {step === 3 && <div><div className="booking-time-grid grid grid-cols-3 gap-2 sm:grid-cols-4">{timeSlots.map(slot => <Button key={slot.time} variant="outline" className={`booking-time-slot h-12 ${time === slot.time ? 'selected' : ''}`} aria-pressed={time === slot.time} aria-label={slot.time} onClick={() => { setTime(slot.time); if (barberDeferred) setBarber(null); }}>{slot.time}</Button>)}</div>{barberDeferred && time && <div className="barber-choice-inline"><h2>¿Quién te va a atender?</h2><div className="barber-choice-list">{candidateBarbers.map(candidate => <Button key={candidate} variant="outline" aria-pressed={barber === candidate} className={barber === candidate ? 'selected' : ''} onClick={() => setBarber(candidate)}>{candidate}</Button>)}</div></div>}{availabilityError && <p role="alert" className="py-3 text-sm text-destructive">{availabilityError}</p>}{slots.length === 0 && !availabilityLoading && <p className="py-6 text-muted-foreground">No hay horarios disponibles. Elegí otra fecha.</p>}</div>}
    {step === 4 && <form ref={formRef} className="booking-contact-form space-y-3" onSubmit={e => { e.preventDefault(); next(); }}><label className="field-label">Nombre y apellido<span className={`field-control ${statusFor('name')}`}><Input name="name" required minLength={3} autoComplete="name" value={contact.name} onBlur={() => markTouched('name')} onChange={e => setContact({ ...contact, name: e.target.value })} placeholder="Tu nombre completo" aria-invalid={statusFor('name') === 'invalid'} aria-describedby={statusFor('name') === 'invalid' ? 'name-error' : undefined} />{feedbackFor('name')}</span>{statusFor('name') === 'invalid' && <span id="name-error" className="field-validation-message" role="alert">{fieldMessage('name')}</span>}</label><label className="field-label">Celular<Suspense fallback={<div className="h-12 w-full animate-pulse rounded-md bg-muted" />}><PhoneInput name="phone" required value={contact.phone} country={phoneCountry} onCountryChange={setPhoneCountry} onChange={val => setContact(current => ({ ...current, phone: val }))} onBlur={() => markTouched('phone')} controlClassName={statusFor('phone')} feedback={feedbackFor('phone')} aria-invalid={statusFor('phone') === 'invalid'} aria-describedby={statusFor('phone') === 'invalid' ? 'phone-error' : undefined} /></Suspense>{statusFor('phone') === 'invalid' && <span id="phone-error" className="field-validation-message" role="alert">{fieldMessage('phone')}</span>}</label><label className="field-label">Email<span className={`field-control ${statusFor('email')}`}><Input name="email" type="email" required autoComplete="email" value={contact.email} onBlur={() => markTouched('email')} onChange={e => setContact({ ...contact, email: e.target.value })} placeholder="nombre@email.com" aria-invalid={statusFor('email') === 'invalid'} aria-describedby={statusFor('email') === 'invalid' ? 'email-error' : undefined} />{feedbackFor('email')}</span>{statusFor('email') === 'invalid' && <span id="email-error" className="field-validation-message" role="alert">{fieldMessage('email')}</span>}</label><label className="field-label">Observaciones <span className="text-xs font-normal text-muted-foreground">(opcional)</span><span className={`field-control ${statusFor('notes')}`}><textarea name="notes" className="notes-input" maxLength={500} value={contact.notes} onBlur={() => markTouched('notes')} onChange={e => setContact({ ...contact, notes: e.target.value })} placeholder="Algo que quieras contarnos" aria-invalid="false" />{feedbackFor('notes')}</span></label><Button type="submit" hidden className="hidden" tabIndex={-1}>Continuar</Button></form>}
    {step === 5 && <div className="booking-summary-card"><div className="review-line summary-card-header"><div className="summary-avatar-circle"><UserRound size={20} className="text-gold" /></div><div className="summary-contact"><h2>{contact.name}</h2><p className="break-all text-muted-foreground">{contact.email}</p><p className="text-muted-foreground">{contact.phone}</p></div><Button variant="ghost" className="summary-edit-button ml-auto text-gold" onClick={() => move(4)}>Editar</Button></div><dl className="summary-list summary-details-list border-b py-5"><div><dt>Servicio</dt><dd>{selected?.name}</dd></div><div><dt>Barbero</dt><dd>{barber}</dd></div><div><dt>Fecha</dt><dd className="capitalize">{dateLabel(date)}</dd></div><div><dt>Horario</dt><dd>{time} · {selected?.duration} min</dd></div>{contact.notes.trim() && <div><dt>Observaciones</dt><dd className="max-w-[65%] whitespace-pre-wrap">{contact.notes.trim()}</dd></div>}</dl><div className="summary-financial-block"><div className="summary-financial-row summary-total-row"><span className="summary-financial-label">Precio total del servicio</span><span className="summary-financial-amount">{selected && money(selected.price)}</span></div><div className="summary-deposit-box"><div className="summary-deposit-copy"><span className="summary-deposit-title">Importe de la seña</span><span className="summary-deposit-subtitle">Aboná ahora para confirmar el turno</span></div><span className="summary-deposit-amount">{money(depositArs)}</span></div><div className="summary-financial-row summary-balance-row"><span className="summary-financial-label">Saldo restante a abonar en el local</span><span className="summary-financial-amount">{money(remainingPaymentArs)}</span></div></div>{remainingPaymentArs === 0 && <p className="summary-payment-note">La seña cubre el total del servicio.</p>}<div className="summary-card-notice mt-6 flex items-start gap-3 text-sm text-muted-foreground"><Clock3 className="mt-0.5 shrink-0 text-gold" size={18} /><p>Tu solicitud está pendiente hasta que abones la seña.</p></div></div>}
    {step === 0 && <p className="booking-deposit-notice" role="note"><Clock3 size={16} aria-hidden="true" /><span>Tu turno requiere abonar una seña. En el resumen verás el importe exacto, el total y el saldo restante.</span></p>}{error && <p role="alert" className="mt-5 text-destructive">{error}</p>}{mobileMenuOpen ? <MobileMenuAction /> : <div ref={ctaRef} className="booking-cta"><div className="booking-cta-inner flex items-center"><Button variant="outline" className="booking-back-button" onClick={() => move(step - 1)} disabled={step === 0 || submitting}><ArrowLeft size={14} aria-hidden="true" /> Volver</Button><Button disabled={!canNext || submitting} className="action-positive booking-next-button h-12 px-6" onClick={step === 5 ? submit : next}>{step === 5 ? (submitting ? 'Preparando pago seguro…' : 'Pagar seña') : 'Continuar'}</Button></div></div>}
    </section></div>{!mobileMenuOpen && (<a href="https://wa.me/5491128436014?text=Hola%2C%20quer%C3%ADa%20hacer%20una%20consulta%20sobre%20una%20reserva." target="_blank" rel="noopener noreferrer" className="booking-whatsapp-fab" aria-label="Consultas por WhatsApp" title="Consultas por WhatsApp"><svg className="booking-whatsapp-icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" /></svg></a>)}</main>;
}
