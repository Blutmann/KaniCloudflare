import { CalendarDays, Clock3, Loader2, Scissors, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { formatDraftServiceLabel, type BookingDraftV1 } from '@/lib/kani-booking-draft';

const WEEKDAYS_FULL = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
] as const;

const WEEKDAYS_SHORT = ['Dom.', 'Lun.', 'Mar.', 'Mié.', 'Jue.', 'Vie.', 'Sáb.'] as const;

const MONTHS_ABBR = [
  'Ene.',
  'Feb.',
  'Mar.',
  'Abr.',
  'May.',
  'Jun.',
  'Jul.',
  'Ago.',
  'Sep.',
  'Oct.',
  'Nov.',
  'Dic.',
] as const;

export function formatRecoveryDateLabel(dateStr: string | null): {
  full: string;
  compact: string;
} {
  if (!dateStr) return { full: '', compact: '' };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return { full: dateStr, compact: dateStr };
  const year = Number(match[1]);
  const monthIdx = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (monthIdx < 0 || monthIdx > 11 || day < 1 || day > 31) {
    return { full: dateStr, compact: dateStr };
  }
  const utcDate = new Date(Date.UTC(year, monthIdx, day));
  const weekdayIdx = utcDate.getUTCDay();
  const monthAbbr = MONTHS_ABBR[monthIdx];
  return {
    full: `${WEEKDAYS_FULL[weekdayIdx]}, ${day} de ${monthAbbr}`,
    compact: `${WEEKDAYS_SHORT[weekdayIdx]}, ${day} de ${monthAbbr}`,
  };
}

export type BookingRecoveryModalMode = 'closed' | 'prompt' | 'verifying' | 'slot-occupied' | 'error';

type BookingRecoveryModalProps = {
  mode: BookingRecoveryModalMode;
  draft: BookingDraftV1 | null;
  errorMessage?: string;
  onContinue: () => void;
  onStartOver: () => void;
  onDismiss: () => void;
  onChooseAnotherTime: () => void;
  onRetry: () => void;
};

export function BookingRecoveryModal({
  mode,
  draft,
  errorMessage,
  onContinue,
  onStartOver,
  onDismiss,
  onChooseAnotherTime,
  onRetry,
}: BookingRecoveryModalProps) {
  const open = mode !== 'closed' && Boolean(draft);
  if (!open || !draft) return null;

  const serviceText = formatDraftServiceLabel(draft.service);
  const barberText = draft.barberDeferred ? 'Elegir más adelante' : draft.barber;
  const dateText = formatRecoveryDateLabel(draft.date);
  const timeText = draft.time ? `${draft.time} hs` : '';

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen && mode !== 'verifying') {
          onDismiss();
        }
      }}
    >
      <DialogContent
        className="booking-recovery-modal sm:max-w-[520px]"
        showCloseButton={false}
        onPointerDownOutside={event => {
          if (mode === 'verifying') event.preventDefault();
        }}
        onEscapeKeyDown={event => {
          if (mode === 'verifying') event.preventDefault();
        }}
      >
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0 flex-1 space-y-1">
            <DialogTitle className="text-[1.0625rem] sm:text-[1.25rem] font-semibold tracking-tight leading-snug text-foreground">
              {mode === 'slot-occupied'
                ? 'Tu reserva está casi lista'
                : mode === 'error'
                  ? 'No pudimos verificar la disponibilidad'
                  : '¿Querés continuar tu reserva?'}
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              {mode === 'slot-occupied'
                ? 'Mientras estabas fuera, el horario que habías elegido dejó de estar disponible. Conservamos tus datos para que puedas elegir otro horario y terminar tu reserva.'
                : mode === 'error'
                  ? (errorMessage || 'Ocurrió un problema temporal al consultar la disponibilidad. Tus datos siguen guardados.')
                  : 'Retomá tu reserva donde la dejaste.'}
            </DialogDescription>
          </div>
          {mode !== 'verifying' && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Cerrar"
              className="booking-recovery-close-btn inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/50 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        {(mode === 'prompt' || mode === 'verifying') && (
          <div className="booking-recovery-summary mt-4 text-sm sm:text-[0.9375rem] space-y-2.5 min-w-0">
            {serviceText && (
              <div className="flex items-center gap-2.5 min-w-0 text-foreground">
                <Scissors size={15} className="shrink-0 text-gold" aria-hidden="true" />
                <span className="shrink-0 text-muted-foreground">Servicio:</span>
                <span className="font-medium truncate min-w-0">{serviceText}</span>
              </div>
            )}
            {barberText && (
              <div className="flex items-center gap-2.5 min-w-0 text-foreground">
                <UserRound size={15} className="shrink-0 text-gold" aria-hidden="true" />
                <span className="shrink-0 text-muted-foreground">Barbero:</span>
                <span className="font-medium truncate min-w-0">{barberText}</span>
              </div>
            )}
            {dateText.full && (
              <div className="flex items-center gap-2.5 min-w-0 text-foreground">
                <CalendarDays size={15} className="shrink-0 text-gold" aria-hidden="true" />
                <span className="shrink-0 text-muted-foreground">Fecha:</span>
                <span className="font-medium min-w-0">
                  <span className="hidden min-[360px]:inline">{dateText.full}</span>
                  <span className="min-[360px]:hidden">{dateText.compact}</span>
                </span>
              </div>
            )}
            {timeText && (
              <div className="flex items-center gap-2.5 min-w-0 text-foreground">
                <Clock3 size={15} className="shrink-0 text-gold" aria-hidden="true" />
                <span className="shrink-0 text-muted-foreground">Horario:</span>
                <span className="font-medium truncate min-w-0">{timeText}</span>
              </div>
            )}
          </div>
        )}

        {mode === 'verifying' && (
          <div className="mt-4 flex items-center justify-center gap-2 py-2.5 text-sm text-muted-foreground" role="status" aria-live="polite">
            <Loader2 size={16} className="animate-spin text-gold" aria-hidden="true" />
            <span>Verificando disponibilidad actual…</span>
          </div>
        )}

        {mode === 'prompt' && (
          <div className="booking-recovery-actions mt-5 flex flex-col-reverse gap-2.5 sm:grid sm:grid-cols-2 sm:gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={onStartOver}
              className="booking-recovery-secondary-btn w-full min-h-[44px] sm:min-h-[46px] px-4"
            >
              Empezar de nuevo
            </Button>
            <Button
              type="button"
              onClick={onContinue}
              className="action-positive w-full min-h-[44px] sm:min-h-[46px] px-4 font-semibold"
            >
              Continuar reserva
            </Button>
          </div>
        )}

        {mode === 'slot-occupied' && (
          <div className="booking-recovery-actions mt-5 flex flex-col gap-2.5">
            <Button
              type="button"
              onClick={onChooseAnotherTime}
              className="action-positive w-full min-h-[44px] sm:min-h-[46px] px-5 font-semibold"
            >
              Elegir otro horario
            </Button>
          </div>
        )}

        {mode === 'error' && (
          <div className="booking-recovery-actions mt-5 flex flex-col-reverse gap-2.5 sm:grid sm:grid-cols-2 sm:gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={onStartOver}
              className="booking-recovery-secondary-btn w-full min-h-[44px] sm:min-h-[46px] px-4"
            >
              Empezar de nuevo
            </Button>
            <Button
              type="button"
              onClick={onRetry}
              className="action-positive w-full min-h-[44px] sm:min-h-[46px] px-4 font-semibold"
            >
              Reintentar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
