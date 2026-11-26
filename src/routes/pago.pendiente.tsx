import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Clock, Scissors, User, Calendar, MapPin, AlertCircle } from 'lucide-react';
import { getAppointmentPaymentStatusFn, type AppointmentPaymentStatusResult } from '@/lib/kani-mercadopago.functions';
import { pageHead } from '@/lib/kani-head';
import { checkoutReturnIdentifiers } from '@/lib/kani-payment-return';
import { clearBookingDraft } from '@/lib/kani-booking-draft';
import { Button } from '@/components/ui/button';
import { BookingConfirmedScreen, type ConfirmedBookingData } from '@/components/kani/booking-confirmed-screen';
import { LiquidGlassShell } from '@/components/kani/experimental/liquid-glass-shell';
import {
  KANI_STANDARD_DEPOSIT_ARS,
  KANI_STUDIO_ADDRESS,
  formatAppointmentDateTime,
} from '@/lib/kani-constants';
import '@/components/kani/experimental/reserva-v2.css';
import '@/components/kani/experimental/reserva-v3.css';
import '@/components/kani/experimental/reserva-v4.css';

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
  const { appointmentId, orderId, paymentId } = checkoutReturnIdentifiers(
    Route.useSearch() as Record<string, unknown>,
  );

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<AppointmentPaymentStatusResult | null>(null);

  useEffect(() => {
    if (!appointmentId) {
      setLoading(false);
      return;
    }

    let isMounted = true;
    void getAppointmentPaymentStatusFn({
      data: {
        appointmentId,
        orderId: orderId?.trim() || undefined,
        paymentId: paymentId?.trim() || undefined,
      },
    })
      .then((res) => {
        if (isMounted) {
          if (res.isConfirmed) {
            clearBookingDraft();
            try {
              window.sessionStorage.removeItem('kani:mercadopago:reservar-active-attempt');
            } catch {
              /* best effort */
            }
          }
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
  }, [appointmentId, orderId, paymentId]);

  if (!loading && result?.isConfirmed && result.appointment) {
    const appt = result.appointment;
    const confirmedData: ConfirmedBookingData = {
      appointmentId: appt.id,
      serviceName: appt.serviceName ?? 'Servicio Kani',
      barber: appt.barberName ?? 'Gonzalo',
      date: appt.date ?? '',
      time: (appt.time ?? '').slice(0, 5),
      clientName: appt.clientName ?? '',
      depositArs: typeof appt.depositAmountArs === 'number' ? appt.depositAmountArs : KANI_STANDARD_DEPOSIT_ARS,
      servicePriceArs: appt.servicePriceArs ?? 25000,
      benefitType: appt.benefitType ?? null,
      benefitCode: appt.benefitCode ?? null,
      originalPriceArs: appt.originalPriceArs ?? null,
      discountAmountArs: appt.discountAmountArs ?? null,
      finalPriceArs: appt.finalPriceArs ?? null,
      onlineDepositArs: appt.onlineDepositArs ?? null,
      inPersonBalanceArs: appt.inPersonBalanceArs ?? null,
    };

    return (
      <LiquidGlassShell section="booking">
        <BookingConfirmedScreen confirmed={confirmedData} homeUrl="/reservar" />
      </LiquidGlassShell>
    );
  }

  return (
    <LiquidGlassShell section="booking">
      <main className="min-h-[80vh] flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="max-w-md w-full text-center space-y-5 sm:space-y-6 bg-card/85 backdrop-blur-xl border border-amber-500/35 rounded-3xl p-5 sm:p-8 shadow-2xl">
          {/* Icono y título */}
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/12 border-2 border-amber-500/40 flex items-center justify-center text-amber-600 shadow-inner">
            <Clock className="w-8 h-8" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            <span className="text-xs uppercase tracking-widest text-amber-700 font-semibold">Mercado Pago</span>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
              Pago pendiente de confirmación
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Tu pago aún no se acreditó en Mercado Pago (típico en pagos en efectivo o transferencias en procesamiento).
            </p>
          </div>

          {/* Explicación del circuito */}
          <div className="rounded-2xl bg-amber-500/12 border border-amber-500/25 p-4 text-xs text-foreground text-left space-y-1.5 leading-relaxed">
            <div className="font-semibold text-amber-700 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>¿Qué sucede ahora?</span>
            </div>
            <p className="text-foreground/90">
              En cuanto Mercado Pago confirme la acreditación del pago, nuestro sistema <strong>confirmará tu turno automáticamente</strong> y te enviaremos el comprobante oficial por correo electrónico.
            </p>
          </div>

          {/* Detalle del turno si está disponible */}
          {!loading && result?.appointment && (
            <div className="rounded-2xl border border-border/80 bg-background/60 p-4 space-y-2.5 text-xs text-left">
              <div className="flex justify-between gap-2 border-b border-border/60 pb-2">
                <span className="text-muted-foreground">Reserva:</span>
                <span className="font-mono font-bold text-foreground">#{result.appointment.requestNumber || result.appointment.id.slice(0, 8)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground flex items-center gap-1.5"><Scissors className="w-3.5 h-3.5 text-[#762936]" aria-hidden="true" /> Servicio:</span>
                <strong className="text-foreground text-right">{result.appointment.serviceName}</strong>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-[#762936]" aria-hidden="true" /> Barbero:</span>
                <strong className="text-foreground text-right">{result.appointment.barberName}</strong>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-[#762936]" aria-hidden="true" /> Fecha y hora:</span>
                <strong className="text-foreground text-right">{formatAppointmentDateTime(result.appointment.date, result.appointment.time)}</strong>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
                <span className="text-muted-foreground flex items-center gap-1.5 shrink-0"><MapPin className="w-3.5 h-3.5 text-[#762936]" aria-hidden="true" /> Dirección:</span>
                <span className="text-foreground text-right">{KANI_STUDIO_ADDRESS}</span>
              </div>
            </div>
          )}

          {/* Botón de acción */}
          <div className="pt-2">
            <Button asChild className="w-full h-11 bg-[#762936] text-white hover:bg-[#8A3342] font-semibold rounded-xl shadow-lg">
              <Link to="/reservar">Volver al inicio</Link>
            </Button>
          </div>
        </div>
      </main>
    </LiquidGlassShell>
  );
}
