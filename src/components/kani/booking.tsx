import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, Clock3, CalendarDays, UserRound, Users, ChevronLeft, ChevronRight, ArrowLeft, CircleAlert, MapPin, Instagram } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { services, barbers, serviceFor, money, bookingEndDateFor, parseDate, isoDate, dateLabel, isBookingDate, type ServiceId, type Barber, type Appointment } from '@/lib/kani-model';
import { availabilityStartTimesForServiceDate, eligibleBarbersForAvailabilityStart, readConfiguredServices, readPublicAvailabilityStarts, type ConfiguredService, type PublicAvailabilityStart } from '@/lib/kani-availability';
import { businessDateToday } from '@/lib/kani-mobile-appointments';
import { appointmentErrorMessage, createRealAppointment } from '@/lib/kani-appointments';
import { getDynamicDownPayment } from '@/lib/kani-down-payment';
import { createBookingOrderFn } from '@/lib/kani-mercadopago.functions';
import { normalizePhone, type PhoneCountry } from '@/lib/kani-phone';
const PhoneInput = lazy(() => import('@/components/kani/phone-input').then(m => ({ default: m.PhoneInput })));
import { useKani } from '@/components/kani/store';
import { BookingStepHeading } from '@/components/kani/booking-step-heading';
const steps = ['Servicio', 'Barbero', 'Fecha', 'Horario', 'Datos', 'Resumen'];
const serviceIconById: Record<ServiceId, { light: string; dark: string }> = {
  corte: { light: '/service-corte-light.png', dark: '/service-corte-dark-strokes.png' },
  'corte-barba': { light: '/service-corte-barba-light.png', dark: '/service-corte-barba-dark-strokes.png' },
  barba: { light: '/service-barba-light.png', dark: '/service-barba-dark-strokes.png' },
};
type ContactField = 'name' | 'phone' | 'email' | 'notes';
type ContactValues = { name: string; email: string; phone: string; notes: string };
export type BookingPaymentDraft = {
  barber: Barber; serviceName: string; date: string; time: string;
  name: string; email: string; phone: string; notes: string;
};
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

