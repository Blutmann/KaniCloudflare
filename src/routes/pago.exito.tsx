import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Clock, AlertCircle } from 'lucide-react';
import { getAppointmentPaymentStatusFn, type AppointmentPaymentStatusResult } from '@/lib/kani-mercadopago.functions';
import { pageHead } from '@/lib/kani-head';
import { checkoutReturnIdentifiers } from '@/lib/kani-payment-return';
import { Button } from '@/components/ui/button';
import { BookingConfirmedScreen, type ConfirmedBookingData } from '@/components/kani/booking-confirmed-screen';
import { KANI_STANDARD_DEPOSIT_ARS } from '@/lib/kani-constants';
import '@/components/kani/experimental/reserva-v2.css';
import '@/components/kani/experimental/reserva-v3.css';
import '@/components/kani/experimental/reserva-v4.css';

export const Route = createFileRoute('/pago/exito')({
  head: () =>
    pageHead(
      'Pago Confirmado · Kani Barber Studio',
      'Tu pago fue acreditado y tu turno en Kani Barber Studio está confirmado.',
      'Kani Barber Studio - Pago Exitoso',
    ),
  component: PagoExitoPage,
});

function PagoExitoPage() {
  const { appointmentId, orderId, paymentId } = checkoutReturnIdentifiers(
    Route.useSearch() as Record<string, unknown>,
  );

  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [result, setResult] = useState<AppointmentPaymentStatusResult | null>(null);

  useEffect(() => {
    if (!appointmentId) {
      setLoading(false);
      return;
    }

    let isMounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const checkStatus = async () => {
      try {
        const res = await getAppointmentPaymentStatusFn({
          data: {
            appointmentId,
            orderId: orderId?.trim() || undefined,
            paymentId: paymentId?.trim() || undefined,
          },
        });

        if (!isMounted) return;

        setResult(res);

        // Si aún está en PENDING y llevamos menos de 3 reintentos, reintentar a los 2.5s (race condition resolution)
        if (!res.isConfirmed && res.appointmentStatus === 'PENDING' && retryCount < 3) {
          timer = setTimeout(() => {
            if (isMounted) setRetryCount((c) => c + 1);
          }, 2500);
        } else {
          setLoading(false);
        }
      } catch (err) {
        if (!isMounted) return;
        setLoading(false);
        console.error('[PagoExito] Error consultando estado:', err);
      }
    };

    void checkStatus();

    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [appointmentId, orderId, paymentId, retryCount]);

  // Si no se proveyó ID de turno
  if (!appointmentId) {
    return (
      <main className="min-h-[75vh] flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full text-center space-y-5 bg-card/60 backdrop-blur-md border border-border/70 rounded-2xl p-6 sm:p-8 shadow-xl">
          <div className="mx-auto w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-foreground tracking-tight">Referencia no encontrada</h1>
          <p className="text-sm text-muted-foreground">
            No se identificó el identificador del turno para verificar el pago. Si realizaste una transferencia o pago, podés consultar tu turno desde el inicio.
          </p>
          <div className="pt-2">
            <Button asChild className="w-full h-11 bg-primary text-primary-foreground font-medium rounded-xl">
              <Link to="/reservar-turno-mercadopago">Volver al inicio</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // Estado de carga o resolución de race condition
  if (loading) {
    return (
      <main className="min-h-[75vh] flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full text-center space-y-6 bg-card/60 backdrop-blur-md border border-border/70 rounded-2xl p-8 shadow-xl">
          <div className="relative mx-auto w-16 h-16 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <Clock className="w-7 h-7 text-primary animate-pulse" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-serif font-bold text-foreground tracking-tight">Estamos confirmando tu pago</h1>
            <p className="text-sm text-muted-foreground">
              Verificando la acreditación con Mercado Pago y reservando tu turno en el local…
            </p>
          </div>
          <div className="text-xs text-muted-foreground/80 font-mono">
            {retryCount > 0 ? `Verificación en curso (${retryCount}/3)…` : 'Conectando con el servidor seguro…'}
          </div>
        </div>
      </main>
    );
  }

  // Caso 1: Turno confirmado con éxito — Renderiza la pantalla final idéntica a Reserva V4
  if (result?.isConfirmed && result.appointment) {
    const appt = result.appointment;
    const confirmedData: ConfirmedBookingData = {
      appointmentId: appt.id,
      serviceName: appt.serviceName ?? 'Servicio Kani',
      barber: appt.barberName ?? 'Lautaro',
      date: appt.date ?? '',
      time: (appt.time ?? '').slice(0, 5),
      clientName: appt.clientName ?? '',
      depositArs: appt.depositAmountArs ?? KANI_STANDARD_DEPOSIT_ARS,
      servicePriceArs: appt.servicePriceArs ?? 25000,
    };

    return (
      <BookingConfirmedScreen
        confirmed={confirmedData}
        homeUrl="/reservar-turno-mercadopago"
      />
    );
  }

  // Caso 2: El turno fue cancelado o expiró
  if (result?.appointmentStatus === 'CANCELLED') {
    return (
      <main className="min-h-[75vh] flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full text-center space-y-5 bg-card/60 backdrop-blur-md border border-rose-500/30 rounded-2xl p-6 sm:p-8 shadow-xl">
          <div className="mx-auto w-14 h-14 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-500">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-foreground tracking-tight">Turno no disponible</h1>
          <p className="text-sm text-muted-foreground">
            El tiempo límite de 10 minutos para abonar la seña expiró o la operación fue cancelada. El horario fue liberado.
          </p>
          <div className="pt-2">
            <Button asChild className="w-full h-11 bg-primary text-primary-foreground font-medium rounded-xl">
              <Link to="/reservar-turno-mercadopago">Elegir otro horario</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // Caso 3: Estado pendiente persistente
  return (
    <main className="min-h-[75vh] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full text-center space-y-5 bg-card/60 backdrop-blur-md border border-amber-500/30 rounded-2xl p-6 sm:p-8 shadow-xl">
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
          <Clock className="w-7 h-7" />
        </div>
        <h1 className="text-2xl font-serif font-bold text-foreground tracking-tight">Pago en proceso</h1>
        <p className="text-sm text-muted-foreground">
          Mercado Pago está procesando la acreditación de tu seña. Tu turno se confirmará automáticamente al completarse.
        </p>
        <div className="pt-2 flex flex-col gap-2">
          <Button
            className="w-full h-11 bg-primary text-primary-foreground font-medium rounded-xl"
            onClick={() => {
              setLoading(true);
              setRetryCount(0);
            }}
          >
            Comprobar nuevamente
          </Button>
          <Button asChild variant="outline" className="w-full h-11 rounded-xl">
            <Link to="/reservar-turno-mercadopago">Volver al inicio</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
