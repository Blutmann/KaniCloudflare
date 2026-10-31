import { createFileRoute, Link } from '@tanstack/react-router';
import { AlertTriangle, RefreshCcw, ArrowLeft } from 'lucide-react';
import { pageHead } from '@/lib/kani-head';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/pago/error')({
  head: () =>
    pageHead(
      'Pago No Procesado · Kani Barber Studio',
      'El pago de la seña no pudo completarse.',
      'Kani Barber Studio - Pago No Procesado',
    ),
  component: PagoErrorPage,
});

function PagoErrorPage() {
  const searchParams = Route.useSearch() as Record<string, string | undefined>;
  const appointmentId = searchParams.appointment_id || searchParams.external_reference;

  return (
    <main className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full text-center space-y-6 bg-card/70 backdrop-blur-md border border-rose-500/30 rounded-3xl p-6 sm:p-9 shadow-2xl">
        {/* Icono de error */}
        <div className="mx-auto w-16 h-16 rounded-full bg-rose-500/10 border-2 border-rose-500/40 flex items-center justify-center text-rose-500 shadow-inner">
          <AlertTriangle className="w-8 h-8" />
        </div>

        {/* Título y explicación */}
        <div className="space-y-2">
          <span className="text-xs uppercase tracking-widest text-rose-500 font-semibold">Operación no completada</span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
            No pudimos procesar el pago
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            La operación fue cancelada o rechazada por Mercado Pago. No se realizó ningún débito de tu cuenta y el turno no fue confirmado.
          </p>
        </div>

        {/* Sugerencias */}
        <div className="rounded-2xl bg-card border border-border/80 p-4 text-xs text-muted-foreground text-left space-y-2">
          <div className="font-semibold text-foreground">¿Por qué ocurrió esto?</div>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground/90">
            <li>Cancelaste la operación en el portal de Mercado Pago.</li>
            <li>Fondos insuficientes o límite de tarjeta excedido.</li>
            <li>Tiempo de sesión de pago expirado (10 minutos).</li>
          </ul>
        </div>

        {/* Acciones para reintentar */}
        <div className="space-y-2.5 pt-2">
          <Button asChild className="w-full h-11 bg-primary text-primary-foreground font-semibold rounded-xl shadow-lg flex items-center justify-center gap-2">
            <Link to="/reservar-turno-mercadopago" search={appointmentId ? { appointment_id: appointmentId } : undefined}>
              <RefreshCcw className="w-4 h-4" />
              <span>Reintentar reserva</span>
            </Link>
          </Button>

          <Button asChild variant="outline" className="w-full h-11 border-border/80 text-foreground font-medium rounded-xl flex items-center justify-center gap-2">
            <Link to="/reservar-turno-mercadopago">
              <ArrowLeft className="w-4 h-4" />
              <span>Volver al inicio</span>
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