function formatShortBookingDate(iso: string): string {
  if (!iso) return '';
  const d = parseDate(iso);
  const weekday = d.toLocaleDateString('es-AR', { weekday: 'long' });
  const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${capitalizedWeekday} ${day}/${month}`;
}

function formatV4BookingDate(iso: string, full = false): string {
  const d = parseDate(iso);
  const weekday = d.toLocaleDateString('es-AR', { weekday: 'long' });
  const month = d.toLocaleDateString('es-AR', { month: full ? 'long' : 'short' }).replace(/\.$/, '');
  const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
  return full ? `${capitalize(weekday)} ${d.getDate()} de ${capitalize(month)}` : `${capitalize(weekday)} ${d.getDate()} ${capitalize(month)}.`;
}

function ExperimentalLayout({ enabled, className, children }: { enabled: boolean; className?: string; children: ReactNode }) {
  return enabled ? <div className={className}>{children}</div> : <>{children}</>;
}

export function Booking({
  combinedDateTime = false,
  variant: propVariant,
  onPaymentRequest,
  paymentActionLabel,
  paymentNotice,
  isPaymentChecking = false,
  initialStep,
  initialService,
  initialBarber,
  initialDate,
  initialTime,
  initialContact,
}: {
  combinedDateTime?: boolean;
  variant?: 'v1' | 'v2' | 'v3' | 'v5';
  onPaymentRequest?: (draft: BookingPaymentDraft) => Promise<void>;
  paymentActionLabel?: string;
  paymentNotice?: ReactNode;
  isPaymentChecking?: boolean;
  initialStep?: number;
  initialService?: ServiceId;
  initialBarber?: Barber;
  initialDate?: string;
  initialTime?: string;
  initialContact?: { name: string; email: string; phone: string; notes: string };
} = {}) {
  const isV5 = propVariant === 'v5';
  const isV3 = propVariant === 'v3';
  const isFiveSteps = isV3 || isV5;
  const isV2 = propVariant === 'v2' || (!propVariant && combinedDateTime);
  const isV1 = !isV2 && !isV3 && !isV5;

  // Keep V1's internal stages and all booking operations; V2 groups presentation to 4 steps; V3 & V5 separate date and time to 5 steps.
  const stageOrder = isFiveSteps ? [0, 1, 2, 3, 4] : isV2 ? [0, 1, 2, 4] : [0, 1, 2, 3, 4, 5];
  const visibleSteps = isFiveSteps
    ? ['Servicio', 'Barbero', 'Fecha', 'Horario', 'Datos']
    : isV2
    ? ['Servicio', 'Barbero', 'Fecha y horario', 'Datos']
    : steps;
  const { mobileMenuOpen, setMobileMenuOpen } = useKani();
  const [step, setStep] = useState(() => initialStep ?? 0);
  const [service, setService] = useState<ServiceId | null>(() => initialService ?? null);
  const [barber, setBarber] = useState<Barber | null>(() => initialBarber ?? null);
  const [barberDeferred, setBarberDeferred] = useState(false);
  const [date, setDate] = useState(() => initialDate ?? '');
  const [time, setTime] = useState(() => initialTime ?? '');
  const [dateSelection, setDateSelection] = useState(0);
  const [businessToday, setBusinessToday] = useState(() => businessDateToday());
  const [month, setMonth] = useState(() => parseDate(initialDate ? initialDate : businessDateToday()));
  const [contact, setContact] = useState(() => initialContact ?? { name: '', email: '', phone: '', notes: '' });
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
  const ctaRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevStepRef = useRef(step);
  const timeSectionRef = useRef<HTMLDivElement>(null);
  const barberSectionRef = useRef<HTMLDivElement>(null);
  const revealTimesRef = useRef(false);
  const scrollAfterTimeSelectRef = useRef(false);
  const visibleStep = isV2 && step > 2 ? step - 1 : step;

  useEffect(() => {
    if (!isV2 || step !== 2 || !revealTimesRef.current || barberDeferred) return;
    revealTimesRef.current = false;
    const container = scrollContainerRef.current;
    const section = timeSectionRef.current;
    if (!container || !section || window.matchMedia('(min-width: 1024px)').matches) return;
    const viewport = container.getBoundingClientRect();
    const heading = section.getBoundingClientRect();
    // Reveal the heading and first row, retaining some calendar context. Never move focus.
    if (heading.top + 112 > viewport.bottom) {
      container.scrollTo({
        top: container.scrollTop + heading.top - viewport.top - Math.min(120, viewport.height / 3),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    }
  }, [isV2, date, dateSelection, step, barberDeferred]);

  useEffect(() => {
    if (!scrollAfterTimeSelectRef.current) return;
    scrollAfterTimeSelectRef.current = false;

    if (!isV2 || step !== 2 || !barberDeferred || !time) return;
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    requestAnimationFrame(() => {
      const section = barberSectionRef.current;
      if (!section) return;

      const viewport = container.getBoundingClientRect();
      const bRect = section.getBoundingClientRect();
      const bottomTarget = viewport.bottom - 16;
      const neededDelta = bRect.bottom - bottomTarget;

      if (neededDelta > 0) {
        const selectedSlot = container.querySelector('.booking-time-slot.selected');
        let allowedDelta = neededDelta;
        if (selectedSlot) {
          const sRect = selectedSlot.getBoundingClientRect();
          const maxAllowedDelta = sRect.top - (viewport.top + 16);
          if (maxAllowedDelta > 0) {
            allowedDelta = Math.min(neededDelta, maxAllowedDelta);
          }
        }
        const maxScroll = container.scrollHeight - container.clientHeight;
        const targetScroll = Math.min(maxScroll, Math.max(0, container.scrollTop + allowedDelta));

        if (targetScroll > container.scrollTop) {
          container.scrollTo({
            top: targetScroll,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
          });
        }
      }
    });
  }, [isV2, step, barberDeferred, time]);

  useEffect(() => {
    document.documentElement.classList.add('booking-flow-active');
    document.body.classList.add('booking-flow-active');
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    return () => {
      document.documentElement.classList.remove('booking-flow-active');
      document.body.classList.remove('booking-flow-active');
    };
  }, []);

  useEffect(() => {
    if (prevStepRef.current !== step) {
      prevStepRef.current = step;
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
    }
  }, [step]);

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
      const active = buttons[visibleStep];
      if (!active) return;
      const progressRect = progress.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      const next = buttons[visibleStep + 1];
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
  }, [step, visibleStep]);

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
    if (onPaymentRequest || typeof window === 'undefined') return;
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
  const homeLink = isV5 ? "/reserva-v5" : isV3 ? "/reserva-v3" : isV2 ? "/reserva-v2" : "/reservar";

  function move(next: number) {
    setStep(isFiveSteps ? next : isV2 ? next === 3 ? 2 : next === 5 ? 4 : next : next);
    setError('');
    window.scrollTo({
      top: 0,
      behavior: (isV2 || isFiveSteps) && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }
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
    if (isFiveSteps) {
      if (step === 2 && (!date || !availableDatesSet.has(date))) {
        setError('Elegí una fecha para continuar.');
        return;
      }
      if (step === 3 && (!time || !slots.includes(time) || !barber)) {
        setError(barberDeferred && !barber ? 'Elegí quién te va a atender para continuar.' : 'Elegí un horario para continuar.');
        return;
      }
    } else {
      if ((step === 3 || isV2 && step === 2) && (!date || !time || !barber || isV2 && (!availableDatesSet.has(date) || !slots.includes(time)))) {
        setError('Elegí una fecha, un horario y un barbero para continuar.');
        return;
      }
    }
    if (step === 4) {
      setTouched({ name: true, phone: true, email: true, notes: true });
      if (!formRef.current?.reportValidity()) return;
      const normalized = normalizePhone(contact.phone, phoneCountry);
      if (!normalized) { setError('Ingresá un número de teléfono válido para el país seleccionado.'); return; }
      setContact(current => ({ ...current, phone: normalized.display }));
    }
    move(isV2 && step === 2 ? 4 : step + 1);
  }
  async function submit() {
    if (!service || !barber || !date || !time || submitting) return;
    if (isV2 || isFiveSteps) {
      setTouched({ name: true, phone: true, email: true, notes: true });
      if (!formRef.current?.reportValidity()) return;
    }
    const normalizedPhone = normalizePhone(contact.phone, phoneCountry);
    if (!normalizedPhone) {
      move(4);
      setError('Ingresá un número de teléfono válido para el país seleccionado.');
      return;
    }
    if (!pendingAppointment && (!slots.includes(time) || (isV2 || isFiveSteps) && (!availableDatesSet.has(date) || barberDeferred && !eligibleBarbersForAvailabilityStart(availabilityStartsByDate.get(date) ?? [], date, time, serviceName, clock).includes(barber)))) {
      move(3);
      setError('Ese horario ya no está disponible. Elegí otro para continuar.');
      return;
    }
    setSubmitting(true);
    setError('');

    // An opt-in provider owns its checkout; existing routes retain their original path.
    if (onPaymentRequest) {
      try {
        await onPaymentRequest({ barber, serviceName: selected?.name ?? serviceFor(service).name,
          date, time, name: contact.name.trim(), phone: normalizedPhone.e164,
          email: contact.email.trim(), notes: contact.notes });
      } catch {
        setError('No pudimos iniciar el pago. Tus datos no se perdieron.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

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
      setError('No pudimos iniciar el pago. Tus datos no se perdieron. Podés volver a intentarlo.');
      setSubmitting(false);
    } catch (cause) {
      console.error('[Mercado Pago] Error durante el proceso de reserva/pago:', cause);
      const friendlyMsg = appointmentErrorMessage(cause);
      const isKnownAvailabilityMessage =
        friendlyMsg === 'Ese horario ya no está disponible. Elegí otro para continuar.' ||
        friendlyMsg === 'Ese horario acaba de dejar de estar disponible o ya tiene un turno reservado.' ||
        friendlyMsg === 'La fecha seleccionada ya no está disponible.' ||
        friendlyMsg === 'El estudio permanece cerrado los domingos.' ||
        friendlyMsg === 'El correo electrónico del cliente es obligatorio y debe tener un formato válido.';

      if (isKnownAvailabilityMessage) {
        setError(friendlyMsg);
      } else {
        setError('No pudimos iniciar el pago. Tus datos no se perdieron. Podés volver a intentarlo.');
      }
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
            <a href={homeLink}>Volver al inicio</a>
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
          <a href={homeLink}>Volver al inicio</a>
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
          <a href={homeLink}>Reservar nuevamente</a>
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
            <a href={homeLink}>Volver al inicio</a>
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
  const canNext = isV2 && step === 2
    ? Boolean(date && availableDatesSet.has(date) && time && slots.includes(time) && barber && (!barberDeferred || eligibleBarbersForAvailabilityStart(availabilityStartsByDate.get(date) ?? [], date, time, serviceName, clock).includes(barber))) && !availabilityLoading
    : isFiveSteps
    ? [
        Boolean(service),
        Boolean(barber || barberDeferred),
        Boolean(date && availableDatesSet.has(date)) && !availabilityLoading,
        Boolean(time && slots.includes(time) && barber && (!barberDeferred || eligibleBarbersForAvailabilityStart(availabilityStartsByDate.get(date) ?? [], date, time, serviceName, clock).includes(barber))),
        contactReady,
      ][step]
    : [Boolean(service), Boolean(barber || barberDeferred), Boolean(date), Boolean(time && barber), contactReady, true][step];
  const today = parseDate(todayValue);
  const lastBookingDay = parseDate(bookingEndValue);
  const candidateBarbers = service && date && time && barberDeferred ? eligibleBarbersForAvailabilityStart(availabilityStartsByDate.get(date) ?? [], date, time, serviceName, clock) : [];

  useEffect(() => {
    if (isV5 && barberDeferred && time && candidateBarbers.length === 1 && barber !== candidateBarbers[0]) {
      setBarber(candidateBarbers[0]);
    }
  }, [isV5, barberDeferred, time, candidateBarbers, barber]);

  const timeSlots = visibleSlots;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  return (
    <main className={`site-container booking-page ${isV2 ? 'booking-v2' : ''} ${isV3 ? 'booking-v3' : ''} ${isV5 ? 'booking-v5' : ''} ${isV2 && step === 2 ? 'booking-v2-datetime' : ''} ${isFiveSteps && step === 2 ? `booking-${isV5 ? 'v5' : 'v3'}-date` : ''} ${isFiveSteps && step === 3 ? `booking-${isV5 ? 'v5' : 'v3'}-time` : ''} ${(isV2 || isFiveSteps) && step === 4 ? `booking-v2-final booking-${isV5 ? 'v5' : 'v3'}-final` : ''} ${step === 5 ? 'booking-summary-page' : ''}`}>
      <div
        ref={progressRef}
        className="booking-progress"
        role={isV2 || isFiveSteps ? "group" : undefined}
        style={{ '--progress-start': `${progressStart}px`, '--progress-width': `${progressWidth}px` } as CSSProperties}
        aria-label={`Paso ${visibleStep + 1} de ${visibleSteps.length}: ${visibleSteps[visibleStep]}`}
      >
        {visibleSteps.map((name, i) => (
          <Button
            key={name}
            variant="ghost"
            disabled={i > visibleStep}
            aria-current={i === visibleStep ? 'step' : undefined}
            onClick={() => move(stageOrder[i] ?? 0)}
            className={i === visibleStep ? 'current' : i < visibleStep ? 'complete' : ''}
          >
            <span>{i < visibleStep ? <Check size={13} /> : String(i + 1).padStart(2, '0')}</span>
            <small>{isV2 && i === 2 ? <>
              <span className="sr-only">{name}</span>
              <span className="booking-v2-step-mobile" aria-hidden="true">Fecha/Hora</span>
              <span className="booking-v2-step-desktop" aria-hidden="true">{name}</span>
            </> : name}</small>
          </Button>
        ))}
      </div>

      <div ref={scrollContainerRef} className="booking-scroll-content">
        <div className="booking-layout">
          <section className="min-w-0">
            <BookingStepHeading
              title={isV2 && step === 2 ? 'Elegir una fecha' : titles[step]}
              stepIndex={step}
              className={`${step === 0 ? 'booking-service-heading' : ''} ${step === 1 ? 'booking-barber-heading' : ''} ${step === 2 ? 'booking-date-heading' : ''} ${step === 3 ? 'booking-time-heading' : ''} ${step === 4 ? 'booking-contact-heading' : ''} ${step === 5 ? 'booking-summary-heading' : ''}`.trim()}
              secondary={
                step === 3 && date ? (
                  <span className="booking-time-heading-date">
                    <CalendarDays size={16} />{onPaymentRequest ? <><span className="booking-v4-date-mobile">{formatV4BookingDate(date)}</span><span className="booking-v4-date-desktop">{formatV4BookingDate(date, true)}</span></> : isFiveSteps ? formatShortBookingDate(date) : dateLabel(date)}
                  </span>
                ) : undefined
              }
            />
            {subtitles[step] && <p className="mb-8 mt-3 text-muted-foreground">{subtitles[step]}</p>}

            {step === 0 && (
              <div className="booking-service-options space-y-3">
                {configuredServices.map(s => (
                  <Button
                    key={s.id}
                    variant="outline"
                    aria-pressed={service === s.id}
                    aria-label={`${s.name}, ${s.duration} minutos, ${money(s.price)}${service === s.id ? ', seleccionado' : ''}`}
                    className={`booking-option service-option ${service === s.id ? 'selected' : ''}`}
                    onClick={() => { if (service !== s.id) chooseService(s.id) }}
                  >
                    <span className="option-icon">
                      <span className="service-icon-mask service-icon-mask-light" style={{ maskImage: `url(${serviceIconById[s.id].light})`, WebkitMaskImage: `url(${serviceIconById[s.id].light})` }} aria-hidden="true" />
                      <span className="service-icon-mask service-icon-mask-dark" style={{ maskImage: `url(${serviceIconById[s.id].dark})`, WebkitMaskImage: `url(${serviceIconById[s.id].dark})` }} aria-hidden="true" />
                      <img className="service-icon-light" src={serviceIconById[s.id].light} alt="" aria-hidden="true" width={44} height={44} />
                      <img className="service-icon-dark" src={serviceIconById[s.id].dark} alt="" aria-hidden="true" width={44} height={44} />
                    </span>
                    <span className="booking-option-copy min-w-0 flex-1 text-left">
                      <span className="booking-option-name block text-lg font-medium">{s.name}</span>
                      <span className="booking-option-meta">
                        <span className="booking-option-duration block text-sm text-muted-foreground">{s.duration} minutos</span>
                        <span className="booking-option-price block text-base">{money(s.price)}</span>
                      </span>
                    </span>
                    <span className="selection-circle">{service === s.id && <Check size={12} />}</span>
                  </Button>
                ))}
              </div>
            )}

            {step === 1 && (
              <div className="booking-barber-options space-y-3">
                {barbers.map((b, i) => (
                  <Button
                    key={b}
                    variant="outline"
                    aria-pressed={barber === b && !barberDeferred}
                    aria-label={`Barbero ${b}${barber === b && !barberDeferred ? ', seleccionado' : ''}`}
                    className={`booking-option ${barber === b && !barberDeferred ? 'selected' : ''}`}
                    onClick={() => chooseBarber(b)}
                  >
                    <span className={`barber-avatar avatar-${i}`}>{b.charAt(0)}</span>
                    <span className={`booking-option-copy flex-1 ${isV5 ? 'text-left' : 'text-center'}`}>
                      <span className="booking-barber-name block text-lg font-medium">{b}</span>
                      <span className="booking-barber-handle mt-0.5 block text-sm text-muted-foreground">{({ Lautaro: '@lautarodejesus_', Gonzalo: '@gonzalopierucci', 'Valentín': '@valentincarrizo_' } as Record<Barber, string>)[b]}</span>
                    </span>
                    <span className="selection-circle">{barber === b && !barberDeferred && <Check size={12} />}</span>
                  </Button>
                ))}
                <Button
                  variant="outline"
                  aria-pressed={barberDeferred}
                  aria-label={isV5 ? `Cualquier barbero disponible, el sistema asignará según fecha y horario${barberDeferred ? ', seleccionado' : ''}` : "Elegir más adelante"}
                  className={`booking-defer-option ${barberDeferred ? 'selected' : ''}`}
                  onClick={() => { setBarber(null); setBarberDeferred(true); setPublicSlots([]); setAvailabilityError(''); setDate(''); setTime(''); }}
                >
                  <span className="barber-defer-mark" aria-hidden="true">{isV5 ? <Users size={18} /> : '?'}</span>
                  <span className={`booking-defer-copy booking-option-copy flex-1 ${isV5 ? 'text-left' : 'text-center'}`}>
                    <span className="block text-base font-medium">{isV5 ? 'Cualquier barbero disponible' : 'Elegir más adelante'}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{isV5 ? 'El sistema asignará según fecha y horario' : 'Elegir según fecha y horario'}</span>
                  </span>
                  <span className="selection-circle">{barberDeferred && <Check size={12} />}</span>
                </Button>
              </div>
            )}

            <ExperimentalLayout enabled={isV2 && step === 2} className="booking-v2-date-time">
            {step === 2 && (
              <ExperimentalLayout enabled={isV2}>
              <div className="calendar-panel">
                <div className="calendar-header mb-7 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <h2 className="capitalize">{month.toLocaleDateString('es-AR', { month: 'long' }).replace(/^./, letter => letter.toUpperCase()) + ' ' + month.getFullYear()}</h2>
                    {isV5 && availabilityLoading && (
                      <span className="calendar-loading-indicator text-xs font-normal text-muted-foreground flex items-center gap-1.5 animate-pulse" aria-live="polite">
                        <Clock3 size={13} className="animate-spin text-gold" />
                        <span>Actualizando…</span>
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" aria-label="Mes anterior" disabled={month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth()} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></Button>
                    <Button variant="ghost" size="icon" aria-label="Mes siguiente" disabled={month.getFullYear() === lastBookingDay.getFullYear() && month.getMonth() === lastBookingDay.getMonth()} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></Button>
                  </div>
                </div>
                <div className="calendar-grid">
                  {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => <span key={i} className="calendar-weekday">{d}</span>)}
                  {Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} />)}
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const day = new Date(month.getFullYear(), month.getMonth(), i + 1);
                    const value = isoDate(day);
                    const isWithinBookingWindow = value >= todayValue && value <= bookingEndValue;
                    const disabled = availabilityLoading || !service || !availabilityBarber && !barberDeferred || !isWithinBookingWindow || (!isBookingDate(value, todayValue, bookingEndValue) && !availableDatesSet.has(value)) || !availableDatesSet.has(value);
                    const isToday = value === todayValue;
                    const ariaLabel = isToday
                      ? `Hoy, ${dateLabel(value)}${disabled ? ', sin turnos' : ''}${date === value ? ', seleccionado' : ''}`
                      : `${dateLabel(value)}${disabled ? ', sin turnos' : ''}${date === value ? ', seleccionado' : ''}`;
                    return (
                      <Button
                        key={value}
                        variant="ghost"
                        className={`calendar-day ${date === value ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                        disabled={disabled}
                        aria-label={ariaLabel}
                        aria-pressed={date === value}
                        onClick={() => { if (isV2) { revealTimesRef.current = true; setDateSelection(current => current + 1); } if (date !== value) { setDate(value); setTime(''); if (barberDeferred) setBarber(null); } }}
                      >
                        {i + 1}
                      </Button>
                    );
                  })}
                </div>
                {availabilityError && <p role="alert" className="mt-5 text-destructive">{availabilityError}</p>}
                {isV5 && !availabilityLoading && availableDates.length === 0 && (barber || barberDeferred) && (
                  <p role="status" className="calendar-no-availability mt-4 p-3 rounded-md bg-muted/60 text-center text-xs text-muted-foreground">
                    No encontramos turnos disponibles para los próximos días con esta combinación. Probá cambiando de barbero o servicio.
                  </p>
                )}
                {!isV2 && (
                  <div className="calendar-footer-info mt-6 space-y-2">
                    <p className="calendar-note flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="h-1 w-1 rounded-full bg-gold" /> Atendemos de lunes a {onPaymentRequest ? 'sábados' : 'sábado'} de 10 a 20 hs.
                    </p>
                    {isV5 && (
                      <div className="calendar-legend flex items-center gap-4 text-xs text-muted-foreground pt-1">
                        <span className="flex items-center gap-1.5"><span className="legend-indicator today-indicator" aria-hidden="true" /> Hoy</span>
                        <span className="flex items-center gap-1.5"><span className="legend-indicator selected-indicator" aria-hidden="true" /> Seleccionado</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              </ExperimentalLayout>
            )}

            {(step === 3 || isV2 && step === 2 && date) && (
              <div ref={timeSectionRef} className={isV2 ? 'booking-v2-times' : isFiveSteps ? `booking-${isV5 ? 'v5' : 'v3'}-times` : undefined} aria-busy={availabilityLoading}>
                {isV2 && <h2 className="booking-v2-choice-title">Elegir un horario</h2>}
                {isV5 && availabilityLoading ? (
                  <div className="booking-time-loading py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2" role="status">
                    <Clock3 size={18} className="animate-spin text-gold" />
                    <span>Buscando horarios disponibles…</span>
                  </div>
                ) : (
                  <div className="booking-time-grid grid grid-cols-3 gap-2 sm:grid-cols-4" role={isV2 || isFiveSteps ? "group" : undefined} aria-label={isV2 || isFiveSteps ? "Horarios disponibles" : undefined}>
                    {timeSlots.map(slot => (
                      <Button
                        key={slot.time}
                        variant="outline"
                        className={`booking-time-slot h-12 ${time === slot.time ? 'selected' : ''}`}
                        aria-pressed={time === slot.time}
                        aria-label={`Horario ${slot.time}${time === slot.time ? ', seleccionado' : ''}`}
                        onClick={() => { setTime(slot.time); if (barberDeferred) { setBarber(null); scrollAfterTimeSelectRef.current = true; } }}
                      >
                        {slot.time}
                      </Button>
                    ))}
                  </div>
                )}
                {barberDeferred && time && (
                  <div ref={barberSectionRef} className="barber-choice-inline mt-4 pt-3 border-t border-border/40">
                    <h2 className={isV2 ? "booking-v2-choice-title" : "text-sm font-medium mb-2.5 text-foreground"}>
                      {candidateBarbers.length === 1 ? `Barbero asignado para las ${time} hs:` : `¿Quién te va a atender a las ${time} hs?`}
                    </h2>
                    <div className="barber-choice-list flex flex-wrap gap-2">
                      {candidateBarbers.map(candidate => (
                        <Button
                          key={candidate}
                          variant="outline"
                          aria-pressed={barber === candidate}
                          aria-label={`Barbero ${candidate}${barber === candidate ? ', seleccionado' : ''}`}
                          className={`booking-candidate-barber-btn ${barber === candidate ? 'selected' : ''}`}
                          onClick={() => setBarber(candidate)}
                        >
                          <span className="candidate-name">{candidate}</span>
                          {barber === candidate && <Check size={14} className="ml-1.5" />}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                {availabilityError && <p role="alert" className="py-3 text-sm text-destructive">{availabilityError}</p>}
                {slots.length === 0 && !availabilityLoading && (
                  <div className="py-8 text-center text-muted-foreground space-y-1">
                    <p className="text-sm font-medium text-foreground">No hay horarios disponibles para esta fecha.</p>
                    <p className="text-xs">Podés volver al paso anterior para elegir otro día o cambiar de barbero.</p>
                  </div>
                )}
              </div>
            )}

            </ExperimentalLayout>

            <ExperimentalLayout enabled={(isV2 || isFiveSteps) && step === 4} className="booking-v2-final-layout">
            {step === 4 && (
              <form ref={formRef} className="booking-contact-form space-y-3" onSubmit={e => { e.preventDefault(); if (isV1) next(); }}>
                <label className="field-label">
                  <span>Nombre y apellido <span className="field-required text-gold" aria-hidden="true">*</span></span>
                  <span className={`field-control ${statusFor('name')}`}>
                    <Input
                      name="name"
                      required
                      minLength={3}
                      autoComplete="name"
                      autoCapitalize="words"
                      spellCheck="false"
                      value={contact.name}
                      onBlur={() => markTouched('name')}
                      onChange={e => setContact({ ...contact, name: e.target.value })}
                      placeholder="Tu nombre completo"
                      aria-invalid={statusFor('name') === 'invalid'}
                      aria-describedby={statusFor('name') === 'invalid' ? 'name-error' : undefined}
                    />
                    {feedbackFor('name')}
                  </span>
                  {statusFor('name') === 'invalid' && (
                    <span id="name-error" className="field-validation-message" role="alert">
                      {fieldMessage('name')}
                    </span>
                  )}
                </label>
                <label className="field-label" htmlFor={isV2 || isFiveSteps ? "booking-v2-phone" : undefined}>
                  <span>Celular <span className="field-required text-gold" aria-hidden="true">*</span></span>
                  <Suspense fallback={<div className="h-12 w-full animate-pulse rounded-md bg-muted" />}>
                    <PhoneInput
                      id={isV2 || isFiveSteps ? "booking-v2-phone" : undefined}
                      name="phone"
                      required
                      value={contact.phone}
                      country={phoneCountry}
                      onCountryChange={setPhoneCountry}
                      onChange={val => setContact(current => ({ ...current, phone: val }))}
                      onBlur={() => markTouched('phone')}
                      controlClassName={statusFor('phone')}
                      feedback={feedbackFor('phone')}
                      aria-invalid={statusFor('phone') === 'invalid'}
                      aria-describedby={statusFor('phone') === 'invalid' ? 'phone-error' : undefined}
                    />
                  </Suspense>
                  {statusFor('phone') === 'invalid' && (
                    <span id="phone-error" className="field-validation-message" role="alert">
                      {fieldMessage('phone')}
                    </span>
                  )}
                </label>
                <label className="field-label">
                  <span>Email <span className="field-required text-gold" aria-hidden="true">*</span></span>
                  <span className={`field-control ${statusFor('email')}`}>
                    <Input
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck="false"
                      inputMode="email"
                      value={contact.email}
                      onBlur={() => markTouched('email')}
                      onChange={e => setContact({ ...contact, email: e.target.value })}
                      placeholder="nombre@email.com"
                      aria-invalid={statusFor('email') === 'invalid'}
                      aria-describedby={statusFor('email') === 'invalid' ? 'email-error' : undefined}
                    />
                    {feedbackFor('email')}
                  </span>
                  {statusFor('email') === 'invalid' && (
                    <span id="email-error" className="field-validation-message" role="alert">
                      {fieldMessage('email')}
                    </span>
                  )}
                </label>
                <label className="field-label">
                  <span>Observaciones <span className="text-xs font-normal text-muted-foreground">(opcional)</span></span>
                  <span className={`field-control ${statusFor('notes')}`}>
                    <textarea
                      name="notes"
                      className="notes-input"
                      maxLength={500}
                      value={contact.notes}
                      onBlur={() => markTouched('notes')}
                      onChange={e => setContact({ ...contact, notes: e.target.value })}
                      placeholder="Algo que quieras contarnos"
                      aria-invalid="false"
                    />
                    {feedbackFor('notes')}
                  </span>
                </label>
                {isV1 && <Button type="submit" hidden className="hidden" tabIndex={-1}>Continuar</Button>}
              </form>
            )}

            {(step === 5 || (isV2 || isFiveSteps) && step === 4) && (
              <div className="booking-summary-cards space-y-2 sm:space-y-3.5">
                {/* Card 1: Datos personales compactada */}
                {isV1 && <section className="booking-summary-card summary-client-card" aria-label="Datos personales">
                  <div className="summary-card-header flex items-center justify-between gap-3">
                    <h2 className="summary-client-name text-sm sm:text-base font-semibold text-foreground tracking-tight">{contact.name}</h2>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="summary-edit-button text-gold hover:text-gold/80 h-auto p-0 font-medium text-xs sm:text-sm"
                      onClick={() => move(4)}
                      aria-label="Editar datos de contacto"
                    >
                      Editar
                    </Button>
                  </div>
                  <div className="summary-client-details mt-1.5 flex flex-col gap-1 text-xs sm:text-sm text-muted-foreground">
                    <p className="summary-client-email break-all">{contact.email}</p>
                    <p className="summary-client-phone">{contact.phone}</p>
                  </div>
                </section>}

                <ExperimentalLayout enabled={isV2 || isFiveSteps} className="booking-summary-card booking-v2-unified-summary">
                {/* Card 2: Datos del turno compactada */}
                <section className={`${isV2 || isFiveSteps ? '' : 'booking-summary-card '}summary-appointment-card`} aria-label="Datos del turno">
                  <dl className="summary-details-list flex flex-col gap-1.5 sm:gap-2.5 text-xs sm:text-sm">
                    <div className="summary-detail-row flex justify-between items-baseline gap-3 sm:gap-4">
                      <dt className="summary-detail-label text-muted-foreground">Servicio</dt>
                      <dd className="summary-detail-value font-medium text-foreground text-right">{selected?.name}</dd>
                    </div>
                    <div className="summary-detail-row flex justify-between items-baseline gap-3 sm:gap-4">
                      <dt className="summary-detail-label text-muted-foreground">Barbero</dt>
                      <dd className="summary-detail-value font-medium text-foreground text-right">{barber}</dd>
                    </div>
                    <div className="summary-detail-row flex justify-between items-baseline gap-3 sm:gap-4">
                      <dt className="summary-detail-label text-muted-foreground">Fecha</dt>
                      <dd className="summary-detail-value font-medium text-foreground text-right capitalize">{isFiveSteps ? formatShortBookingDate(date) : dateLabel(date)}</dd>
                    </div>
                    <div className="summary-detail-row flex justify-between items-baseline gap-3 sm:gap-4">
                      <dt className="summary-detail-label text-muted-foreground">Horario</dt>
                      <dd className="summary-detail-value font-medium text-foreground text-right">{isV2 || isFiveSteps ? time : <>{time} · {selected?.duration} min</>}</dd>
                    </div>
                    {isV1 && contact.notes.trim() && (
                      <div className="summary-detail-row flex justify-between items-baseline gap-3 sm:gap-4">
                        <dt className="summary-detail-label text-muted-foreground">Observaciones</dt>
                        <dd className="summary-detail-value text-foreground text-right max-w-[65%] whitespace-pre-wrap">{contact.notes.trim()}</dd>
                      </div>
                    )}
                  </dl>
                </section>

                {/* Card 3: Card de importes compactada */}
                <section className={`${isV2 || isFiveSteps ? '' : 'booking-summary-card '}summary-pricing-card`} aria-label="Importes">
                  <dl className="summary-pricing-list flex flex-col gap-1.5 sm:gap-2.5 text-xs sm:text-sm">
                    <div className="summary-pricing-row flex justify-between items-baseline gap-3 sm:gap-4">
                      <dt className="summary-pricing-label text-muted-foreground">Precio total del servicio</dt>
                      <dd className="summary-pricing-value font-semibold text-foreground text-right">{selected && money(selected.price)}</dd>
                    </div>
                    <div className="summary-pricing-row flex justify-between items-baseline gap-3 sm:gap-4">
                      <dt className="summary-pricing-label text-muted-foreground">Importe de la seña</dt>
                      <dd className="summary-pricing-value font-semibold text-gold text-right">{money(depositArs)}</dd>
                    </div>
                    <div className="summary-pricing-row flex justify-between items-baseline gap-3 sm:gap-4">
                      <dt className="summary-pricing-label text-muted-foreground">Saldo a pagar en el local</dt>
                      <dd className="summary-pricing-value font-semibold text-foreground text-right">{money(remainingPaymentArs)}</dd>
                    </div>
                  </dl>
                  {remainingPaymentArs === 0 && (
                    <p className="summary-payment-note mt-1.5 text-xs text-muted-foreground">La seña cubre el total del servicio.</p>
                  )}
                </section>

                </ExperimentalLayout>

                {/* 4. Aviso de solicitud pendiente en container propio */}
                <div className="booking-summary-card summary-pending-notice summary-card-notice flex items-center gap-2.5 text-xs sm:text-sm" role="note">
                  <Clock3 size={15} className="shrink-0" aria-hidden="true" />
                  <p className="m-0 leading-normal">{isV2 || isFiveSteps ? 'Tu turno se confirma cuando se acredita la seña.' : 'Tu solicitud está pendiente hasta que abones la seña.'}</p>
                </div>
              </div>
            )}

            </ExperimentalLayout>

            {step === 0 && (
              <p className="booking-deposit-notice" role="note">
                <Clock3 size={16} aria-hidden="true" />
                <span>Tu turno requiere abonar una seña. En el resumen verás el importe exacto, el total y el saldo restante.</span>
              </p>
            )}
            {paymentNotice && (step === 5 || ((isV2 || isFiveSteps) && step === 4)) && (
              <div className="mt-4">{paymentNotice}</div>
            )}
            {error && <p role="alert" className="mt-5 text-destructive">{error}</p>}
          </section>
        </div>
      </div>

      <div ref={ctaRef} className="booking-cta" aria-hidden={mobileMenuOpen || undefined} inert={mobileMenuOpen} style={mobileMenuOpen ? { visibility: 'hidden' } : undefined}>
          <div className="booking-cta-inner flex items-center">
            <Button variant="outline" className="booking-back-button" onClick={() => move(isV2 && step === 4 ? 2 : step - 1)} disabled={step === 0 || submitting}>
              <ArrowLeft size={14} aria-hidden="true" /> Volver
            </Button>
            <Button disabled={!canNext || submitting || isPaymentChecking} className="action-positive booking-next-button h-12 px-6" onClick={step === 5 || (isV2 || isFiveSteps) && step === 4 ? submit : next}>
              {step === 5 || (isV2 || isFiveSteps) && step === 4
                ? (isPaymentChecking
                    ? 'Comprobando pago…'
                    : submitting
                    ? 'Preparando pago seguro…'
                    : paymentActionLabel ?? (isV5 ? `Pagar seña ${money(depositArs)}` : 'Pagar seña'))
                : 'Continuar'}
            </Button>
          </div>
        </div>
    </main>
  );
}
