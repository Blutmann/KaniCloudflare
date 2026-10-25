import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, MapPin, Calendar, User, Scissors, AlertCircle, ArrowRight } from 'lucide-react';
import { getAppointmentPaymentStatusFn, type AppointmentPaymentStatusResult } from '@/lib/kani-mercadopago.functions';
import { pageHead } from '@/lib/kani-head';
import { checkoutReturnIdentifiers } from '@/lib/kani-payment-return';
import { Button } from '@/components/ui/button';
import {
  KANI_STUDIO_ADDRESS,
  KANI_MAPS_URL,
  formatAppointmentDateTime,
} from '@/lib/kani-constants';

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
              <Link to="/">Volver al inicio</Link>
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

  // Caso 1: Turno confirmado con éxito
  if (result?.isConfirmed) {
    const appt = result.appointment;
    return (
      <main className="min-h-[80vh] flex items-center justify-center px-4 py-10 sm:py-16">
        <div className="max-w-lg w-full space-y-6 bg-card/80 backdrop-blur-md border border-primary/30 rounded-3xl p-6 sm:p-9 shadow-2xl">
          {/* Header de éxito */}
          <div className="text-center space-y-3">
            <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 border-2 border-emerald-500/40 flex items-center justify-center text-emerald-500 shadow-inner">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <div className="space-y-1">
              <span className="text-xs uppercase tracking-widest text-primary font-semibold">Pago Recibido</span>
              <h1 className="text-3xl font-serif font-bold text-foreground tracking-tight">¡Turno confirmado!</h1>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Tu seña de <strong className="text-foreground font-semibold">$5.000 ARS</strong> fue acreditada correctamente.
            </p>
          </div>

          {/* Ficha resumen del turno */}
          {appt && (
            <div className="rounded-2xl border border-border/80 bg-background/60 p-4 sm:p-5 space-y-3.5 text-xs sm:text-sm">
              <div className="flex items-center justify-between pb-3 border-b border-border/60">
                <span className="text-muted-foreground">Solicitud Nº</span>
                <span className="font-mono font-bold text-foreground">#{appt.requestNumber || appt.id.slice(0, 8)}</span>
              </div>

              <div className="flex items-center gap-3">
                <Scissors className="w-4 h-4 text-primary shrink-0" />
                <div className="flex-1 flex justify-between">
                  <span className="text-muted-foreground">Servicio:</span>
                  <strong className="text-foreground font-medium">{appt.serviceName}</strong>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-primary shrink-0" />
                <div className="flex-1 flex justify-between">
                  <span className="text-muted-foreground">Barbero:</span>
                  <strong className="text-foreground font-medium">{appt.barberName}</strong>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-primary shrink-0" />
                <div className="flex-1 flex justify-between">
                  <span className="text-muted-foreground">Fecha y hora:</span>
                  <strong className="text-foreground font-medium">{formatAppointmentDateTime(appt.date, appt.time)}</strong>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1 border-t border-border/60">
                <MapPin className="w-4 h-4 text-primary shrink-0" />
                <div className="flex-1 flex justify-between">
                  <span className="text-muted-foreground">Dirección:</span>
                  <span className="text-foreground font-medium">{KANI_STUDIO_ADDRESS}</span>
                </div>
              </div>
            </div>
          )}

          {/* Aviso de correo electrónico */}
          <div className="rounded-xl bg-primary/10 border border-primary/20 p-3.5 text-center text-xs text-foreground/90 leading-relaxed">
            Te enviamos el resumen de tu turno por correo electrónico. Si no lo encontrás, revisá Spam o Correo no deseado.
          </div>

          {/* Acciones */}
          <div className="space-y-2.5 pt-2">
            <Button asChild className="w-full h-11 bg-primary text-primary-foreground font-semibold rounded-xl shadow-lg">
              <Link to="/">Volver al inicio</Link>
            </Button>
            <Button asChild variant="outline" className="w-full h-11 border-border/80 text-foreground font-medium rounded-xl">
              <a
                href={KANI_MAPS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2"
              >
                <span>Ver en Google Maps</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </a>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // Caso 2: El pago sigue pendiente tras los reintentos
  return (
    <main className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full text-center space-y-6 bg-card/70 backdrop-blur-md border border-border/80 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center text-amber-500">
          <Clock className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <span className="text-xs uppercase tracking-widest text-amber-500 font-semibold">Procesamiento en curso</span>
          <h1 className="text-2xl font-serif font-bold text-foreground tracking-tight">Pago en acreditación</h1>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            Mercado Pago está procesando tu operación. En cuanto se confirme la acreditación, tu turno quedará confirmado automáticamente y te notificaremos por correo electrónico.
          </p>
        </div>

        {result?.appointment && (
          <div className="rounded-xl border border-border/60 bg-background/50 p-4 text-left text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Turno:</span>
              <strong className="text-foreground">{result.appointment.serviceName} con {result.appointment.barberName}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fecha y hora:</span>
              <strong className="text-foreground">{formatAppointmentDateTime(result.appointment.date, result.appointment.time)}</strong>
            </div>
          </div>
        )}

        <div className="pt-2">
          <Button asChild className="w-full h-11 bg-primary text-primary-foreground font-medium rounded-xl">
            <Link to="/">Volver al inicio</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
