import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Calendar,
  Clock,
  User,
  Scissors,
  Loader2,
  ShieldAlert,
  ArrowLeft,
  ArrowRight,
  MessageCircle,
} from 'lucide-react';
import {
  getCancellationDetailsFn,
  confirmCancellationFn,
  type CancellationDetailsResult,
} from '@/lib/kani-cancellation.functions';
import { pageHead } from '@/lib/kani-head';
import { formatSpanishDateNatural } from '@/lib/kani-notifications.functions';
import { Button } from '@/components/ui/button';
import { formatServiceName } from '@/lib/kani-model';
import { LiquidGlassShell } from '@/components/kani/experimental/liquid-glass-shell';
import { KANI_PUBLIC_WHATSAPP_URL } from '@/lib/kani-constants';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export const Route = createFileRoute('/cancelar-turno')({
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === 'string' ? search.id : '',
    token: typeof search.token === 'string' ? search.token : '',
  }),
  head: ({ match }) => {
    const search = match?.search as { id?: string; token?: string } | undefined;
    const hasTokenParams = Boolean(search?.id || search?.token);
    return pageHead(
      'Cancelar Turno · Kani Barber Studio',
      'Gestión segura de cancelación de reservas en Kani Barber Studio.',
      'Kani · Cancelar turno',
      {
        canonicalPath: '/cancelar-turno',
        ogTitle: 'Kani Barber Studio · Cancelar turno',
        noindex: hasTokenParams,
      },
    );
  },
  component: CancelarTurnoPage,
});

function WhatsAppIcon({ className, size = 18 }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  );
}

