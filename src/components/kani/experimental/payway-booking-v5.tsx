import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, Clock3, HelpCircle, Instagram, MapPin } from 'lucide-react';
import { Booking, type BookingPaymentDraft } from '@/components/kani/booking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { preparePaywayCheckoutFn, payPaywayDepositFn } from '@/lib/kani-payway.functions';
import { tokenizePaywayForm } from '@/lib/kani-payway.browser';
import { PAYWAY_MESSAGES, type PaywayCheckout, type PaywayResult } from '@/lib/kani-payway';
import { readConfiguredServices, type ConfiguredService } from '@/lib/kani-availability';
import { dateLabel, money, services } from '@/lib/kani-model';
import {
  detectCardNetwork,
  formatCardPan,
  formatDni,
  getYearOptions,
  MONTH_OPTIONS,
  validateCardholder,
  validateCvv,
  validateDni,
  validateExpiry,
  validatePan,
} from '@/lib/kani-card-validation';
import { KANI_MAPS_URL, KANI_MAPS_EMBED_URL } from '@/lib/kani-constants';
import { CardBrandBadge } from './card-brand-badges';

const CONFIRMED_STORAGE_KEY = 'kani:payway:confirmed-booking:v5';
const PAID_APPOINTMENTS_STORAGE_KEY = 'kani:payway:paid-appointments:v5';

type ConfirmedPaywayBooking = {
  appointmentId: string;
  attemptId: string;
  serviceName: string;
  barber: string;
  date: string;
  time: string;
  clientName: string;
  depositArs: number;
  servicePriceArs: number;
};

function readConfirmedBooking(): ConfirmedPaywayBooking | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CONFIRMED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConfirmedPaywayBooking>;
    if (
      typeof parsed?.appointmentId === 'string' &&
      typeof parsed?.serviceName === 'string' &&
      typeof parsed?.barber === 'string' &&
      typeof parsed?.date === 'string' &&
      typeof parsed?.time === 'string' &&
      typeof parsed?.depositArs === 'number' &&
      typeof parsed?.servicePriceArs === 'number'
    ) {
      return parsed as ConfirmedPaywayBooking;
    }
    return null;
  } catch {
    return null;
  }
}

function readPaidAppointments(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.sessionStorage.getItem(PAID_APPOINTMENTS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function persistConfirmedBooking(booking: ConfirmedPaywayBooking) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CONFIRMED_STORAGE_KEY, JSON.stringify(booking));
    const paid = readPaidAppointments();
    paid.add(booking.appointmentId);
    window.sessionStorage.setItem(PAID_APPOINTMENTS_STORAGE_KEY, JSON.stringify([...paid]));
    window.history.replaceState({ ...(window.history.state ?? {}), kaniPaywayConfirmedV5: true, appointmentId: booking.appointmentId }, '');
  } catch {
    /* Storage access is best-effort; in-memory and server guards remain authoritative. */
  }
}

function clearConfirmedBookingView() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CONFIRMED_STORAGE_KEY);
    if (window.history.state?.kaniPaywayConfirmedV5) {
      window.history.replaceState({ ...(window.history.state ?? {}), kaniPaywayConfirmedV5: false }, '');
    }
  } catch {
    /* Ignore storage errors. */
  }
}

function resolveServicePrice(serviceName: string, configured: ConfiguredService[]): number {
  const normalized = serviceName.trim().toLowerCase();
  const match =
    configured.find(s => s.name.trim().toLowerCase() === normalized) ??
    services.find(s => s.name.trim().toLowerCase() === normalized) ??
    (normalized.includes('corte') && normalized.includes('barba')
      ? configured.find(s => s.id === 'corte-barba') ?? services.find(s => s.id === 'corte-barba')
      : undefined);
  return match?.price ?? 25000;
}

