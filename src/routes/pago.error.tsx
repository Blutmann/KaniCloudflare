import { useEffect, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AlertTriangle, RefreshCcw, ArrowLeft } from 'lucide-react';
import { pageHead } from '@/lib/kani-head';
import { releaseUnpaidBookingHoldFn } from '@/lib/kani-payway.functions';
import { Button } from '@/components/ui/button';
import { LiquidGlassShell } from '@/components/kani/experimental/liquid-glass-shell';

const MP_ACTIVE_ATTEMPT_STORAGE_KEY = 'kani:mercadopago:reservar-active-attempt';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveAbandonedAppointmentId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery =
      params.get('appointment_id') ||
      params.get('external_reference') ||
      params.get('appointmentId');
    if (fromQuery && UUID_PATTERN.test(fromQuery.trim())) {
      return fromQuery.trim();
    }
    const raw = window.sessionStorage.getItem(MP_ACTIVE_ATTEMPT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { appointmentId?: unknown };
      if (typeof parsed?.appointmentId === 'string' && UUID_PATTERN.test(parsed.appointmentId.trim())) {
        return parsed.appointmentId.trim();
      }
    }
  } catch {
    // Ignore storage/URL parsing errors
  }
  return null;
}

export const Route = createFileRoute('/pago/error')({
  head: () =>
    pageHead(
      'Pago No Procesado · Kani Barber Studio',
      'El pago de la seña no pudo completarse.',
      'Kani Barber Studio - Pago No Procesado',
      { noindex: true },
    ),
  component: PagoErrorPage,
});

export function PagoErrorPage() {
  const releasedRef = useRef(false);
  const [holdStatus, setHoldStatus] = useState<'idle' | 'releasing' | 'released' | 'active'>('idle');

  useEffect(() => {
    if (releasedRef.current) return;
    const appointmentId = resolveAbandonedAppointmentId();
    if (!appointmentId) return;

    releasedRef.current = true;
    setHoldStatus('releasing');
    void (async () => {
      try {
        const res = await releaseUnpaidBookingHoldFn({ data: { appointmentId } });
        if (res?.released || res?.status === 'NOT_PENDING') {
          try {
            window.sessionStorage.removeItem(MP_ACTIVE_ATTEMPT_STORAGE_KEY);
          } catch {
            // Ignore sessionStorage removal errors
          }
          setHoldStatus('released');
        } else if (
          res?.status === 'MERCADO_PAGO_ACTIVE_OR_PAID' ||
          res?.status === 'PAYMENT_IN_PROGRESS_OR_PAID'
        ) {
          setHoldStatus('active');
        } else {
          setHoldStatus('idle');
        }
      } catch {
        setHoldStatus('idle');
      }
    })();
  }, []);

  return (
    <LiquidGlassShell section="booking">
      <main className="min-h-[80vh] flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="max-w-md w-full text-center space-y-5 sm:space-y-6 bg-card/85 backdrop-blur-xl border border-rose-500/35 rounded-3xl p-5 sm:p-8 shadow-2xl">
          {/* Icono de error */}
          <div className="mx-auto w-16 h-16 rounded-full bg-rose-500/12 border-2 border-rose-500/40 flex items-center justify-center text-rose-600 shadow-inner">
            <AlertTriangle className="w-8 h-8" aria-hidden="true" />
          </div>

          {/* Título y explicación */}
          <div className="space-y-2">
            <span className="text-xs uppercase tracking-widest text-rose-600 font-semibold">Operación no completada</span>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
              No pudimos procesar el pago
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              La operación fue cancelada o rechazada por Mercado Pago. No se realizó ningún débito de tu cuenta y el turno no fue confirmado.
            </p>
            {holdStatus === 'released' && (
              <p role="status" className="text-xs text-muted-foreground">
                Liberamos la reserva temporal de ese horario para que puedas elegir nuevamente.
              </p>
            )}
            {holdStatus === 'active' && (
              <p role="status" className="text-xs text-amber-600">
                Detectamos un pago en proceso o acreditado en Mercado Pago. Si ya se debitó, recibirás la confirmación por email.
              </p>
            )}
          </div>

          {/* Sugerencias */}
          <div className="rounded-2xl bg-background/60 border border-border/80 p-4 text-xs text-muted-foreground text-left space-y-2">
            <div className="font-semibold text-foreground">¿Por qué ocurrió esto?</div>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Cancelaste la operación en el portal de Mercado Pago.</li>
              <li>Fondos insuficientes o límite de tarjeta excedido.</li>
              <li>Tiempo de sesión de pago expirado (7 minutos).</li>
            </ul>
          </div>

          {/* Acciones para reintentar */}
          <div className="space-y-2.5 pt-2">
            <Button
              asChild
              className="w-full h-11 bg-[#762936] text-white hover:bg-[#8A3342] font-semibold rounded-xl shadow-lg flex items-center justify-center gap-2"
            >
              <Link to="/reservar">
                <RefreshCcw className="w-4 h-4" aria-hidden="true" />
                <span>Reintentar reserva</span>
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              className="w-full h-11 border-border/80 bg-background/60 text-foreground hover:bg-accent/50 font-medium rounded-xl flex items-center justify-center gap-2"
            >
              <Link to="/reservar">
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                <span>Volver al inicio</span>
              </Link>
            </Button>
          </div>
        </div>
      </main>
    </LiquidGlassShell>
  );
}
