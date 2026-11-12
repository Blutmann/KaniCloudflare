import { CalendarDays, Check, Clock3, PencilLine, Sun, Sunset, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { groupSlotsByPeriod, type BookingTimeSlotItem } from '@/lib/kani-booking-slots';

type BookingTimeSelectionProps = {
  slots: readonly BookingTimeSlotItem[];
  selectedTime: string;
  onSelectTime: (time: string) => void;
  availabilityLoading: boolean;
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
};

export function BookingTimeSelection({
  slots,
  selectedTime,
  onSelectTime,
  availabilityLoading,
  serviceName,
  serviceDurationMinutes,
  barberLabel,
  barberDeferred,
  showContextBar = false,
  onEditService,
  onEditBarber,
  onEditDate,
  useGroupRole = true,
  showExtendedEmptyActions = false,
}: BookingTimeSelectionProps) {
  const periodGroups = groupSlotsByPeriod(slots);
  const availableCount = slots.filter(slot => slot.status === 'AVAILABLE').length;

  return (
    <div className="booking-time-selection">
      {showContextBar && serviceName && (
        <div className="booking-time-context-bar" aria-label="Resumen de selección">
          <div className="booking-time-context-items">
            <button
              type="button"
              className="booking-time-context-chip"
              onClick={onEditService}
              aria-label={`Editar servicio: ${serviceName}`}
              disabled={!onEditService}
            >
              <span className="booking-time-context-value">
                {serviceName}
                {typeof serviceDurationMinutes === 'number' && serviceDurationMinutes > 0
                  ? ` · ${serviceDurationMinutes} min`
                  : ''}
              </span>
              {onEditService && <PencilLine size={12} className="booking-time-context-edit-icon" aria-hidden="true" />}
            </button>

            <button
              type="button"
              className="booking-time-context-chip"
              onClick={onEditBarber}
              aria-label={barberDeferred && !barberLabel ? 'Editar preferencia de barbero' : `Editar barbero: ${barberLabel}`}
              disabled={!onEditBarber}
            >
              <User size={12} className="booking-time-context-leading-icon" aria-hidden="true" />
              <span className="booking-time-context-value">
                {barberLabel || (barberDeferred ? 'Barbero a elegir' : 'Profesional')}
              </span>
              {onEditBarber && <PencilLine size={12} className="booking-time-context-edit-icon" aria-hidden="true" />}
            </button>

            {onEditDate && (
              <button
                type="button"
                className="booking-time-context-chip booking-time-context-chip-date"
                onClick={onEditDate}
                aria-label="Editar fecha"
              >
                <CalendarDays size={12} className="booking-time-context-leading-icon" aria-hidden="true" />
                <span className="booking-time-context-value">Otra fecha</span>
              </button>
            )}
          </div>
        </div>
      )}

      {availabilityLoading ? (
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
            {periodGroups.map(group => {
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
                    {groupAvailableCount > 0 && (
                      <span className="booking-time-period-count">
                        {groupAvailableCount} {groupAvailableCount === 1 ? 'turno' : 'turnos'}
                      </span>
                    )}
                  </div>

                  <div className="booking-time-grid grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {group.slots.map(slot => {
                      const isUnavailable = slot.status !== 'AVAILABLE';
                      const isSelected = !isUnavailable && selectedTime === slot.time;

                      return (
                        <Button
                          key={slot.time}
                          type="button"
                          variant="outline"
                          disabled={isUnavailable}
                          aria-disabled={isUnavailable || undefined}
                          aria-pressed={isUnavailable ? undefined : isSelected}
                          aria-label={
                            isUnavailable
                              ? `Horario ${slot.time}, no disponible`
                              : `Horario ${slot.time}${isSelected ? ', seleccionado' : ''}`
                          }
                          className={`booking-time-slot h-12 ${isSelected ? 'selected' : ''} ${isUnavailable ? 'time-unavailable' : ''}`.trim()}
                          onClick={() => {
                            if (!isUnavailable) onSelectTime(slot.time);
                          }}
                        >
                          <span className="booking-time-slot-value">{slot.time}</span>
                          {isSelected && (
                            <Check size={13} className="booking-time-slot-check" aria-hidden="true" />
                          )}
                          {isUnavailable && (
                            <span className="booking-time-slot-status" aria-hidden="true">
                              Ocupado
                            </span>
                          )}
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
