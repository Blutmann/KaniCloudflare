import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, Instagram, MapPin } from 'lucide-react';
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
import { CardBrandBadge } from './card-brand-badges';

const CONFIRMED_STORAGE_KEY = 'kani:payway:confirmed-booking';
const PAID_APPOINTMENTS_STORAGE_KEY = 'kani:payway:paid-appointments';

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
    window.history.replaceState({ ...(window.history.state ?? {}), kaniPaywayConfirmed: true, appointmentId: booking.appointmentId }, '');
  } catch {
    /* Storage access is best-effort; in-memory and server guards remain authoritative. */
  }
}

function clearConfirmedBookingView() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CONFIRMED_STORAGE_KEY);
    if (window.history.state?.kaniPaywayConfirmed) {
      window.history.replaceState({ ...(window.history.state ?? {}), kaniPaywayConfirmed: false }, '');
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

export function PaywayBooking() {
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [checkout, setCheckout] = useState<PaywayCheckout | null>(null);
  const [result, setResult] = useState<PaywayResult | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedPaywayBooking | null>(() => readConfirmedBooking());
  const [configuredServices, setConfiguredServices] = useState<ConfiguredService[]>(() => services.map(s => ({ ...s })));
  const [stage, setStage] = useState<'idle' | 'tokenizing' | 'paying'>('idle');

  // Modern Payway Form State
  const [cardNumber, setCardNumber] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [cvv, setCvv] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [dni, setDni] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const draftRef = useRef<BookingPaymentDraft | null>(null);
  const paidAppointmentsRef = useRef<Set<string>>(readPaidAppointments());
  const opening = useRef(false);
  const paying = useRef(false);
  const isApprovedConfirmed = Boolean(confirmed) || (result?.state === 'approved' && result?.appointmentConfirmed === true);
  const terminal = isApprovedConfirmed || result?.state === 'unknown';

  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentYearShort = String(currentYear).slice(-2);
  const currentMonth = now.getMonth() + 1;
  const yearOptions = useMemo(() => getYearOptions(now), [now]);
  const isCurrentYearSelected = Boolean(year && (year === currentYearShort || year === String(currentYear)));

  const detected = useMemo(
    () => detectCardNetwork(cardNumber, checkout?.methods ?? []),
    [cardNumber, checkout?.methods]
  );

  // Field validations
  const panValidation = useMemo(
    () => validatePan(cardNumber, detected, checkout?.methods ?? []),
    [cardNumber, detected, checkout?.methods]
  );
  const cleanPanDigits = cardNumber.replace(/\D/g, '');
  const isPanEmpty = !cleanPanDigits;
  const showPanInvalid = (touched.cardNumber || submitAttempted) && (isPanEmpty || panValidation.status === 'invalid');
  const showPanValid = !isPanEmpty && panValidation.status === 'valid';
  const panStatus = showPanValid ? 'valid' : showPanInvalid ? 'invalid' : 'idle';
  const panError = showPanInvalid
    ? (isPanEmpty ? 'Ingresá el número de tarjeta.' : panValidation.errorMessage)
    : null;

  const expiryValidation = useMemo(() => validateExpiry(month, year, now), [month, year, now]);
  const isExpiryIncomplete = !month || !year;
  const showExpiryInvalid = (touched.expiry || submitAttempted) && (isExpiryIncomplete || expiryValidation.status === 'invalid');
  const showExpiryValid = !isExpiryIncomplete && expiryValidation.status === 'valid';
  const expiryStatus = showExpiryValid ? 'valid' : showExpiryInvalid ? 'invalid' : 'idle';
  const expiryError = showExpiryInvalid
    ? (isExpiryIncomplete ? 'Seleccioná mes y año de vencimiento.' : expiryValidation.errorMessage)
    : null;
  const monthInvalid = (touched.expiry || submitAttempted) && (!month || (isCurrentYearSelected && parseInt(month, 10) < currentMonth));
  const yearInvalid = (touched.expiry || submitAttempted) && !year;

  const cvvValidation = useMemo(() => validateCvv(cvv, detected.codeSize), [cvv, detected.codeSize]);
  const isCvvEmpty = !cvv.trim();
  const showCvvInvalid = (touched.cvv || submitAttempted) && (isCvvEmpty || cvvValidation.status === 'invalid');
  const showCvvValid = !isCvvEmpty && cvvValidation.status === 'valid';
  const cvvStatus = showCvvValid ? 'valid' : showCvvInvalid ? 'invalid' : 'idle';
  const cvvError = showCvvInvalid
    ? (isCvvEmpty ? `Ingresá los ${detected.codeSize} dígitos de seguridad.` : cvvValidation.errorMessage)
    : null;

  const holderValidation = useMemo(() => validateCardholder(cardHolder), [cardHolder]);
  const isHolderEmpty = !cardHolder.trim();
  const showHolderInvalid = (touched.cardHolder || submitAttempted) && (isHolderEmpty || holderValidation.status === 'invalid');
  const showHolderValid = !isHolderEmpty && holderValidation.status === 'valid';
  const holderStatus = showHolderValid ? 'valid' : showHolderInvalid ? 'invalid' : 'idle';
  const holderError = showHolderInvalid
    ? (isHolderEmpty ? 'Ingresá el nombre como figura en la tarjeta.' : holderValidation.errorMessage)
    : null;

  const dniValidation = useMemo(() => validateDni(dni), [dni]);
  const isDniEmpty = !dni.replace(/\D/g, '');
  const showDniInvalid = (touched.dni || submitAttempted) && (isDniEmpty || dniValidation.status === 'invalid');
  const showDniValid = !isDniEmpty && dniValidation.status === 'valid';
  const dniStatus = showDniValid ? 'valid' : showDniInvalid ? 'invalid' : 'idle';
  const dniError = showDniInvalid
    ? (isDniEmpty ? 'Ingresá el DNI del titular.' : dniValidation.errorMessage)
    : null;

  function markTouched(field: string) {
    setTouched(current => ({ ...current, [field]: true }));
  }

  function resetFormState() {
    setCardNumber('');
    setMonth('');
    setYear('');
    setCvv('');
    setCardHolder('');
    setDni('');
    setTouched({});
    setSubmitAttempted(false);
  }

  function renderFeedback(status: 'idle' | 'valid' | 'invalid') {
    if (status === 'idle') return null;
    return (
      <span className={`field-validation-icon ${status}`} aria-hidden="true">
        {status === 'valid' ? <Check size={14} /> : <CircleAlert size={14} />}
      </span>
    );
  }

  useEffect(() => {
    let cancelled = false;
    void readConfiguredServices().then(next => {
      if (!cancelled && next.length) setConfiguredServices(next);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!confirmed || typeof window === 'undefined') return;
    const handlePopState = () => {
      const stored = readConfirmedBooking();
      if (stored) {
        setConfirmed(stored);
        setOpen(false);
        try {
          window.history.pushState({ ...(window.history.state ?? {}), kaniPaywayConfirmed: true, appointmentId: stored.appointmentId }, '');
        } catch {
          /* Ignore history errors. */
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [confirmed]);

  async function begin(draft: BookingPaymentDraft) {
    if (isApprovedConfirmed) return;
    if (opening.current || result?.state === 'unknown') { setOpen(true); return; }
    draftRef.current = draft;
    if (draft.name && !cardHolder) {
      setCardHolder(draft.name);
    }
    opening.current = true;
    setOpen(true); setPreparing(true); setResult(null); setCheckout(null);
    try {
      const response = await preparePaywayCheckoutFn({ data: draft });
      if (response.ready) {
        if (paidAppointmentsRef.current.has(response.checkout.appointmentId)) {
          setOpen(false);
          return;
        }
        setCheckout(response.checkout);
      } else {
        setResult({ state: response.state ?? 'unavailable', message: response.message });
      }
    } catch { setResult({ state: 'unavailable', message: PAYWAY_MESSAGES.unavailable }); }
    finally { opening.current = false; setPreparing(false); }
  }

  async function pay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (paying.current || terminal || !checkout || paidAppointmentsRef.current.has(checkout.appointmentId)) return;
    const form = event.currentTarget;

    setSubmitAttempted(true);

    const hasPanError = isPanEmpty || panValidation.status === 'invalid';
    const hasExpiryError = isExpiryIncomplete || expiryValidation.status === 'invalid';
    const hasCvvError = isCvvEmpty || cvvValidation.status === 'invalid';
    const hasHolderError = isHolderEmpty || holderValidation.status === 'invalid';
    const hasDniError = isDniEmpty || dniValidation.status === 'invalid';

    if (hasPanError || hasExpiryError || hasCvvError || hasHolderError || hasDniError) {
      if (hasPanError) {
        (form.elements.namedItem('card_number') as HTMLElement | null)?.focus();
      } else if (hasExpiryError) {
        if (!month) {
          (form.elements.namedItem('card_expiration_month') as HTMLElement | null)?.focus();
        } else {
          (form.elements.namedItem('card_expiration_year') as HTMLElement | null)?.focus();
        }
      } else if (hasCvvError) {
        (form.elements.namedItem('security_code') as HTMLElement | null)?.focus();
      } else if (hasHolderError) {
        (form.elements.namedItem('card_holder_name') as HTMLElement | null)?.focus();
      } else if (hasDniError) {
        (form.elements.namedItem('card_holder_doc_number') as HTMLElement | null)?.focus();
      }
      return;
    }

    paying.current = true; setStage('tokenizing'); setResult(null);
    let sent = false;
    try {
      const token = await tokenizePaywayForm(form, checkout);
      const paymentMethodEl = form.elements.namedItem('paymentMethod') as HTMLInputElement | HTMLSelectElement | null;
      const paymentMethodId = Number(paymentMethodEl?.value ?? detected.methodId ?? 0);
      form.reset(); // Clear all card values before calling Kani.
      resetFormState();
      setStage('paying'); sent = true;
      const response = await payPaywayDepositFn({ data: {
        appointmentId: checkout.appointmentId, attemptId: checkout.attemptId,
        accessToken: checkout.accessToken, ...token, paymentMethodId,
      } });
      // A rejection consumes this attempt; a new server attempt is required, never reuse it.
      if (response.state !== 'recoverable') setCheckout(null);
      if (response.state === 'approved' && response.appointmentConfirmed === true) {
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
      setResult({ state: sent ? 'unknown' : 'recoverable', message: sent ? PAYWAY_MESSAGES.unknown : 'No pudimos validar la tarjeta. Revisá sus datos e intentá nuevamente.' });
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
      <div className="payway-reservation">
        <main className="site-container confirmation">
          <div className="confirmation-mark"><Check size={30} /></div>
          <h1>Turno confirmado</h1>
          <p className="confirmation-lead text-muted-foreground">Tu turno está confirmado.</p>
          <p className="text-sm text-muted-foreground mt-1">Te enviamos la confirmación por correo electrónico.</p>
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
            <h2 className="text-sm font-medium">Kani Barber Studio</h2>
            <p className="mt-2 text-sm text-muted-foreground">San Isidro Labrador 7 · Martínez, Provincia de Buenos Aires</p>
            <div className="confirmation-actions">
              <Button type="button" className="confirmation-home action-brand" aria-label="Volver a reservar" onClick={startNewReservation}>
                Volver al inicio
              </Button>
              <Button asChild variant="outline" className="confirmation-secondary">
                <a href="https://www.google.com/maps/place/KANI+BARBER+STUDIO/data=!4m2!3m1!1s0x0:0x48bcfe7b2ea7ba60" target="_blank" rel="noreferrer"><MapPin size={16} /> Ver ubicación</a>
              </Button>
              <Button asChild variant="outline" className="confirmation-secondary">
                <a href="https://www.instagram.com/kanibarberstudio/" target="_blank" rel="noreferrer"><Instagram size={16} /> Instagram</a>
              </Button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="payway-reservation">
      <Booking variant="v3" onPaymentRequest={begin} />
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
          className="payway-checkout"
          onEscapeKeyDown={e => { if (paying.current) e.preventDefault(); }}
          onPointerDownOutside={e => { if (paying.current) e.preventDefault(); }}
        >
          <DialogTitle>Pagar seña con Payway</DialogTitle>
          <DialogDescription>
            {checkout ? `Seña: ${money(checkout.depositArs)} · Pago seguro` : 'Reserva experimental con Payway'}
          </DialogDescription>
          {preparing && <p role="status">Preparando pago seguro…</p>}
          {result && <p role={result.state === 'approved' ? 'status' : 'alert'} className="payway-result">{result.message}</p>}
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

                {/* Expiry Month | Expiry Year | Security Code (CVV) */}
                <div className="payway-card-row">
                  <label className="payway-field-label">
                    <span>Mes</span>
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
                          <option key={m.value} value={m.value} disabled={isCurrentYearSelected && m.num < currentMonth}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </span>
                  </label>

                  <label className="payway-field-label">
                    <span>Año</span>
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
                      {expiryStatus === 'valid' && (
                        <span className="field-validation-icon valid" style={{ right: '28px' }} aria-hidden="true">
                          <Check size={14} />
                        </span>
                      )}
                    </span>
                  </label>

                  <label className="payway-field-label">
                    <span>Código</span>
                    <span className={`field-control ${cvvStatus}`}>
                      <Input
                        name="security_code"
                        aria-label="Código de seguridad"
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
                  </label>
                </div>
                {expiryError && (
                  <span id="expiry-error" className="field-validation-message" role="alert">
                    {expiryError}
                  </span>
                )}
                {cvvError && (
                  <span id="cvv-error" className="field-validation-message" role="alert">
                    {cvvError}
                  </span>
                )}

                {/* Cardholder Name */}
                <label className="payway-field-label">
                  <span>Titular</span>
                  <span className={`field-control ${holderStatus}`}>
                    <Input
                      name="card_holder_name"
                      aria-label="Nombre del titular"
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
                  {stage === 'tokenizing' ? 'Validando tarjeta…' : stage === 'paying' ? 'Procesando pago…' : 'Pagar seña'}
                </Button>
              </fieldset>
            </form>
          )}
          {result?.state === 'unknown' && (
            <p className="text-sm">Conservá esta pantalla y contactá al estudio. Tu turno todavía no está confirmado.</p>
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
