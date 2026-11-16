import { CalendarDays, Clock3, Loader2, Scissors, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { formatDraftServiceLabel, type BookingDraftV1 } from '@/lib/kani-booking-draft';
import { dateLabel } from '@/lib/kani-model';

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
  const dateText = draft.date ? dateLabel(draft.date) : '';
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
        className="booking-recovery-modal sm:max-w-[500px]"
        showCloseButton={false}
        onPointerDownOutside={event => {
          if (mode === 'verifying') event.preventDefault();
        }}
        onEscapeKeyDown={event => {
          if (mode === 'verifying') event.preventDefault();
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <DialogTitle className="text-lg sm:text-[1.25rem] font-semibold tracking-tight leading-snug text-foreground">
              {mode === 'slot-occupied'
                ? 'Tu reserva está casi lista'
                : mode === 'error'
                  ? 'No pudimos verificar la disponibilidad'
                  : '¿Querés continuar tu reserva?'}
            </DialogTitle>
            <DialogDescription className="text-sm sm:text-[0.9375rem] text-muted-foreground leading-relaxed">
              {mode === 'slot-occupied'
                ? 'Mientras estabas fuera, el horario que habías elegido dejó de estar disponible. Conservamos tus datos para que puedas elegir otro horario y terminar tu reserva.'
                : mode === 'error'
                  ? (errorMessage || 'Ocurrió un problema temporal al consultar la disponibilidad. Tus datos siguen guardados.')
                  : 'Encontramos una reserva que habías empezado anteriormente.'}
            </DialogDescription>
          </div>
          {mode !== 'verifying' && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Cerrar"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        {(mode === 'prompt' || mode === 'verifying') && (
          <div className="mt-4 rounded-xl border border-border/60 bg-background/40 p-3.5 sm:p-4 text-sm sm:text-[0.9375rem] space-y-2.5 min-w-0">
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
            {dateText && (
              <div className="flex items-center gap-2.5 min-w-0 text-foreground">
                <CalendarDays size={15} className="shrink-0 text-gold" aria-hidden="true" />
                <span className="shrink-0 text-muted-foreground">Fecha:</span>
                <span className="font-medium capitalize truncate min-w-0">{dateText}</span>
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
          <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end sm:gap-3">
            <Button type="button" variant="outline" onClick={onStartOver} className="w-full sm:w-auto min-h-[44px] sm:min-h-[46px] px-5">
              Empezar de nuevo
            </Button>
            <Button type="button" onClick={onContinue} className="action-positive w-full sm:w-auto min-h-[44px] sm:min-h-[46px] px-5 font-semibold">
              Continuar reserva
            </Button>
          </div>
        )}

        {mode === 'slot-occupied' && (
          <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end sm:gap-3">
            <Button type="button" onClick={onChooseAnotherTime} className="action-positive w-full sm:w-auto min-h-[44px] sm:min-h-[46px] px-5 font-semibold">
              Elegir otro horario
            </Button>
          </div>
        )}

        {mode === 'error' && (
          <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end sm:gap-3">
            <Button type="button" variant="outline" onClick={onStartOver} className="w-full sm:w-auto min-h-[44px] sm:min-h-[46px] px-5">
              Empezar de nuevo
            </Button>
            <Button type="button" onClick={onRetry} className="action-positive w-full sm:w-auto min-h-[44px] sm:min-h-[46px] px-5 font-semibold">
              Reintentar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
