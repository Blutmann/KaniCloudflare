import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Clock3, Loader2 } from 'lucide-react';
import { Booking, type BookingPaymentDraft } from '@/components/kani/booking';
import { BookingConfirmedScreen, type ConfirmedBookingData } from '@/components/kani/booking-confirmed-screen';
import { createRealAppointment, appointmentErrorMessage } from '@/lib/kani-appointments';
import { createBookingOrderFn, getAppointmentPaymentStatusFn } from '@/lib/kani-mercadopago.functions';
import { readConfiguredServices, type ConfiguredService } from '@/lib/kani-availability';
import { services, serviceFor, type ServiceId, type Barber } from '@/lib/kani-model';
import { KANI_STANDARD_DEPOSIT_ARS } from '@/lib/kani-constants';
import { checkoutReturnIdentifiers } from '@/lib/kani-payment-return';

const CONFIRMED_STORAGE_KEY = 'kani:mercadopago:confirmed-booking';
const ACTIVE_ATTEMPT_STORAGE_KEY = 'kani:mercadopago:active-attempt';

type StoredActiveAttempt = {
  appointmentId: string;
  serviceName: string;
  barber: string;
  date: string;
  time: string;
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  timestamp: number;
};

function readConfirmedBooking(): ConfirmedBookingData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CONFIRMED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.serviceName === 'string' && typeof parsed.barber === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function persistConfirmedBooking(data: ConfirmedBookingData) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CONFIRMED_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function clearConfirmedBooking() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CONFIRMED_STORAGE_KEY);
  } catch {}
}

function readActiveAttempt(): StoredActiveAttempt | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_ATTEMPT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.appointmentId === 'string' && typeof parsed.timestamp === 'number') {
      // 10 minutos de vigencia para el intento pendiente
      if (Date.now() - parsed.timestamp < 10 * 60 * 1000) {
        return parsed;
      }
      window.sessionStorage.removeItem(ACTIVE_ATTEMPT_STORAGE_KEY);
    }
    return null;
  } catch {
    return null;
  }
}

function persistActiveAttempt(data: StoredActiveAttempt) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ACTIVE_ATTEMPT_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function clearActiveAttempt() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(ACTIVE_ATTEMPT_STORAGE_KEY);
  } catch {}
}

