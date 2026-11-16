import { useEffect, useId, useState } from 'react';
import { CalendarDays, Check, ChevronDown, Clock3, MapPin, Scissors, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dateLabel, money, formatServiceName } from '@/lib/kani-model';
import {
  KANI_MAPS_EMBED_URL,
  KANI_MAPS_URL,
  KANI_STUDIO_ADDRESS,
  KANI_STUDIO_NAME,
} from '@/lib/kani-constants';
import { playConfirmationChime } from './experimental/liquid-glass-feedback';

export type ConfirmedBookingData = {
  appointmentId?: string;
  serviceName: string;
  barber: string;
  date: string;
  time: string;
  clientName?: string;
  depositArs: number;
  servicePriceArs: number;
  benefitType?: 'NO_DEPOSIT' | 'FREE_SERVICE' | 'PERCENT_10' | 'PERCENT_50' | null;
  benefitCode?: string | null;
  originalPriceArs?: number | null;
  discountAmountArs?: number | null;
  finalPriceArs?: number | null;
  onlineDepositArs?: number | null;
  inPersonBalanceArs?: number | null;
};

export interface BookingConfirmedScreenProps {
  confirmed: ConfirmedBookingData;
  onHomeClick?: () => void;
  homeUrl?: string;
  homeLabel?: string;
}

export function deriveConfirmedFinancials(confirmed: ConfirmedBookingData) {
  const originalPriceArs = Math.max(0, confirmed.originalPriceArs ?? confirmed.servicePriceArs);
  const isFreeService = confirmed.benefitType === 'FREE_SERVICE';
  const isNoDeposit = confirmed.benefitType === 'NO_DEPOSIT';
  const isPercent10 = confirmed.benefitType === 'PERCENT_10';
  const isPercent50 = confirmed.benefitType === 'PERCENT_50';

  const discountAmountArs = isFreeService
    ? (confirmed.discountAmountArs ?? originalPriceArs)
    : isPercent10 || isPercent50
      ? (confirmed.discountAmountArs ??
        Math.round((originalPriceArs * (isPercent50 ? 50 : 10)) / 100))
      : 0;

  const finalPriceArs = isFreeService
    ? 0
    : Math.max(0, confirmed.finalPriceArs ?? originalPriceArs - discountAmountArs);

  const depositPaidArs =
    isFreeService || isNoDeposit
      ? 0
      : Math.max(0, confirmed.onlineDepositArs ?? confirmed.depositArs ?? 0);

  const inPersonBalanceArs = isFreeService
    ? 0
    : isNoDeposit
      ? Math.max(0, confirmed.inPersonBalanceArs ?? finalPriceArs)
      : Math.max(0, confirmed.inPersonBalanceArs ?? finalPriceArs - depositPaidArs);

  const benefitLabel = isFreeService
    ? 'Servicio 100% bonificado'
    : isNoDeposit
      ? 'Reserva sin seña'
      : isPercent10
        ? 'Descuento del 10%'
        : isPercent50
          ? 'Descuento del 50%'
          : null;

  return {
    originalPriceArs,
    discountAmountArs,
    finalPriceArs,
    depositPaidArs,
    inPersonBalanceArs,
    benefitLabel,
    hasBenefit: Boolean(confirmed.benefitType),
    isDepositRequired: !(isFreeService || isNoDeposit || depositPaidArs === 0),
  };
}

function formatConfirmedTime(time: string): string {
  const clean = (time || '').trim();
  if (!clean) return '-';
  return clean.toLowerCase().endsWith('hs') ? clean : `${clean} hs`;
}

/**
 * BookingConfirmedScreen — V12.47.20 Shared Confirmation Screen.
 * Compact primary summary + accessible on-demand details accordion + prominent location.
 */
