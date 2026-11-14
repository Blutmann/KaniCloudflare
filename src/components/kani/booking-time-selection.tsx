import { CalendarDays, Clock3, Sun, Sunset, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { groupSlotsByPeriod, type BookingTimeSlotItem } from '@/lib/kani-booking-slots';
import type { LiquidGlassMotionAdapter } from '@/components/kani/experimental/liquid-glass-motion.types';

type BookingTimeSelectionProps = {
  slots: readonly BookingTimeSlotItem[];
  selectedTime: string;
  onSelectTime: (time: string) => void;
  availabilityLoading: boolean;
  availabilityRefreshing?: boolean | undefined;
  serviceName?: string | undefined;
  serviceDurationMinutes?: number | undefined;
  barberLabel?: string | undefined;
  barberDeferred?: boolean | undefined;
  showContextBar?: boolean | undefined;
  onEditService?: (() => void) | undefined;
  onEditBarber?: (() => void) | undefined;
  onEditDate?: (() => void) | undefined;
  useGroupRole?: boolean | undefined;
  showExtendedEmptyActions?: boolean | undefined;
  interactiveCard?: LiquidGlassMotionAdapter['InteractiveCard'] | undefined;
};

export function BookingTimeSelection({
  slots,
  selectedTime,
  onSelectTime,
  availabilityLoading,
  availabilityRefreshing = false,
  serviceName,
  serviceDurationMinutes,
  barberLabel,
  barberDeferred,
  onEditService,
  onEditBarber,
  onEditDate,
  useGroupRole = true,
  showExtendedEmptyActions = false,
  interactiveCard: InteractiveSlotButton,
}: BookingTimeSelectionProps) {
  const periodGroups = groupSlotsByPeriod(slots);
  const availableCount = slots.filter(slot => slot.status === 'AVAILABLE').length;
  const showInitialSkeleton = availabilityLoading && slots.length === 0;
  const showRefreshingIndicator = !showInitialSkeleton && (availabilityLoading || availabilityRefreshing);

  return (
    <div className="booking-time-selection">
      {showInitialSkeleton ? (
        <div className="booking-time-loading-wrap" role="status" aria-live="polite">
          <div className="booking-time-loading py-4 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Clock3 size={18} className="animate-spin text-gold" aria-hidden="true" />
            <span>Buscando horarios disponibles…</span>
          </div>
          <div className="booking-time-skeleton-grid" aria-hidden="true">
            {Array.from({ length: 8 }, (_, idx) => (
              <div key={idx} className="booking-time-skeleton-item" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div
            className="booking-time-periods"
            role={useGroupRole ? 'group' : undefined}
            aria-label={useGroupRole ? 'Horarios disponibles' : undefined}
          >
            {periodGroups.map((group, groupIndex) => {
              const groupAvailableCount = group.slots.filter(s => s.status === 'AVAILABLE').length;
              return (
                <section
                  key={group.period}
                  className="booking-time-period-section"
                  aria-labelledby={`booking-period-heading-${group.period}`}
                >
                  <div className="booking-time-period-header">
                    <div className="booking-time-period-title-wrap">
                      {group.period === 'morning' ? (
                        <Sun size={15} className="booking-time-period-icon" aria-hidden="true" />
                      ) : (
                        <Sunset size={15} className="booking-time-period-icon" aria-hidden="true" />
                      )}
                      <h2
                        id={`booking-period-heading-${group.period}`}
                        className="booking-time-period-title"
                      >
                        {group.label}
                      </h2>
                    </div>
                    <div className="flex items-center gap-2">
                      {groupIndex === 0 && showRefreshingIndicator && (
                        <span
                          className="booking-time-refresh-indicator inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                          role="status"
                          aria-live="polite"
                        >
                          <Clock3 size={12} className="animate-spin text-gold" aria-hidden="true" />
                          <span>Verificando…</span>
                        </span>
                      )}
                      {groupAvailableCount > 0 && (
                        <span className="booking-time-period-count">
                          {groupAvailableCount} {groupAvailableCount === 1 ? 'turno' : 'turnos'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="booking-time-grid grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {group.slots.map(slot => {
                      const isUnavailable = slot.status !== 'AVAILABLE';
                      const isSelected = !isUnavailable && selectedTime === slot.time;

                      const slotProps = {
                        type: 'button' as const,
                        disabled: isUnavailable,
                        'aria-disabled': isUnavailable || undefined,
                        'aria-pressed': isUnavailable ? undefined : isSelected,
                        'aria-label': isUnavailable
                          ? `Horario ${slot.time}, no disponible`
                          : `Horario ${slot.time}${isSelected ? ', seleccionado' : ''}`,
                        className: `booking-time-slot h-12 ${isSelected ? 'selected' : ''} ${isUnavailable ? 'time-unavailable' : ''}`.trim(),
                        onClick: () => {
                          if (!isUnavailable) onSelectTime(slot.time);
                        },
                      };
                      const slotBody = (
                        <>
                          <span className="booking-time-slot-value">{slot.time}</span>
                          {isUnavailable && (
                            <span className="booking-time-slot-status" aria-hidden="true">
                              Ocupado
                            </span>
                          )}
                        </>
                      );

                      return InteractiveSlotButton ? (
                        <InteractiveSlotButton key={slot.time} tapScale={0.98} {...slotProps}>
                          {slotBody}
                        </InteractiveSlotButton>
                      ) : (
                        <Button key={slot.time} variant="outline" {...slotProps}>
                          {slotBody}
                        </Button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>

          {availableCount === 0 && (
            <div className="booking-time-empty py-8 text-center text-muted-foreground space-y-3" role="status">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">No hay horarios disponibles para esta fecha.</p>
                <p className="text-xs">
                  Podés elegir otra fecha o probar con otro barbero sin perder tu servicio seleccionado.
                </p>
              </div>
              {showExtendedEmptyActions && (onEditDate || onEditBarber) && (
                <div className="booking-time-empty-actions">
                  {onEditDate && (
                    <Button type="button" variant="outline" size="sm" onClick={onEditDate}>
                      <CalendarDays size={14} aria-hidden="true" />
                      Elegir otra fecha
                    </Button>
                  )}
                  {onEditBarber && (
                    <Button type="button" variant="outline" size="sm" onClick={onEditBarber}>
                      <User size={14} aria-hidden="true" />
                      Elegir otro barbero
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