export function PaywayBookingV5() {
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [checkout, setCheckout] = useState<PaywayCheckout | null>(null);
  const [result, setResult] = useState<PaywayResult | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedPaywayBooking | null>(() => readConfirmedBooking());
  const [configuredServices, setConfiguredServices] = useState<ConfiguredService[]>(() => services.map(s => ({ ...s })));
  const [stage, setStage] = useState<'idle' | 'tokenizing' | 'paying'>('idle');

  // Form field states
  const [cardNumber, setCardNumber] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [cvv, setCvv] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [dni, setDni] = useState('');
  const [showCvvHelp, setShowCvvHelp] = useState(false);

  // Field validation and touched states
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = (field: string) => setTouched(prev => ({ ...prev, [field]: true }));

  const paidAppointmentsRef = useRef<Set<string>>(readPaidAppointments());
  const draftRef = useRef<BookingPaymentDraft | null>(null);
  const paying = useRef(false);
  const opening = useRef(false);

  useEffect(() => {
    let cancelled = false;
    readConfiguredServices()
      .then(items => {
        if (!cancelled && items.length) setConfiguredServices(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync modal open state to body attribute for high contrast styling under overlay
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (open) {
      document.body.dataset.paywayModalOpen = 'true';
    } else {
      delete document.body.dataset.paywayModalOpen;
    }
    return () => {
      delete document.body.dataset.paywayModalOpen;
    };
  }, [open]);

  // Derived card network detection
  const detected = useMemo(() => {
    const rawPan = cardNumber.replace(/\D/g, '');
    return detectCardNetwork(rawPan, checkout?.methods ?? []);
  }, [cardNumber, checkout?.methods]);

  const yearOptions = useMemo(() => getYearOptions(), []);

  const terminal = result ? result.state === 'approved' || result.state === 'unknown' : false;

  // Validation results
  const panValid = useMemo(() => validatePan(cardNumber, detected), [cardNumber, detected]);
  const expiryValid = useMemo(() => validateExpiry(month, year), [month, year]);
  const cvvValid = useMemo(() => validateCvv(cvv, detected.codeSize), [cvv, detected.codeSize]);
  const holderValid = useMemo(() => validateCardholder(cardHolder), [cardHolder]);
  const dniValid = useMemo(() => validateDni(dni), [dni]);

  // Field status helpers: 'idle' | 'valid' | 'invalid'
  const panStatus = touched.cardNumber ? (panValid ? 'valid' : 'invalid') : 'idle';
  const expiryStatus = touched.expiry ? (expiryValid ? 'valid' : 'invalid') : 'idle';
  const cvvStatus = touched.cvv ? (cvvValid ? 'valid' : 'invalid') : 'idle';
  const holderStatus = touched.cardHolder ? (holderValid ? 'valid' : 'invalid') : 'idle';
  const dniStatus = touched.dni ? (dniValid ? 'valid' : 'invalid') : 'idle';

  // Specific errors for accessible aria-describedby
  const panError = useMemo(() => {
    if (!touched.cardNumber) return null;
    const raw = cardNumber.replace(/\D/g, '');
    if (!raw) return 'Ingresá el número de tarjeta.';
    if (detected.brand !== 'unknown' && !detected.supported) {
      return `La tarjeta ${detected.name} no está habilitada para esta operación.`;
    }
    if (!panValid) return 'El número de tarjeta no es válido.';
    return null;
  }, [touched.cardNumber, cardNumber, detected, panValid]);

  const monthInvalid = touched.expiry && !month;
  const yearInvalid = touched.expiry && (!year || (month ? !expiryValid : false));

  const cvvError = useMemo(() => {
    if (!touched.cvv) return null;
    if (!cvv) return 'Ingresá el código de seguridad.';
    if (!cvvValid) return `El código debe tener ${detected.codeSize} dígitos.`;
    return null;
  }, [touched.cvv, cvv, cvvValid, detected.codeSize]);

  const holderError = useMemo(() => {
    if (!touched.cardHolder) return null;
    if (!cardHolder.trim()) return 'Ingresá el nombre y apellido del titular.';
    if (!holderValid) return 'Ingresá nombre y apellido como figuran en la tarjeta.';
    return null;
  }, [touched.cardHolder, cardHolder, holderValid]);

  const dniError = useMemo(() => {
    if (!touched.dni) return null;
    const digits = dni.replace(/\D/g, '');
    if (!digits) return 'Ingresá el DNI del titular.';
    if (!dniValid) return 'El DNI debe tener entre 7 y 8 dígitos válidos.';
    return null;
  }, [touched.dni, dni, dniValid]);

  function renderFeedback(status: 'idle' | 'valid' | 'invalid') {
    if (status === 'valid') {
      return (
        <span className="field-feedback valid" aria-hidden="true">
          <Check size={16} />
        </span>
      );
    }
    if (status === 'invalid') {
      return (
        <span className="field-feedback invalid" aria-hidden="true">
          <CircleAlert size={16} />
        </span>
      );
    }
    return null;
  }

  function resetFormState() {
    setCardNumber('');
    setMonth('');
    setYear('');
    setCvv('');
    setCardHolder('');
    setDni('');
    setTouched({});
    setShowCvvHelp(false);
  }

  async function begin(draft: BookingPaymentDraft) {
    if (opening.current) return;
    opening.current = true;
    draftRef.current = draft;
    setConfirmed(null);
    setResult(null);
    setCheckout(null);
    resetFormState();

    if (draft.name) {
      setCardHolder(draft.name.trim().toUpperCase());
    }

    setPreparing(true);
    setOpen(true);
    try {
      const activeService =
        configuredServices.find(s => s.name.trim().toLowerCase() === draft.serviceName.trim().toLowerCase()) ??
        services.find(s => s.name.trim().toLowerCase() === draft.serviceName.trim().toLowerCase());
      const servicePrice = activeService?.price ?? 25000;
      const res = await preparePaywayCheckoutFn({
        data: {
          serviceName: draft.serviceName,
          barberName: draft.barber,
          bookingDate: draft.date,
          startTime: draft.time,
          clientName: draft.name,
          clientPhone: draft.phone,
          clientEmail: draft.email,
          clientNotes: draft.notes,
          servicePrice,
        },
      });
      if (res.state === 'ready' && res.checkout) {
        setCheckout(res.checkout);
      } else {
        setResult(res.result ?? { state: 'unrecoverable', message: 'No pudimos iniciar el pago con Payway.' });
      }
    } catch {
      setResult({
        state: 'recoverable',
        message: 'No pudimos preparar el pago con Payway. Podés reintentar sin perder tus datos.',
      });
    } finally {
      setPreparing(false);
      opening.current = false;
    }
  }

  async function pay(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!checkout || stage !== 'idle') return;

    setTouched({
      cardNumber: true,
      expiry: true,
      cvv: true,
      cardHolder: true,
      dni: true,
    });

    const isFormValid = panValid && expiryValid && cvvValid && holderValid && dniValid;
    if (!isFormValid) {
      const form = e.currentTarget;
      if (!panValid) form.querySelector<HTMLInputElement>('[name="card_number"]')?.focus();
      else if (!expiryValid && !month) form.querySelector<HTMLSelectElement>('[name="card_expiration_month"]')?.focus();
      else if (!expiryValid) form.querySelector<HTMLSelectElement>('[name="card_expiration_year"]')?.focus();
      else if (!cvvValid) form.querySelector<HTMLInputElement>('[name="security_code"]')?.focus();
      else if (!holderValid) form.querySelector<HTMLInputElement>('[name="card_holder_name"]')?.focus();
      else if (!dniValid) form.querySelector<HTMLInputElement>('[name="card_holder_doc_number"]')?.focus();
      return;
    }

    if (!detected.methodId) {
      setResult({
        state: 'recoverable',
        message: 'No pudimos reconocer la tarjeta ingresada. Verificá los dígitos e intentá nuevamente.',
      });
      return;
    }

    if (!detected.supported) {
      setResult({
        state: 'recoverable',
        message: `La tarjeta ${detected.name} no está admitida para este pago. Probá con otra tarjeta.`,
      });
      return;
    }

    const form = e.currentTarget;
    setStage('tokenizing');
    paying.current = true;
    setResult(null);
    let sent = false;
    try {
      const token = await tokenizePaywayForm(form, checkout.publicApiKey);
      setStage('paying');
      sent = true;
      const response = await payPaywayDepositFn({
        data: {
          appointmentId: checkout.appointmentId,
          attemptId: checkout.attemptId,
          token,
          paymentMethodId: detected.methodId,
          bin: checkout.bin,
          installments: 1,
        },
      });
      if (response.state === 'approved') {
        const activeDraft = draftRef.current;
        const confirmedBooking: ConfirmedPaywayBooking = {
          appointmentId: checkout.appointmentId,
          attemptId: checkout.attemptId,
          serviceName: activeDraft?.serviceName ?? 'Corte',
          barber: activeDraft?.barber ?? 'Lautaro',
          date: activeDraft?.date ?? '',
          time: activeDraft?.time ?? '',
          clientName: activeDraft?.name ?? '',
          depositArs: checkout.depositArs,
          servicePriceArs: resolveServicePrice(activeDraft?.serviceName ?? 'Corte', configuredServices),
        };
        paidAppointmentsRef.current.add(checkout.appointmentId);
        persistConfirmedBooking(confirmedBooking);
        setResult(response);
        setConfirmed(confirmedBooking);
        setOpen(false);
        if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
          window.scrollTo({ top: 0, behavior: 'instant' });
        }
        return;
      }
      setResult(response);
    } catch {
      setResult({
        state: sent ? 'unknown' : 'recoverable',
        message: sent ? PAYWAY_MESSAGES.unknown : 'No pudimos validar la tarjeta. Revisá sus datos e intentá nuevamente.',
      });
      if (sent) setCheckout(null);
    } finally {
      form.reset();
      resetFormState();
      paying.current = false;
      setStage('idle');
    }
  }

  function startNewReservation() {
    clearConfirmedBookingView();
    resetFormState();
    draftRef.current = null;
    setConfirmed(null);
    setResult(null);
    setCheckout(null);
    setOpen(false);
  }

  function handleCardNumberChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, '');
    const tempDetected = detectCardNetwork(digits, checkout?.methods ?? []);
    const maxDigits = tempDetected.lengths[tempDetected.lengths.length - 1] ?? 19;
    const truncated = digits.slice(0, maxDigits);
    setCardNumber(formatCardPan(truncated, tempDetected.gaps));
  }

  function handleCvvChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, detected.codeSize);
    setCvv(digits);
  }

  function handleDniChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
    setDni(formatDni(digits));
  }

  if (confirmed) {
    const remainingArs = Math.max(0, confirmed.servicePriceArs - confirmed.depositArs);
    return (
      <div className="payway-reservation payway-reservation-v5 reserva-v5">
        <main className="site-container confirmation">
          <div className="confirmation-mark"><Check size={28} /></div>
          <h1>Turno confirmado</h1>
          <p className="text-sm text-muted-foreground confirmation-subtitle">Te enviamos la confirmación por mail.</p>
          <div className="confirmation-grid">
            <div className="confirmation-details">
              <dl className="summary-list" style={{ marginTop: 0 }}>
                <div><dt>Servicio</dt><dd>{confirmed.serviceName}</dd></div>
                <div><dt>Barbero</dt><dd>{confirmed.barber}</dd></div>
                <div><dt>Fecha</dt><dd className="capitalize">{confirmed.date ? dateLabel(confirmed.date) : '-'}</dd></div>
                <div><dt>Horario</dt><dd>{confirmed.time}</dd></div>
                <div><dt>Seña abonada</dt><dd>{money(confirmed.depositArs)}</dd></div>
                <div><dt>Saldo restante del servicio</dt><dd>{money(remainingArs)}</dd></div>
              </dl>
            </div>

            <section className="confirmation-place">
              <h2 className="confirmation-place-title">¿Dónde estamos?</h2>
              <p className="confirmation-place-address">San Isidro Labrador 7 · Martínez</p>
            </section>

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
              <Button
                type="button"
                className="confirmation-home action-brand confirmation-btn-home"
                aria-label="Volver al inicio"
                onClick={startNewReservation}
              >
                Volver al inicio
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="payway-reservation payway-reservation-v5 reserva-v5">
      <Booking variant="v5" onPaymentRequest={begin} />
      <Dialog
        open={open}
        onOpenChange={value => {
          if (!paying.current && !opening.current) {
            setOpen(value);
            if (!value) resetFormState();
          }
        }}
      >
        <DialogContent
          className="payway-checkout payway-checkout-v5"
          onEscapeKeyDown={e => { if (paying.current) e.preventDefault(); }}
          onPointerDownOutside={e => { if (paying.current) e.preventDefault(); }}
        >
          <DialogTitle className="payway-checkout-title">Pagá la seña a Kani con Payway</DialogTitle>
          <DialogDescription className="payway-checkout-subtitle">
            {checkout ? `Seña: ${money(checkout.depositArs)} · Pago seguro` : 'Reserva experimental con Payway'}
          </DialogDescription>
          {preparing && (
            <div className="payway-preparing py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2" role="status">
              <Clock3 size={16} className="animate-spin text-gold" />
              <span>Preparando pago seguro con Payway…</span>
            </div>
          )}
          {result && result.state !== 'unknown' && (
            <p role={result.state === 'approved' ? 'status' : 'alert'} className={`payway-result mt-2 text-sm ${result.state === 'approved' ? 'text-success' : 'text-destructive font-medium'}`}>
              {result.message}
            </p>
          )}
          {checkout && !terminal && (
            <form onSubmit={pay} autoComplete="off" noValidate data-private="redact" data-sensitive="true" className="payway-card-form">
              <input type="hidden" name="paymentMethod" value={detected.methodId ?? ''} />
              <fieldset disabled={stage !== 'idle'}>
                {/* Card Number with integrated network badge */}
                <label className="payway-field-label">
                  <span>Número de tarjeta</span>
                  <div className={`field-control payway-card-pan-control ${panStatus}`}>
                    <div className="payway-card-brand-slot">
                      <CardBrandBadge brand={detected.brand} />
                    </div>
                    <Input
                      name="card_number"
                      aria-label="Número de tarjeta"
                      inputMode="numeric"
                      autoComplete="cc-number"
                      maxLength={23}
                      placeholder="0000 0000 0000 0000"
                      className="payway-card-pan-input"
                      value={cardNumber}
                      onChange={handleCardNumberChange}
                      onBlur={() => markTouched('cardNumber')}
                      aria-invalid={panStatus === 'invalid'}
                      aria-describedby={panError ? 'card-number-error' : undefined}
                      required
                    />
                    {renderFeedback(panStatus)}
                  </div>
                  {panError && (
                    <span id="card-number-error" className="field-validation-message" role="alert">
                      {panError}
                    </span>
                  )}
                </label>

                {/* Expiry Month (70%) | Expiry Year (30%) */}
                <div className="payway-field-group">
                  <span className="payway-field-label-text">Vencimiento de tarjeta</span>
                  <div className="payway-expiry-row">
                    <div className="payway-expiry-month-col">
                      <span className={`payway-select-control ${expiryStatus === 'valid' ? 'valid' : monthInvalid ? 'invalid' : ''}`}>
                        <select
                          name="card_expiration_month"
                          aria-label="Mes de vencimiento"
                          value={month}
                          onChange={e => {
                            setMonth(e.target.value);
                            markTouched('expiry');
                          }}
                          onBlur={() => markTouched('expiry')}
                          className="payway-select"
                          required
                        >
                          <option value="">Mes</option>
                          {MONTH_OPTIONS.map(m => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </span>
                    </div>

                    <div className="payway-expiry-year-col">
                      <span className={`payway-select-control ${expiryStatus === 'valid' ? 'valid' : yearInvalid ? 'invalid' : ''}`}>
                        <select
                          name="card_expiration_year"
                          aria-label="Año de vencimiento"
                          value={year}
                          onChange={e => {
                            setYear(e.target.value);
                            markTouched('expiry');
                          }}
                          onBlur={() => markTouched('expiry')}
                          className="payway-select"
                          required
                        >
                          <option value="">Año</option>
                          {yearOptions.map(y => (
                            <option key={y.value} value={y.value}>
                              {y.label}
                            </option>
                          ))}
                        </select>
                      </span>
                    </div>
                  </div>
                  {touched.expiry && !expiryValid && (
                    <span id="expiry-error" className="field-validation-message" role="alert">
                      {monthInvalid && !year ? 'Seleccioná mes y año de vencimiento.' : 'La fecha de vencimiento debe ser posterior al mes actual.'}
                    </span>
                  )}
                </div>

                {/* CVV Security Code */}
                <div className="payway-field-group">
                  <div className="payway-label-with-help">
                    <label htmlFor="card-security-code" className="payway-field-label-text">
                      Código de seguridad
                    </label>
                    <div className="payway-help-wrapper">
                      <button
                        type="button"
                        className="payway-help-trigger"
                        aria-label="Ayuda sobre el código de seguridad"
                        aria-expanded={showCvvHelp}
                        onClick={() => setShowCvvHelp(!showCvvHelp)}
                      >
                        <HelpCircle size={15} />
                      </button>
                      {showCvvHelp && (
                        <div className="payway-help-bubble" role="tooltip">
                          {detected.codeLocation === 'front'
                            ? 'Son los 4 dígitos impresos en el frente de tu American Express.'
                            : 'Son los 3 dígitos al dorso de tu tarjeta.'}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className={`field-control ${cvvStatus}`}>
                    <Input
                      id="card-security-code"
                      name="security_code"
                      aria-label="Código de seguridad (CVV)"
                      type="password"
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      maxLength={detected.codeSize}
                      placeholder={detected.codeSize === 4 ? '1234' : '123'}
                      value={cvv}
                      onChange={handleCvvChange}
                      onBlur={() => markTouched('cvv')}
                      aria-invalid={cvvStatus === 'invalid'}
                      aria-describedby={cvvError ? 'cvv-error' : undefined}
                      required
                    />
                    {renderFeedback(cvvStatus)}
                  </span>
                  {cvvError && (
                    <span id="cvv-error" className="field-validation-message" role="alert">
                      {cvvError}
                    </span>
                  )}
                </div>

                {/* Cardholder Name */}
                <label className="payway-field-label">
                  <span>Titular de la tarjeta</span>
                  <span className={`field-control ${holderStatus}`}>
                    <Input
                      name="card_holder_name"
                      aria-label="Titular de la tarjeta"
                      autoComplete="cc-name"
                      maxLength={60}
                      placeholder="Como figura en la tarjeta"
                      value={cardHolder}
                      onChange={e => setCardHolder(e.target.value)}
                      onBlur={() => markTouched('cardHolder')}
                      aria-invalid={holderStatus === 'invalid'}
                      aria-describedby={holderError ? 'holder-error' : undefined}
                      required
                    />
                    {renderFeedback(holderStatus)}
                  </span>
                  {holderError && (
                    <span id="holder-error" className="field-validation-message" role="alert">
                      {holderError}
                    </span>
                  )}
                </label>

                {/* DNI of Cardholder */}
                <label className="payway-field-label">
                  <span>DNI del titular</span>
                  <span className={`field-control ${dniStatus}`}>
                    <Input
                      name="card_holder_doc_number"
                      aria-label="DNI del titular"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={12}
                      placeholder="12.345.678"
                      value={dni}
                      onChange={handleDniChange}
                      onBlur={() => markTouched('dni')}
                      aria-invalid={dniStatus === 'invalid'}
                      aria-describedby={dniError ? 'dni-error' : undefined}
                      required
                    />
                    {renderFeedback(dniStatus)}
                  </span>
                  {dniError && (
                    <span id="dni-error" className="field-validation-message" role="alert">
                      {dniError}
                    </span>
                  )}
                </label>

                <Button type="submit" className="action-positive payway-submit-btn" disabled={stage !== 'idle'}>
                  {stage === 'tokenizing'
                    ? 'Validando tarjeta…'
                    : stage === 'paying'
                      ? 'Procesando pago…'
                      : `Pagar seña ${checkout ? money(checkout.depositArs) : '$5.000'}`}
                </Button>
              </fieldset>
            </form>
          )}
          {result?.state === 'unknown' && (
            <div className="payway-unknown-status mt-3 p-3.5 rounded-md bg-muted/80 text-sm space-y-1.5 border border-border" role="alert">
              <p className="font-semibold text-foreground">El estado del pago está en proceso de verificación.</p>
              <p className="text-xs text-muted-foreground">Por favor no vuelvas a ingresar la tarjeta para evitar cobros duplicados. Conservá los datos de la operación y comunicate con Kani Barber Studio para verificar tu reserva.</p>
            </div>
          )}
          {!checkout && stage === 'idle' && !preparing && (
            <Button variant="outline" onClick={() => setOpen(false)}>
              {terminal ? 'Cerrar' : 'Volver a mis datos'}
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