function CancelarTurnoPage() {
  const { id: appointmentId, token } = Route.useSearch();

  const [loading, setLoading] = useState(true);
  const [appointment, setAppointment] = useState<CancellationDetailsResult['appointment'] | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
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
      } catch {
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
        setShowConfirmModal(false);
        setCancelledSuccess(true);
      } else {
        setShowConfirmModal(false);
        setCancelErrorMessage(
          res.message || 'No se pudo cancelar el turno. Por favor comunicate directamente con el estudio.',
        );
      }
    } catch {
      setShowConfirmModal(false);
      setCancelErrorMessage('Ocurrió un error al procesar la cancelación. Por favor intentá nuevamente.');
    } finally {
      setIsCancelling(false);
    }
  };

  const whatsAppHelpUrl = `${KANI_PUBLIC_WHATSAPP_URL}?text=${encodeURIComponent(
    appointment
      ? `Hola, quisiera consultar por mi turno del ${formatSpanishDateNatural(appointment.bookingDate)} a las ${appointment.startTime.slice(0, 5)} hs con ${appointment.barberName}.`
      : 'Hola, quisiera hacer una consulta sobre la cancelación de un turno.',
  )}`;

  return (
    <LiquidGlassShell section="cancellation">
      <main className="cancellation-page-wrap">
        <div className="cancellation-card">
          {/* ESTADO 1: Cargando */}
          {loading && (
            <div className="py-14 flex flex-col items-center justify-center space-y-4 text-center" role="status">
              <div className="relative flex items-center justify-center">
                <span className="absolute w-12 h-12 rounded-full bg-[#B99A5B]/20 animate-ping" />
                <Loader2 className="w-10 h-10 animate-spin text-[#B99A5B] relative z-10" />
              </div>
              <p className="text-sm text-muted-foreground font-medium tracking-wide">
                Verificando información del turno…
              </p>
            </div>
          )}

          {/* ESTADO 2: Error de token o enlace no válido */}
          {!loading && errorType && (
            <div className="space-y-6 text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-500 shadow-inner">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
                  {errorType === 'NOT_FOUND' ? 'Turno no encontrado' : 'Enlace no válido o expirado'}
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
                  {errorType === 'NOT_FOUND'
                    ? 'No pudimos encontrar la reserva indicada en nuestro sistema.'
                    : 'Por razones de seguridad, cada enlace de cancelación es personal y está protegido criptográficamente.'}
                </p>
              </div>
              <div className="pt-2 space-y-3">
                <Button
                  asChild
                  className="w-full h-12 rounded-xl text-sm font-semibold bg-[#B99A5B] text-black hover:bg-[#A8894A] transition-colors"
                >
                  <Link to="/reservar">
                    Reservar un turno
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="w-full h-12 rounded-xl text-sm font-medium border-border/80 hover:bg-muted/50"
                >
                  <a href={whatsAppHelpUrl} target="_blank" rel="noopener noreferrer">
                    <WhatsAppIcon className="mr-2 text-[#25D366]" />
                    Consultar por WhatsApp
                  </a>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  className="w-full min-h-[44px] h-12 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <Link to="/">
                    <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                    Volver al inicio
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {/* ESTADO 3: Turno conservado por decisión del cliente */}
          {!loading && !errorType && keptTurno && (
            <div className="space-y-6 text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-[#B99A5B]/15 border border-[#B99A5B]/40 flex items-center justify-center text-[#B99A5B] shadow-inner">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
                  ¡Tu turno sigue confirmado!
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
                  Conservamos tu reserva. Te esperamos en el estudio en el horario previsto.
                </p>
              </div>
              <div className="pt-2 space-y-3">
                <Button
                  asChild
                  className="w-full h-12 rounded-xl text-sm font-semibold bg-[#B99A5B] text-black hover:bg-[#A8894A] transition-colors"
                >
                  <Link to="/">
                    Volver al inicio
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {/* ESTADO 4: Turno cancelado con éxito (o ya cancelado previamente) */}
          {!loading && !errorType && !keptTurno && cancelledSuccess && (
            <div className="space-y-6 text-center">
              <div className="cancellation-status-icon mx-auto w-16 h-16 rounded-full bg-[#762936]/20 border border-[#762936]/40 flex items-center justify-center text-[#702B3A] dark:text-[#E06D80] shadow-inner">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <span className="cancellation-status-badge inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[#762936]/15 text-[#702B3A] dark:text-[#E06D80] border border-[#762936]/35">
                  Reserva cancelada
                </span>
                <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
                  Turno cancelado exitosamente
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
                  El turno fue cancelado y el horario quedó disponible para otros clientes. Te enviamos la confirmación correspondiente a tu correo electrónico.
                </p>
              </div>

              {appointment && (
                <div className="cancellation-details-box rounded-2xl p-5 text-xs text-left space-y-2.5 text-muted-foreground">
                  <div className="font-semibold text-foreground text-sm border-b border-border/50 pb-2">
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
                    <span className="font-medium text-foreground capitalize">
                      {formatSpanishDateNatural(appointment.bookingDate)}
                    </span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span>Hora:</span>
                    <span className="font-medium text-foreground">{appointment.startTime.slice(0, 5)} hs</span>
                  </div>
                </div>
              )}

              <div className="space-y-3 pt-2">
                <Button
                  asChild
                  className="w-full h-12 rounded-xl text-sm font-semibold bg-[#B99A5B] text-black hover:bg-[#A8894A] transition-colors"
                >
                  <Link to="/reservar">
                    Reservar un nuevo turno
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="w-full h-12 rounded-xl text-sm font-medium border-border/80 hover:bg-muted/50"
                >
                  <Link to="/">
                    Volver al inicio
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {/* ESTADO 5: Turno transcurrido o completado (no cancelable) */}
          {!loading &&
            !errorType &&
            !keptTurno &&
            !cancelledSuccess &&
            appointment &&
            (appointment.isPast || appointment.status === 'COMPLETED' || appointment.status === 'NO_SHOW') && (
              <div className="space-y-6 text-center">
                <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 shadow-inner">
                  <AlertCircle className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
                    Turno ya transcurrido
                  </h1>
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
                    Este turno corresponde a una fecha u horario que ya transcurrió, por lo que no es posible procesar una cancelación online.
                  </p>
                </div>
                <div className="pt-2 space-y-3">
                  <Button
                    asChild
                    className="w-full h-12 rounded-xl text-sm font-semibold bg-[#B99A5B] text-black hover:bg-[#A8894A] transition-colors"
                  >
                    <Link to="/reservar">
                      Reservar un nuevo turno
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="w-full h-12 rounded-xl text-sm font-medium border-border/80 hover:bg-muted/50"
                  >
                    <Link to="/">
                      Volver al inicio
                    </Link>
                  </Button>
                </div>
              </div>
            )}

          {/* ESTADO 6: Restricción de 24 horas vigente (< 24 hs antes del turno) */}
          {!loading &&
            !errorType &&
            !keptTurno &&
            !cancelledSuccess &&
            appointment &&
            !appointment.isPast &&
            appointment.status !== 'COMPLETED' &&
            appointment.isWithin24Hours && (
              <div className="space-y-6 text-center">
                <div className="mx-auto w-16 h-16 rounded-full bg-[#B99A5B]/15 border border-[#B99A5B]/35 flex items-center justify-center text-[#B99A5B] shadow-inner">
                  <Clock className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[#B99A5B]/15 text-[#B99A5B] border border-[#B99A5B]/30">
                    Cancelación online no disponible
                  </span>
                  <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
                    Menos de 24 horas de anticipación
                  </h1>
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
                    Por políticas del estudio, las cancelaciones online autónomas deben realizarse con al menos 24 horas de anticipación para permitir la reorganización de la agenda.
                  </p>
                </div>

                {/* Detalle del turno reservado */}
                <div className="cancellation-details-box rounded-2xl p-5 text-xs text-left space-y-2.5 text-muted-foreground">
                  <div className="font-semibold text-foreground text-sm border-b border-border/50 pb-2">
                    Tu turno agendado
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
                    <span className="font-medium text-foreground capitalize">
                      {formatSpanishDateNatural(appointment.bookingDate)}
                    </span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span>Hora:</span>
                    <span className="font-medium text-foreground">{appointment.startTime.slice(0, 5)} hs</span>
                  </div>
                </div>

                <div className="cancellation-policy-box rounded-xl p-4 text-xs leading-relaxed text-left">
                  <strong className="font-semibold block mb-1">¿Tuviste un imprevisto?</strong>
                  Si necesitás reprogramar o avisar al equipo, contactanos de inmediato por WhatsApp para evaluar tu caso.
                </div>

                <div className="pt-2 space-y-3">
                  <Button
                    asChild
                    className="w-full h-12 rounded-xl text-sm font-semibold bg-[#25D366] text-black hover:bg-[#20BA5A] transition-colors"
                  >
                    <a href={whatsAppHelpUrl} target="_blank" rel="noopener noreferrer">
                      <WhatsAppIcon className="mr-2 text-black" />
                      Contactar por WhatsApp
                    </a>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="w-full h-12 rounded-xl text-sm font-medium border-border/80 hover:bg-muted/50"
                  >
                    <Link to="/">
                      Volver al inicio
                    </Link>
                  </Button>
                </div>
              </div>
            )}

          {/* ESTADO 7: Confirmación interactiva de cancelación (> 24 hs) */}
          {!loading &&
            !errorType &&
            !keptTurno &&
            !cancelledSuccess &&
            appointment &&
            !appointment.isPast &&
            appointment.status !== 'COMPLETED' &&
            !appointment.isWithin24Hours && (
              <div className="space-y-6">
                {/* Encabezado */}
                <div className="text-center space-y-2">
                  <div className="cancellation-status-icon mx-auto w-14 h-14 rounded-full bg-[#762936]/15 border border-[#762936]/35 flex items-center justify-center text-[#702B3A] dark:text-[#E06D80] mb-3">
                    <AlertCircle className="w-7 h-7" />
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground tracking-tight">
                    Cancelar turno
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    ¿Estás seguro de que querés cancelar tu turno con{' '}
                    <strong className="text-foreground">{appointment.barberName}</strong>?
                  </p>
                </div>

                {/* Tarjeta con detalles de la reserva */}
                <div className="cancellation-details-box rounded-2xl p-5 space-y-3 shadow-inner">
                  <div className="flex items-center space-x-3 text-sm">
                    <Scissors className="w-4 h-4 text-[#B99A5B] shrink-0" />
                    <span className="text-muted-foreground">Servicio:</span>
                    <span className="font-semibold text-foreground ml-auto">
                      {formatServiceName(appointment.serviceName)}
                    </span>
                  </div>
                  <div className="flex items-center space-x-3 text-sm">
                    <User className="w-4 h-4 text-[#B99A5B] shrink-0" />
                    <span className="text-muted-foreground">Barbero:</span>
                    <span className="font-semibold text-foreground ml-auto">{appointment.barberName}</span>
                  </div>
                  <div className="flex items-center space-x-3 text-sm">
                    <Calendar className="w-4 h-4 text-[#B99A5B] shrink-0" />
                    <span className="text-muted-foreground">Fecha:</span>
                    <span className="font-semibold text-foreground ml-auto capitalize">
                      {formatSpanishDateNatural(appointment.bookingDate)}
                    </span>
                  </div>
                  <div className="flex items-center space-x-3 text-sm">
                    <Clock className="w-4 h-4 text-[#B99A5B] shrink-0" />
                    <span className="text-muted-foreground">Hora:</span>
                    <span className="font-semibold text-foreground ml-auto">
                      {appointment.startTime.slice(0, 5)} hs
                    </span>
                  </div>
                </div>

                {/* Aviso sobre política de reserva */}
                <div className="cancellation-policy-box rounded-xl p-4 text-xs leading-relaxed">
                  <strong className="font-semibold block mb-1">Políticas de reserva:</strong>
                  Al cancelar, el horario se libera inmediatamente para otros clientes. Según nuestras políticas, la
                  seña abonada no es reembolsable.
                </div>

                {cancelErrorMessage && (
                  <div
                    role="alert"
                    className="cancellation-error-alert p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-800 dark:text-rose-300 text-xs text-center font-medium"
                  >
                    {cancelErrorMessage}
                  </div>
                )}

                {/* Acciones principales */}
                <div className="space-y-3 pt-2">
                  <Button
                    type="button"
                    onClick={() => setShowConfirmModal(true)}
                    disabled={isCancelling}
                    className="w-full h-12 rounded-xl text-sm font-semibold transition-all bg-[#702B3A] text-white hover:bg-[#5A222E]"
                  >
                    Cancelar turno
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

      {/* Modal explícito de confirmación */}
      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent
          transitionMode="container-transform"
          className="max-w-md w-[92vw] rounded-2xl p-6 border border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl"
          style={{ translate: 'none' }}
        >
          <DialogHeader className="space-y-2 text-center sm:text-left">
            <DialogTitle className="text-xl font-serif font-bold text-foreground">
              ¿Confirmar cancelación?
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              Esta acción no se puede deshacer. Tu horario se liberará inmediatamente para otros clientes y, según las
              políticas del estudio, la seña no es reembolsable.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={isCancelling}
              onClick={() => setShowConfirmModal(false)}
              className="w-full sm:w-auto min-h-[44px] h-12 rounded-xl"
            >
              No, conservar turno
            </Button>
            <Button
              type="button"
              disabled={isCancelling}
              onClick={handleConfirmCancellation}
              className="w-full sm:w-auto min-h-[44px] h-12 rounded-xl bg-[#702B3A] text-white hover:bg-[#5A222E]"
            >
              {isCancelling ? (
                <span className="flex items-center justify-center">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cancelando…
                </span>
              ) : (
                'Sí, cancelar turno'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LiquidGlassShell>
  );
}