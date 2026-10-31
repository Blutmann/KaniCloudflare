import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Clock, Scissors, User, Calendar, MapPin, AlertCircle } from 'lucide-react';
import { getAppointmentPaymentStatusFn, type AppointmentPaymentStatusResult } from '@/lib/kani-mercadopago.functions';
import { pageHead } from '@/lib/kani-head';
import { Button } from '@/components/ui/button';
import {
  KANI_STUDIO_ADDRESS,
  formatAppointmentDateTime,
} from '@/lib/kani-constants';

export const Route = createFileRoute('/pago/pendiente')({
  head: () =>
    pageHead(
      'Pago Pendiente · Kani Barber Studio',
      'Tu pago está pendiente de acreditación en Mercado Pago.',
      'Kani Barber Studio - Pago Pendiente',
    ),
  component: PagoPendientePage,
});

function PagoPendientePage() {
  const searchParams = Route.useSearch() as Record<string, string | undefined>;
  const appointmentId = searchParams.appointment_id || searchParams.external_reference;

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<AppointmentPaymentStatusResult | null>(null);

  useEffect(() => {
    if (!appointmentId) {
      setLoading(false);
      return;
    }

    let isMounted = true;
    void getAppointmentPaymentStatusFn({
      data: { appointmentId },
    })
      .then((res) => {
        if (isMounted) {
          setResult(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('[PagoPendiente] Error consultando estado:', err);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [appointmentId]);

  return (
    <main className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full text-center space-y-6 bg-card/70 backdrop-blur-md border border-amber-500/30 rounded-3xl p-6 sm:p-9 shadow-2xl">
        {/* Icono y título */}
        <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 border-2 border-amber-500/40 flex items-center justify-center text-amber-500 shadow-inner">
          <Clock className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <span className="text-xs uppercase tracking-widest text-amber-500 font-semibold">Mercado Pago</span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
            Pago pendiente de confirmación
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            Tu pago aún no se acreditó en Mercado Pago (típico en pagos en efectivo o transferencias en procesamiento).
          </p>
        </div>

        {/* Explicación del circuito */}
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4 text-xs text-foreground/90 text-left space-y-1.5 leading-relaxed">
          <div className="font-semibold text-amber-500 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>¿Qué sucede ahora?</span>
          </div>
          <p>
            En cuanto Mercado Pago confirme la acreditación del pago, nuestro sistema <strong>confirmará tu turno automáticamente</strong> y te enviaremos el comprobante oficial por correo electrónico.
          </p>
        </div>

        {/* Detalle del turno si está disponible */}
        {result?.appointment && (
          <div className="rounded-2xl border border-border/80 bg-background/60 p-4 space-y-2.5 text-xs text-left">
            <div className="flex justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Solicitud:</span>
              <span className="font-mono font-bold text-foreground">#{result.appointment.requestNumber || result.appointment.id.slice(0, 8)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5"><Scissors className="w-3.5 h-3.5 text-primary" /> Servicio:</span>
              <strong className="text-foreground">{result.appointment.serviceName}</strong>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-primary" /> Barbero:</span>
              <strong className="text-foreground">{result.appointment.barberName}</strong>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-primary" /> Fecha y hora:</span>
              <strong className="text-foreground">{formatAppointmentDateTime(result.appointment.date, result.appointment.time)}</strong>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-border/60">
              <span className="text-muted-foreground flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-primary" /> Dirección:</span>
              <span className="text-foreground">{KANI_STUDIO_ADDRESS}</span>
            </div>
          </div>
        )}

        {/* Botón de acción */}
        <div className="pt-2">
          <Button asChild className="w-full h-11 bg-primary text-primary-foreground font-semibold rounded-xl shadow-lg">
            <Link to="/reservar-turno-mercadopago">Volver al inicio</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
