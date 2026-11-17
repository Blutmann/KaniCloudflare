import { AlertTriangle, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';

export type SmartConfirmationPhase = 'idle' | 'processing' | 'prolonged' | 'error';

export type SmartConfirmationErrorKind =
  | 'zero_deposit'
  | 'prepare'
  | 'tokenize'
  | 'payment_rejected'
  | 'payment_unavailable'
  | 'payment_review'
  | 'pending_unknown';

export type SmartConfirmationStatusProps = {
  phase: Exclude<SmartConfirmationPhase, 'idle'>;
  errorKind?: SmartConfirmationErrorKind | null;
  errorDetail?: string | null;
  canRetry?: boolean;
  canCheckStatus?: boolean;
  isCheckingStatus?: boolean;
  onRetry?: () => void;
  onCheckStatus?: () => void;
  onBackToBooking?: () => void;
};

/**
 * V12.47.23 · Smart Booking Confirmation Status View
 *
 * Estados reales conectados a la operación en curso:
 * - A (`processing`): "Estamos confirmando tu turno"
 * - B (`prolonged`): "Estamos verificando tu reserva"
 * - D (`error`): "No pudimos completar la confirmación" + acciones contextuales seguras
 */
export function BookingConfirmationStatusView({
  phase,
  errorKind,
  errorDetail,
  canRetry = false,
  canCheckStatus = false,
  isCheckingStatus = false,
  onRetry,
  onCheckStatus,
  onBackToBooking,
}: SmartConfirmationStatusProps) {
  if (phase === 'processing') {
    return (
      <div
        className="smart-confirm-panel smart-confirm-processing"
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-smart-confirm-phase="processing"
      >
        <div className="smart-confirm-orb" aria-hidden="true">
          <span className="smart-confirm-orb-ring" />
          <Loader2 className="smart-confirm-spinner" size={26} />
        </div>
        <div className="smart-confirm-copy">
          <DialogTitle className="smart-confirm-title">Estamos confirmando tu turno</DialogTitle>
          <DialogDescription className="smart-confirm-description">
            Esto puede tardar unos segundos.
          </DialogDescription>
          <p className="smart-confirm-secondary">Por favor, mantené esta página abierta.</p>
        </div>
      </div>
    );
  }

  if (phase === 'prolonged') {
    return (
      <div
        className="smart-confirm-panel smart-confirm-prolonged"
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-smart-confirm-phase="prolonged"
      >
        <div className="smart-confirm-orb smart-confirm-orb--verify" aria-hidden="true">
          <span className="smart-confirm-orb-ring" />
          <ShieldCheck className="smart-confirm-verify-icon" size={26} />
        </div>
        <div className="smart-confirm-copy">
          <DialogTitle className="smart-confirm-title">Estamos verificando tu reserva</DialogTitle>
          <DialogDescription className="smart-confirm-description">
            La confirmación está tardando más de lo habitual.
          </DialogDescription>
          <p className="smart-confirm-secondary">
            Estamos comprobando el resultado para evitar reservas o cobros duplicados.
          </p>
        </div>
        {(canCheckStatus || onBackToBooking) && (
          <div className="smart-confirm-actions">
            {canCheckStatus && onCheckStatus && (
              <Button
                type="button"
                className="smart-confirm-primary-btn"
                onClick={onCheckStatus}
                disabled={isCheckingStatus}
              >
                <RefreshCw size={15} className={isCheckingStatus ? 'animate-spin' : ''} aria-hidden="true" />
                <span>{isCheckingStatus ? 'Consultando estado…' : 'Consultar el estado'}</span>
              </Button>
            )}
            {onBackToBooking && (
              <Button
                type="button"
                variant="outline"
                className="smart-confirm-secondary-btn"
                onClick={onBackToBooking}
              >
                Volver a mi reserva
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  const isReview = errorKind === 'payment_review';
  const isPendingUnknown = errorKind === 'pending_unknown';

  return (
    <div
      className="smart-confirm-panel smart-confirm-error"
      role="alert"
      aria-live="assertive"
      data-smart-confirm-phase="error"
    >
      <div className="smart-confirm-orb smart-confirm-orb--error" aria-hidden="true">
        <AlertTriangle className="smart-confirm-error-icon" size={24} />
      </div>
      <div className="smart-confirm-copy">
        <DialogTitle className="smart-confirm-title">
          {isReview
            ? 'Pago registrado en revisión'
            : isPendingUnknown
              ? 'Verificación de reserva pendiente'
              : 'No pudimos completar la confirmación'}
        </DialogTitle>
        <DialogDescription className="smart-confirm-description">
          {isReview
            ? 'Tu pago fue recibido, pero el horario seleccionado ya no está disponible.'
            : isPendingUnknown
              ? 'Todavía no recibimos la confirmación definitiva de tu operación.'
              : 'Hubo un inconveniente al procesar tu reserva.'}
        </DialogDescription>
        {errorDetail && <p className="smart-confirm-detail">{errorDetail}</p>}
      </div>
      <div className="smart-confirm-actions">
        {canCheckStatus && onCheckStatus && (
          <Button
            type="button"
            className="smart-confirm-primary-btn"
            onClick={onCheckStatus}
            disabled={isCheckingStatus}
          >
            <RefreshCw size={15} className={isCheckingStatus ? 'animate-spin' : ''} aria-hidden="true" />
            <span>{isCheckingStatus ? 'Consultando estado…' : 'Consultar el estado'}</span>
          </Button>
        )}
        {canRetry && !canCheckStatus && onRetry && (
          <Button
            type="button"
            className="smart-confirm-primary-btn"
            onClick={onRetry}
          >
            Volver a intentar
          </Button>
        )}
        {onBackToBooking && (
          <Button
            type="button"
            variant="outline"
            className="smart-confirm-secondary-btn"
            onClick={onBackToBooking}
          >
            Volver a mi reserva
          </Button>
        )}
      </div>
    </div>
  );
}
