import { useEffect, useRef } from 'react';
import { CalendarDays, Check, Clock3, Loader2, ShieldCheck, User } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type SlotUnavailableRecoveryState = {
  requestedDate: string;
  requestedTime: string;
  requestedBarber: string;
  alternatives: string[];
  loadingAlternatives: boolean;
  verifyingAlternative: string | null;
  feedbackMessage?: string | null;
};

type BookingSlotUnavailableRecoveryProps = {
  recovery: SlotUnavailableRecoveryState;
  serviceName: string;
  serviceDurationMinutes?: number | undefined;
  formattedDate: string;
  onSelectAlternative: (time: string) => void;
  onChooseAnotherTime: () => void;
  onEditDate?: (() => void) | undefined;
  onEditBarber?: (() => void) | undefined;
};

export function BookingSlotUnavailableRecovery({
  recovery,
  serviceName,
  serviceDurationMinutes,
  formattedDate,
  onSelectAlternative,
  onChooseAnotherTime,
  onEditDate,
  onEditBarber,
}: BookingSlotUnavailableRecoveryProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Move keyboard/screen-reader focus cleanly to the recovery card when triggered.
    containerRef.current?.focus();
  }, [recovery.requestedDate, recovery.requestedTime]);

  const busy = Boolean(recovery.verifyingAlternative);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="alert"
      aria-live="assertive"
      className="booking-slot-recovery-card"
    >
      <div className="booking-slot-recovery-header">
        <div className="booking-slot-recovery-icon-ring" aria-hidden="true">
          <Clock3 size={22} />
        </div>
        <div className="booking-slot-recovery-eyebrow-wrap">
          <span className="booking-slot-recovery-eyebrow">Actualización de disponibilidad</span>
        </div>
        <h2 className="booking-slot-recovery-title">Ese horario ya no está disponible</h2>
        <p className="booking-slot-recovery-copy">
          Otro cliente acaba de confirmar ese turno o la agenda se actualizó mientras completabas la reserva. No se realizó ningún cobro.
        </p>
      </div>

      <div className="booking-slot-recovery-context" aria-label="Turno solicitado no disponible">
        <div className="booking-slot-recovery-context-main">
          <span className="booking-slot-recovery-context-label">Turno solicitado</span>
          <span className="booking-slot-recovery-context-summary">
            {serviceName}
            {typeof serviceDurationMinutes === 'number' && serviceDurationMinutes > 0
              ? ` (${serviceDurationMinutes} min)`
              : ''}{' '}
            · {recovery.requestedBarber}
          </span>
          <span className="booking-slot-recovery-context-datetime">
            <span>{formattedDate}</span> · {recovery.requestedTime} hs
          </span>
        </div>
        <span className="booking-slot-recovery-status-badge">Ocupado</span>
      </div>

      {recovery.feedbackMessage && (
        <p className="booking-slot-recovery-feedback" role="status">
          {recovery.feedbackMessage}
        </p>
      )}

      {recovery.loadingAlternatives ? (
        <div className="booking-slot-recovery-loading" role="status">
          <Loader2 size={16} className="animate-spin text-gold" aria-hidden="true" />
          <span>Buscando horarios disponibles cercanos…</span>
        </div>
      ) : recovery.alternatives.length > 0 ? (
        <div className="booking-slot-recovery-alternatives">
          <p className="booking-slot-recovery-alternatives-label">
            Horarios disponibles más cercanos para el mismo día:
          </p>
          <div className="booking-slot-recovery-alternatives-grid">
            {recovery.alternatives.map(altTime => {
              const isCheckingThis = recovery.verifyingAlternative === altTime;
              return (
                <Button
                  key={altTime}
                  type="button"
                  variant="outline"
                  disabled={busy}
                  aria-label={`Elegir horario alternativo ${altTime}`}
                  className="booking-slot-recovery-alt-btn"
                  onClick={() => onSelectAlternative(altTime)}
                >
                  {isCheckingThis ? (
                    <>
                      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      <span>Verificando…</span>
                    </>
                  ) : (
                    <span>{altTime}</span>
                  )}
                </Button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="booking-slot-recovery-no-alternatives">
          <p className="booking-slot-recovery-no-alternatives-title">
            No encontramos otros horarios disponibles para ese día.
          </p>
          <p className="booking-slot-recovery-no-alternatives-hint">
            Podés probar con otro día o elegir otro barbero manteniendo tus datos guardados.
          </p>
        </div>
      )}

      <div className="booking-slot-recovery-preserved" role="note">
        <ShieldCheck size={15} className="shrink-0 text-gold" aria-hidden="true" />
        <span>
          Tus datos personales, servicio y beneficios aplicados se conservan sin cambios.
        </span>
      </div>

      <div className="booking-slot-recovery-actions">
        <Button
          type="button"
          className="action-positive booking-slot-recovery-primary-btn"
          disabled={busy}
          onClick={onChooseAnotherTime}
        >
          <Check size={15} className="hidden" aria-hidden="true" />
          Elegir otro horario
        </Button>

        <div className="booking-slot-recovery-secondary-actions">
          {onEditDate && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className="booking-slot-recovery-secondary-btn"
              onClick={onEditDate}
            >
              <CalendarDays size={14} aria-hidden="true" />
              Elegir otra fecha
            </Button>
          )}
          {onEditBarber && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className="booking-slot-recovery-secondary-btn"
              onClick={onEditBarber}
            >
              <User size={14} aria-hidden="true" />
              Elegir otro barbero
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
