import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Calendar, Clock, User, Scissors, Loader2, ShieldAlert, ArrowLeft } from 'lucide-react';
import { getCancellationDetailsFn, confirmCancellationFn, type CancellationDetailsResult } from '@/lib/kani-cancellation.functions';
import { pageHead } from '@/lib/kani-head';
import { formatSpanishDateNatural } from '@/lib/kani-notifications.functions';
import { Button } from '@/components/ui/button';
import { formatServiceName } from '@/lib/kani-model';

export const Route = createFileRoute('/cancelar-turno')({
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === 'string' ? search.id : '',
    token: typeof search.token === 'string' ? search.token : '',
  }),
  head: () =>
    pageHead(
      'Cancelar Turno · Kani Barber Studio',
      'Gestión segura de cancelación de reservas de Kani Barber Studio.',
      'Kani Barber Studio - Cancelar Turno',
    ),
  component: CancelarTurnoPage,
});

function CancelarTurnoPage() {
  const { id: appointmentId, token } = Route.useSearch();

  const [loading, setLoading] = useState(true);
  const [appointment, setAppointment] = useState<CancellationDetailsResult['appointment'] | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);

  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelledSuccess, setCancelledSuccess] = useState(false);
  const [cancelErrorMessage, setCancelErrorMessage] = useState<string | null>(null);
  const [keptTurno, setKeptTurno] = useState(false);

  useEffect(() => {
    if (!appointmentId || !token) {
      setErrorType('INVALID_LINK');
      setLoading(false);
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        const res = await getCancellationDetailsFn({
          data: { appointmentId, token },
        });

        if (!isMounted) return;

        if (!res.ok) {
          setErrorType(res.error || 'SERVER_ERROR');
        } else if (res.appointment) {
          setAppointment(res.appointment);
          if (res.appointment.status === 'CANCELLED') {
            setCancelledSuccess(true);
          }
        }
      } catch (err) {
        if (isMounted) setErrorType('SERVER_ERROR');
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [appointmentId, token]);

  const handleConfirmCancellation = async () => {
    if (isCancelling || cancelledSuccess || !appointmentId || !token) return;

    setIsCancelling(true);
    setCancelErrorMessage(null);

    try {
      const res = await confirmCancellationFn({
        data: { appointmentId, token },
      });

      if (res.ok) {
        setCancelledSuccess(true);
      } else {
        setCancelErrorMessage(res.message || 'No se pudo cancelar el turno. Por favor comunicate con el estudio.');
      }
    } catch (err) {
      setCancelErrorMessage('Ocurrió un error al procesar la cancelación. Por favor intentá nuevamente.');
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <main className="min-h-[85vh] flex items-center justify-center px-4 py-12 bg-background text-foreground">
      <div className="max-w-lg w-full bg-card/90 backdrop-blur-md border border-border/80 rounded-3xl p-6 sm:p-9 shadow-2xl space-y-6">
        
        {/* Estado 1: Cargando */}
        {loading && (
          <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
            <Loader2 className="w-10 h-10 animate-spin text-[#B99A5B]" />
            <p className="text-sm text-muted-foreground font-medium">
              Verificando información del turno...
            </p>
          </div>
        )}

        {/* Estado 2: Error de token o enlace */}
        {!loading && errorType && (
          <div className="space-y-6 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-rose-500/10 border-2 border-rose-500/30 flex items-center justify-center text-rose-500 shadow-inner">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
                {errorType === 'NOT_FOUND' ? 'Turno no encontrado' : 'Enlace no válido o expirado'}
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {errorType === 'NOT_FOUND'
                  ? 'No pudimos encontrar la reserva indicada en nuestro sistema.'
                  : 'Por razones de seguridad, cada enlace de cancelación está protegido criptográficamente y es exclusivo para la reserva original.'}
              </p>
            </div>
            <div className="pt-2">
              <Button asChild variant="outline" className="w-full h-12 rounded-xl text-sm font-medium border-border/80 hover:bg-muted/50">
                <Link to="/">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Volver al inicio
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* Estado 3: Turno conservado por decisión del cliente */}
        {!loading && !errorType && keptTurno && (
          <div className="space-y-6 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-[#B99A5B]/15 border-2 border-[#B99A5B]/40 flex items-center justify-center text-[#B99A5B] shadow-inner">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
                ¡Tu turno sigue confirmado!
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Conservamos tu reserva. Te esperamos en el estudio en el horario previsto.
              </p>
            </div>
            <div className="pt-2">
              <Button asChild className="w-full h-12 rounded-xl text-sm font-semibold bg-[#B99A5B] text-black hover:bg-[#A8894A]">
                <Link to="/">
                  Volver al inicio
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* Estado 4: Turno cancelado con éxito (o ya cancelado previamente) */}
        {!loading && !errorType && !keptTurno && cancelledSuccess && (
          <div className="space-y-6 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-[#762936]/20 border-2 border-[#762936]/40 flex items-center justify-center text-[#E06D80] shadow-inner">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <span className="text-xs uppercase tracking-widest text-[#E06D80] font-semibold">Reserva cancelada</span>
              <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
                Turno cancelado exitosamente
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                El turno fue cancelado y el horario quedó disponible para otros clientes. Te enviamos la confirmación correspondiente a tu correo electrónico.
              </p>
            </div>

            {appointment && (
              <div className="rounded-2xl bg-muted/30 border border-border/70 p-4 text-xs text-left space-y-2 text-muted-foreground">
                <div className="font-semibold text-foreground text-sm border-b border-border/50 pb-1.5">
                  Detalle del turno cancelado
                </div>
                <div className="flex justify-between py-0.5">
                  <span>Servicio:</span>
                  <span className="font-medium text-foreground">{formatServiceName(appointment.serviceName)}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span>Barbero:</span>
                  <span className="font-medium text-foreground">{appointment.barberName}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span>Fecha:</span>
                  <span className="font-medium text-foreground">{formatSpanishDateNatural(appointment.bookingDate)}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span>Hora:</span>
                  <span className="font-medium text-foreground">{appointment.startTime.slice(0, 5)} hs</span>
                </div>
              </div>
            )}

            <div className="space-y-3 pt-2">
              <Button asChild className="w-full h-12 rounded-xl text-sm font-semibold bg-[#B99A5B] text-black hover:bg-[#A8894A]">
                <Link to="/reservar-turno">
                  Reservar un nuevo turno
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full h-12 rounded-xl text-sm font-medium border-border/80 hover:bg-muted/50">
                <Link to="/">
                  Volver al inicio
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* Estado 5: Turno pasado o completado (no cancelable) */}
        {!loading && !errorType && !keptTurno && !cancelledSuccess && appointment && (appointment.isPast || appointment.status === 'COMPLETED' || appointment.status === 'NO_SHOW') && (
          <div className="space-y-6 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center text-amber-500 shadow-inner">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
                Turno ya transcurrido
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Este turno corresponde a una fecha u horario que ya transcurrió, por lo que no es posible procesar una cancelación.
              </p>
            </div>
            <div className="pt-2">
              <Button asChild className="w-full h-12 rounded-xl text-sm font-semibold bg-[#B99A5B] text-black hover:bg-[#A8894A]">
                <Link to="/reservar-turno">
                  Reservar nuevo turno
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* Estado 6: Confirmación interactiva de cancelación */}
        {!loading && !errorType && !keptTurno && !cancelledSuccess && appointment && !appointment.isPast && appointment.status !== 'COMPLETED' && (
          <div className="space-y-6">
            
            {/* Encabezado */}
            <div className="text-center space-y-2">
              <div className="mx-auto w-14 h-14 rounded-full bg-[#762936]/15 border-2 border-[#762936]/30 flex items-center justify-center text-[#E06D80] mb-3">
                <AlertCircle className="w-7 h-7" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
                Cancelar turno
              </h1>
              <p className="text-sm text-muted-foreground">
                ¿Estás seguro de que querés cancelar tu turno con <strong className="text-foreground">{appointment.barberName}</strong>?
              </p>
            </div>

            {/* Tarjeta con detalles de la reserva */}
            <div className="rounded-2xl bg-card border border-border/80 p-5 space-y-3 shadow-inner">
              <div className="flex items-center space-x-3 text-sm">
                <Scissors className="w-4 h-4 text-[#B99A5B] shrink-0" />
                <span className="text-muted-foreground">Servicio:</span>
                <span className="font-semibold text-foreground ml-auto">{formatServiceName(appointment.serviceName)}</span>
              </div>
              <div className="flex items-center space-x-3 text-sm">
                <User className="w-4 h-4 text-[#B99A5B] shrink-0" />
                <span className="text-muted-foreground">Barbero:</span>
                <span className="font-semibold text-foreground ml-auto">{appointment.barberName}</span>
              </div>
              <div className="flex items-center space-x-3 text-sm">
                <Calendar className="w-4 h-4 text-[#B99A5B] shrink-0" />
                <span className="text-muted-foreground">Fecha:</span>
                <span className="font-semibold text-foreground ml-auto capitalize">{formatSpanishDateNatural(appointment.bookingDate)}</span>
              </div>
              <div className="flex items-center space-x-3 text-sm">
                <Clock className="w-4 h-4 text-[#B99A5B] shrink-0" />
                <span className="text-muted-foreground">Hora:</span>
                <span className="font-semibold text-foreground ml-auto">{appointment.startTime.slice(0, 5)} hs</span>
              </div>
            </div>

            {/* Aviso sobre política de reserva */}
            <div className="rounded-xl bg-muted/40 border border-border/50 p-4 text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground font-medium block mb-1">Políticas de reserva:</strong>
              Al cancelar, el horario se libera inmediatamente para otros clientes. Según nuestras políticas, la seña abonada no es reembolsable.
            </div>

            {cancelErrorMessage && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs text-center font-medium">
                {cancelErrorMessage}
              </div>
            )}

            {/* Acciones principales */}
            <div className="space-y-3 pt-2">
              <Button
                type="button"
                onClick={handleConfirmCancellation}
                disabled={isCancelling}
                className="w-full h-12 rounded-xl text-sm font-semibold transition-opacity"
                style={{ backgroundColor: '#762936', color: '#FFFFFF' }}
              >
                {isCancelling ? (
                  <span className="flex items-center justify-center">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Cancelando turno...
                  </span>
                ) : (
                  'Sí, cancelar turno'
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => setKeptTurno(true)}
                disabled={isCancelling}
                className="w-full h-12 rounded-xl text-sm font-medium border-border/80 hover:bg-muted/50"
              >
                Conservar mi turno
              </Button>
            </div>

          </div>
        )}

      </div>
    </main>
  );
}