export function MercadoPagoBooking() {
  const [confirmed, setConfirmed] = useState<ConfirmedBookingData | null>(readConfirmedBooking);
  const [configuredServices, setConfiguredServices] = useState<ConfiguredService[]>([]);
  const [isPaymentChecking, setIsPaymentChecking] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [initialAttempt, setInitialAttempt] = useState<StoredActiveAttempt | null>(readActiveAttempt);
  const draftRef = useRef<BookingPaymentDraft | null>(null);

  // Cargar catálogo de servicios configurados para precios actualizados
  useEffect(() => {
    let cancelled = false;
    readConfiguredServices().then((svcs) => {
      if (!cancelled && svcs && svcs.length > 0) {
        setConfiguredServices(svcs);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Verificar retornos de Mercado Pago (por query parameters de URL o intento activo)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (confirmed) return;

    const params = new URLSearchParams(window.location.search);
    const { appointmentId, orderId, paymentId } = checkoutReturnIdentifiers(params);

    const targetAppointmentId = appointmentId || initialAttempt?.appointmentId;
    if (!targetAppointmentId) return;

    // Si viene con parámetros de retorno de pago, verificar contra el backend
    const hasReturnSignals = Boolean(
      params.get('appointment_id') ||
      params.get('external_reference') ||
      params.get('payment_id') ||
      params.get('collection_id') ||
      params.get('status')
    );

    if (!hasReturnSignals && !initialAttempt) return;

    let isMounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const verifyStatus = async (attemptCount = 0) => {
      setIsPaymentChecking(true);
      try {
        const res = await getAppointmentPaymentStatusFn({
          data: {
            appointmentId: targetAppointmentId,
            orderId: orderId?.trim() || undefined,
            paymentId: paymentId?.trim() || undefined,
          },
        });

        if (!isMounted) return;

        if (res.isConfirmed && res.appointment) {
          const appt = res.appointment;
          const servicePrice = appt.servicePriceArs ?? 25000;
          const depositArs = appt.depositAmountArs ?? KANI_STANDARD_DEPOSIT_ARS;

          const confirmedData: ConfirmedBookingData = {
            appointmentId: appt.id,
            serviceName: appt.serviceName ?? 'Servicio Kani',
            barber: appt.barberName ?? 'Lautaro',
            date: appt.date ?? '',
            time: (appt.time ?? '').slice(0, 5),
            clientName: appt.clientName ?? initialAttempt?.clientName ?? '',
            depositArs,
            servicePriceArs: servicePrice,
          };

          persistConfirmedBooking(confirmedData);
          setConfirmed(confirmedData);
          clearActiveAttempt();
          setInitialAttempt(null);

          // Limpiar parámetros de la barra de URL para evitar verificaciones redundantes
          window.history.replaceState({}, '', window.location.pathname);
          setIsPaymentChecking(false);
          return;
        }

        // Si el pago aún está en PENDING y acabamos de regresar de Mercado Pago, reintentar (race condition resolution)
        if (hasReturnSignals && res.appointmentStatus === 'PENDING' && attemptCount < 3) {
          retryTimer = setTimeout(() => {
            if (isMounted) void verifyStatus(attemptCount + 1);
          }, 2500);
          return;
        }

        if (res.appointmentStatus === 'PENDING') {
          setStatusNotice(
            'Estamos comprobando tu pago con Mercado Pago. Podés esperar unos instantes o verificar el estado nuevamente.'
          );
        } else if (res.appointmentStatus === 'CANCELLED') {
          setStatusNotice(
            'El turno no pudo confirmarse porque la operación expiró o fue cancelada. Podés iniciar una nueva reserva.'
          );
          clearActiveAttempt();
          setInitialAttempt(null);
        }
      } catch (err) {
        console.error('[MercadoPagoBooking] Error verificando pago:', err);
      } finally {
        if (isMounted) setIsPaymentChecking(false);
      }
    };

    if (hasReturnSignals) {
      void verifyStatus();
    }

    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  function startNewReservation() {
    clearConfirmedBooking();
    setConfirmed(null);
    clearActiveAttempt();
    setInitialAttempt(null);
    setStatusNotice(null);
  }

  async function begin(draft: BookingPaymentDraft) {
    draftRef.current = draft;
    setStatusNotice(null);

    // Resolver precio comercial del servicio
    const matchedSvc =
      configuredServices.find((s) => s.name.toLowerCase() === draft.serviceName.toLowerCase()) ||
      services.find((s) => s.name.toLowerCase() === draft.serviceName.toLowerCase());
    const servicePrice = matchedSvc?.price ?? 25000;

    let appointmentId: string;

    // Si ya existe un intento activo vigente (< 10 min) para este mismo barbero/fecha/horario, reutilizarlo
    const currentActive = readActiveAttempt();
    if (
      currentActive &&
      currentActive.barber === draft.barber &&
      currentActive.date === draft.date &&
      currentActive.time === draft.time
    ) {
      appointmentId = currentActive.appointmentId;
    } else {
      // Crear nueva reserva en estado PENDING con hold de 10 min en Supabase
      const created = await createRealAppointment({
        barber: draft.barber,
        serviceName: draft.serviceName,
        date: draft.date,
        time: draft.time,
        name: draft.name.trim(),
        phone: draft.phone,
        email: draft.email.trim(),
        notes: draft.notes,
      });
      appointmentId = created.appointment_id;

      persistActiveAttempt({
        appointmentId,
        serviceName: draft.serviceName,
        barber: draft.barber,
        date: draft.date,
        time: draft.time,
        clientName: draft.name.trim(),
        clientEmail: draft.email.trim(),
        clientPhone: draft.phone,
        timestamp: Date.now(),
      });
    }

    // Crear orden de Mercado Pago Checkout Pro mediante Orders API en el servidor
    const orderRes = await createBookingOrderFn({
      data: {
        appointmentId,
        serviceName: draft.serviceName,
        barberName: draft.barber,
        servicePrice,
        clientName: draft.name.trim(),
        clientEmail: draft.email.trim(),
        clientPhone: draft.phone,
      },
    });

    const checkoutUrl = orderRes?.checkoutUrl || orderRes?.initPoint;

    if (orderRes?.success && checkoutUrl) {
      if (typeof window !== 'undefined') {
        window.location.assign(checkoutUrl);
      }
      return;
    }

    const err = orderRes?.error || 'ORDER_CREATION_FAILED';
    console.error('[MercadoPagoBooking] Error al crear orden:', err);
    throw new Error('No pudimos iniciar el pago con Mercado Pago. Tus datos no se perdieron. Podés volver a intentarlo.');
  }

  if (confirmed) {
    return (
      <BookingConfirmedScreen
        confirmed={confirmed}
        onHomeClick={startNewReservation}
        homeUrl="/reservar-turno-mercadopago"
      />
    );
  }

  const initialServiceId: ServiceId | undefined = initialAttempt?.serviceName
    ? initialAttempt.serviceName.toLowerCase().includes('barba') && !initialAttempt.serviceName.toLowerCase().includes('corte')
      ? 'barba'
      : initialAttempt.serviceName.toLowerCase().includes('barba')
        ? 'corte-barba'
        : 'corte'
    : undefined;

  return (
    <div className="payway-reservation mercadopago-reservation">
      <Booking
        variant="v3"
        onPaymentRequest={begin}
        paymentActionLabel="Pagar seña de $5.000 con Mercado Pago"
        paymentNotice={
          statusNotice ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm text-amber-600 dark:text-amber-400" role="alert">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse inline-block" />
                <p className="font-semibold">{statusNotice}</p>
              </div>
            </div>
          ) : undefined
        }
        isPaymentChecking={isPaymentChecking}
        initialStep={initialAttempt ? 4 : undefined}
        initialService={initialServiceId}
        initialBarber={(initialAttempt?.barber as Barber) ?? undefined}
        initialDate={initialAttempt?.date}
        initialTime={initialAttempt?.time}
        initialContact={
          initialAttempt?.clientName
            ? {
                name: initialAttempt.clientName,
                email: initialAttempt.clientEmail || '',
                phone: initialAttempt.clientPhone || '',
                notes: '',
              }
            : undefined
        }
      />
    </div>
  );
}
