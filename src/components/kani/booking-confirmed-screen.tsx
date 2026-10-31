import { Check, Instagram, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dateLabel, money } from '@/lib/kani-model';
import { KANI_MAPS_URL, KANI_MAPS_EMBED_URL } from '@/lib/kani-constants';

export type ConfirmedBookingData = {
  appointmentId?: string;
  serviceName: string;
  barber: string;
  date: string;
  time: string;
  clientName?: string;
  depositArs: number;
  servicePriceArs: number;
};

export interface BookingConfirmedScreenProps {
  confirmed: ConfirmedBookingData;
  onHomeClick?: () => void;
  homeUrl?: string;
  homeLabel?: string;
}

/**
 * BookingConfirmedScreen — Shared Reserva V4 Confirmation Screen.
 * Visual and structural specification identical across Payway and Mercado Pago.
 */
export function BookingConfirmedScreen({
  confirmed,
  onHomeClick,
  homeUrl = '/reservar-turno',
  homeLabel = 'Volver al inicio',
}: BookingConfirmedScreenProps) {
  const remainingArs = Math.max(0, confirmed.servicePriceArs - confirmed.depositArs);

  return (
    <div className="payway-reservation mercadopago-reservation">
      <main className="site-container confirmation">
        <div className="confirmation-mark"><Check size={28} /></div>
        <h1>Turno confirmado</h1>
        <p className="text-sm text-muted-foreground confirmation-subtitle">Te enviamos la confirmación por mail.</p>
        <div className="confirmation-grid">
          {/* Columna izquierda: Encabezado del Resumen */}
          <div className="confirmation-header-summary">
            <h2 className="confirmation-section-title">Resumen de tu turno</h2>
            <p className="confirmation-section-subtitle">Estos son los detalles de tu reserva.</p>
          </div>

          {/* Columna izquierda: Card de detalles de la reserva */}
          <div className="confirmation-details">
            <dl className="summary-list" style={{ marginTop: 0 }}>
              <div><dt>Servicio</dt><dd>{confirmed.serviceName}</dd></div>
              <div><dt>Barbero</dt><dd>{confirmed.barber}</dd></div>
              <div><dt>Fecha</dt><dd className="capitalize">{confirmed.date ? dateLabel(confirmed.date) : '-'}</dd></div>
              <div><dt>Horario</dt><dd>{confirmed.time}</dd></div>
              {confirmed.clientName ? <div><dt>A nombre de</dt><dd>{confirmed.clientName}</dd></div> : null}
              <div><dt>Seña abonada</dt><dd>{money(confirmed.depositArs)}</dd></div>
              <div><dt>Saldo restante del servicio</dt><dd>{money(remainingArs)}</dd></div>
            </dl>
          </div>

          {/* Columna derecha: Encabezado de Ubicación */}
          <section className="confirmation-header-place confirmation-place">
            <h2 className="confirmation-section-title confirmation-place-title">¿Dónde estamos?</h2>
            <p className="confirmation-section-subtitle confirmation-place-address">San Isidro Labrador 7 · Martínez</p>
          </section>

          {/* Columna derecha: Mapa */}
          <div className="confirmation-map-wrap">
            <iframe
              src={KANI_MAPS_EMBED_URL}
              title="Ubicación de Kani Barber Studio en Google Maps"
              className="confirmation-map-iframe"
              loading="lazy"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>

          {/* Acciones secundarias en 2 columnas: Cómo llegar | Instagram */}
          <div className="confirmation-actions">
            <Button asChild variant="outline" className="confirmation-secondary confirmation-btn-directions">
              <a href={KANI_MAPS_URL} target="_blank" rel="noreferrer">
                <MapPin size={16} /> Cómo llegar
              </a>
            </Button>
            <Button asChild variant="outline" className="confirmation-secondary confirmation-btn-instagram">
              <a href="https://www.instagram.com/kanibarberstudio/" target="_blank" rel="noreferrer">
                <Instagram size={16} /> Instagram
              </a>
            </Button>
          </div>
        </div>
      </main>

      {/* Navegación inferior unificada con Reserva V4 (Volver al inicio en la misma barra CTA) */}
      <div className="booking-cta confirmation-cta" role="region" aria-label="Navegación de reserva">
        <div className="booking-cta-inner">
          {onHomeClick ? (
            <Button
              type="button"
              className="action-brand booking-next-button confirmation-btn-home"
              aria-label={homeLabel}
              onClick={onHomeClick}
            >
              {homeLabel}
            </Button>
          ) : (
            <Button
              asChild
              className="action-brand booking-next-button confirmation-btn-home"
              aria-label={homeLabel}
            >
              <a href={homeUrl}>{homeLabel}</a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