export function BookingConfirmedScreen({
  confirmed,
  onHomeClick,
  homeUrl = '/reservar',
  homeLabel = 'Volver al inicio',
}: BookingConfirmedScreenProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRegionId = useId();
  const financials = deriveConfirmedFinancials(confirmed);
  const formattedDate = confirmed.date ? dateLabel(confirmed.date) : '-';
  const formattedTime = formatConfirmedTime(confirmed.time);
  const formattedService = formatServiceName(confirmed.serviceName);

  useEffect(() => {
    if (confirmed?.appointmentId) {
      playConfirmationChime(confirmed.appointmentId, { enabled: true });
    }
  }, [confirmed?.appointmentId]);

  return (
    <div
      className="payway-reservation mercadopago-reservation liquid-glass-confirmed-stage"
      data-lg-confirmed="true"
    >
      <main className="site-container confirmation liquid-glass-confirmation kani-confirmed-v2">
        <div className="kani-confirmed-hero">
          <div className="confirmation-mark liquid-glass-confirmation-mark">
            <span className="lg-mark-aura" aria-hidden="true" />
            <Check size={26} />
          </div>
          <h1 className="confirmation-title">¡Turno confirmado!</h1>
          <p className="text-sm text-muted-foreground confirmation-subtitle">
            Te enviamos los detalles por email.
          </p>
        </div>

        <div className="kani-confirmed-grid">
          {/* Bloque 1: Resumen compacto + Acordeón accesible */}
          <section
            aria-label="Resumen de tu turno"
            className="confirmation-details kani-confirmed-summary-card"
          >
            <div className="kani-confirmed-compact">
              <div className="kani-confirmed-compact-row">
                <CalendarDays size={16} className="shrink-0 text-gold" aria-hidden="true" />
                <div className="kani-confirmed-compact-main">
                  <span className="capitalize font-medium text-foreground">{formattedDate}</span>
                  <span className="kani-confirmed-time-pill">
                    <Clock3 size={13} aria-hidden="true" />
                    <span>{formattedTime}</span>
                  </span>
                </div>
              </div>

              <div className="kani-confirmed-compact-row">
                <Scissors size={16} className="shrink-0 text-gold" aria-hidden="true" />
                <p className="kani-confirmed-service-line">
                  <strong className="font-semibold text-foreground">{formattedService}</strong>
                  <span className="text-muted-foreground"> con </span>
                  <strong className="font-semibold text-foreground">{confirmed.barber}</strong>
                </p>
              </div>

              <div className="kani-confirmed-balance-row">
                <span className="kani-confirmed-balance-label">
                  <Wallet size={15} className="shrink-0 text-gold" aria-hidden="true" />
                  <span>A pagar en el local:</span>
                </span>
                <span className="kani-confirmed-balance-value">
                  <strong>{money(financials.inPersonBalanceArs)}</strong>
                  {financials.inPersonBalanceArs === 0 && (
                    <span className="kani-confirmed-zero-note">Sin saldo pendiente</span>
                  )}
                </span>
              </div>
            </div>

            <div className="kani-confirmed-accordion">
              <button
                type="button"
                className="kani-confirmed-accordion-trigger"
                aria-expanded={detailsOpen}
                aria-controls={detailsRegionId}
                onClick={() => setDetailsOpen((prev) => !prev)}
              >
                <span>Ver detalles de la reserva</span>
                <ChevronDown
                  size={16}
                  className={`kani-confirmed-accordion-chevron ${detailsOpen ? 'is-open' : ''}`}
                  aria-hidden="true"
                />
              </button>

              <div
                id={detailsRegionId}
                className={`kani-confirmed-accordion-panel ${detailsOpen ? 'is-open' : ''}`}
                hidden={!detailsOpen}
              >
                <div className="kani-confirmed-accordion-inner">
                  <dl className="summary-list kani-confirmed-full-dl">
                    {confirmed.clientName && (
                      <div>
                        <dt>Titular de la reserva</dt>
                        <dd>{confirmed.clientName}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Servicio</dt>
                      <dd>{formattedService}</dd>
                    </div>
                    <div>
                      <dt>Barbero</dt>
                      <dd>{confirmed.barber}</dd>
                    </div>
                    <div>
                      <dt>Fecha</dt>
                      <dd className="capitalize">{formattedDate}</dd>
                    </div>
                    <div>
                      <dt>Horario</dt>
                      <dd>{formattedTime}</dd>
                    </div>
                    <div>
                      <dt>Precio original</dt>
                      <dd>{money(financials.originalPriceArs)}</dd>
                    </div>
                    {financials.benefitLabel && (
                      <div>
                        <dt>Beneficio aplicado</dt>
                        <dd className="text-gold font-medium">{financials.benefitLabel}</dd>
                      </div>
                    )}
                    {financials.discountAmountArs > 0 && (
                      <>
                        <div>
                          <dt>Bonificación aplicada</dt>
                          <dd className="text-emerald-500 font-medium">
                            −{money(financials.discountAmountArs)}
                          </dd>
                        </div>
                        <div>
                          <dt>Total final</dt>
                          <dd className="font-medium">{money(financials.finalPriceArs)}</dd>
                        </div>
                      </>
                    )}
                    <div>
                      <dt>Seña</dt>
                      <dd>
                        {financials.isDepositRequired
                          ? `${money(financials.depositPaidArs)} abonada`
                          : 'No requerida ($0)'}
                      </dd>
                    </div>
                    <div>
                      <dt>Saldo pendiente</dt>
                      <dd className="font-semibold">{money(financials.inPersonBalanceArs)}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </section>

          {/* Bloque 2: Ubicación prominente */}
          <section
            aria-labelledby="kani-confirmed-place-heading"
            className="confirmation-place kani-confirmed-place-card"
          >
            <div className="kani-confirmed-place-header">
              <div>
                <h2 id="kani-confirmed-place-heading" className="confirmation-section-title">
                  ¿Dónde estamos?
                </h2>
                <p className="kani-confirmed-place-name">{KANI_STUDIO_NAME}</p>
                <p className="confirmation-section-subtitle confirmation-place-address">
                  {KANI_STUDIO_ADDRESS}
                </p>
              </div>
              <Button asChild className="action-positive kani-confirmed-directions-btn">
                <a href={KANI_MAPS_URL} target="_blank" rel="noreferrer">
                  <MapPin size={16} aria-hidden="true" />
                  <span>Cómo llegar</span>
                </a>
              </Button>
            </div>

            <div className="confirmation-map-wrap kani-confirmed-map">
              <iframe
                src={KANI_MAPS_EMBED_URL}
                title="Ubicación de Kani Barber Studio en Google Maps"
                className="confirmation-map-iframe"
                loading="lazy"
                allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          </section>
        </div>

        {/* Acción secundaria posterior */}
        <div className="kani-confirmed-secondary-footer" role="region" aria-label="Navegación posterior">
          {onHomeClick ? (
            <Button
              type="button"
              variant="outline"
              className="kani-confirmed-home-btn"
              aria-label={homeLabel}
              onClick={onHomeClick}
            >
              {homeLabel}
            </Button>
          ) : (
            <Button
              asChild
              variant="outline"
              className="kani-confirmed-home-btn"
              aria-label={homeLabel}
            >
              <a href={homeUrl}>{homeLabel}</a>
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
