import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, HelpCircle, Instagram, Loader2, MapPin } from 'lucide-react';
import { Booking, type BookingPaymentDraft } from '@/components/kani/booking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { preparePaywayCheckoutFn, payPaywayDepositFn, checkPaywayPaymentStatusFn } from '@/lib/kani-payway.functions';
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

const CONFIRMED_STORAGE_KEY = 'kani:payway:confirmed-booking';
const PAID_APPOINTMENTS_STORAGE_KEY = 'kani:payway:paid-appointments';
const ACTIVE_ATTEMPT_STORAGE_KEY = 'kani:payway:active-attempt';

type StoredActiveAttempt = {
  appointmentId: string;
  attemptId: string;
  accessToken: string;
  depositArs: number;
  barber?: string;
  serviceName?: string;
  date?: string;
  time?: string;
  clientName?: string;
};

function readActiveAttempt(): StoredActiveAttempt | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_ATTEMPT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.appointmentId === 'string' && typeof parsed.attemptId === 'string' && typeof parsed.accessToken === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function persistActiveAttempt(data: StoredActiveAttempt) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ACTIVE_ATTEMPT_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function clearActiveAttempt() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(ACTIVE_ATTEMPT_STORAGE_KEY);
  } catch {}
}

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
  const [pendingCheck, setPendingCheck] = useState<{
    appointmentId: string;
    attemptId: string;
    accessToken: string;
    depositArs: number;
  } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [pollExhausted, setPollExhausted] = useState(false);
  const initialAttempt = useMemo(() => readActiveAttempt(), []);
  const [isPaymentChecking, setIsPaymentChecking] = useState(() => Boolean(initialAttempt));

  // Modern Payway Form State
  const [cardNumber, setCardNumber] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [cvv, setCvv] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [dni, setDni] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [showCvvHelp, setShowCvvHelp] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (open) {
      document.body.setAttribute('data-payway-modal-open', 'true');
    } else {
      document.body.removeAttribute('data-payway-modal-open');
    }
    return () => {
      document.body.removeAttribute('data-payway-modal-open');
    };
  }, [open]);

  const draftRef = useRef<BookingPaymentDraft | null>(null);
  const paidAppointmentsRef = useRef<Set<string>>(readPaidAppointments());
  const opening = useRef(false);
  const paying = useRef(false);
  const isApprovedConfirmed = Boolean(confirmed) || (result?.state === 'approved' && result?.appointmentConfirmed === true);
  const hasPendingPayment = Boolean(pendingCheck) && !isApprovedConfirmed && result?.state !== 'rejected';
  const hasReviewNotice = result?.state === 'review';
  const terminal = isApprovedConfirmed || result?.state === 'unknown' || isVerifying || pollExhausted || hasPendingPayment;

  useEffect(() => {
    if (!pendingCheck || !isVerifying) return;
    let active = true;
    let pollCount = 0;
    const maxPolls = 15; // 15 * 3s = 45s

    const intervalId = setInterval(async () => {
      if (!active) return;
      pollCount++;
      try {
        const statusRes = await checkPaywayPaymentStatusFn({
          data: {
            appointmentId: pendingCheck.appointmentId,
            attemptId: pendingCheck.attemptId,
            accessToken: pendingCheck.accessToken,
          },
        });
        if (!active) return;
        if (statusRes.state === 'approved' && statusRes.appointmentConfirmed) {
          clearInterval(intervalId);
          setIsVerifying(false);
          const activeDraft = draftRef.current;
          const confirmedBooking: ConfirmedPaywayBooking = {
            appointmentId: pendingCheck.appointmentId,
            attemptId: pendingCheck.attemptId,
            serviceName: activeDraft?.serviceName ?? 'Corte',
            barber: activeDraft?.barber ?? 'Lautaro',
            date: activeDraft?.date ?? '',
            time: activeDraft?.time ?? '',
            clientName: activeDraft?.name ?? '',
            depositArs: pendingCheck.depositArs,
            servicePriceArs: resolveServicePrice(activeDraft?.serviceName ?? 'Corte', configuredServices),
          };
          paidAppointmentsRef.current.add(pendingCheck.appointmentId);
          persistConfirmedBooking(confirmedBooking);
          setResult(statusRes);
          setConfirmed(confirmedBooking);
          setOpen(false);
          if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
            window.scrollTo({ top: 0, behavior: 'instant' });
          }
          return;
        }
        if (statusRes.state === 'rejected') {
          clearInterval(intervalId);
          setIsVerifying(false);
          setPendingCheck(null);
          setResult(statusRes);
          return;
        }
        if (statusRes.state === 'review') {
          clearInterval(intervalId);
          setIsVerifying(false);
          setResult(statusRes);
          return;
        }
      } catch {
        // Transient error; continue polling
      }
      if (pollCount >= maxPolls) {
        clearInterval(intervalId);
        if (active) {
          setIsVerifying(false);
          setPollExhausted(true);
        }
      }
    }, 3000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [pendingCheck, isVerifying, configuredServices]);

  // Restore active payment verification on reload / reopening page
  useEffect(() => {
    const stored = readActiveAttempt();
    if (!stored) {
      setIsPaymentChecking(false);
      return;
    }
    setPendingCheck({
      appointmentId: stored.appointmentId,
      attemptId: stored.attemptId,
      accessToken: stored.accessToken,
      depositArs: stored.depositArs,
    });
    draftRef.current = {
      barber: stored.barber ?? 'Lautaro',
      serviceName: stored.serviceName ?? 'Corte',
      date: stored.date ?? '',
      time: stored.time ?? '',
      name: stored.clientName ?? '',
      email: '',
      phone: '',
      notes: '',
    };
    checkPaywayPaymentStatusFn({
      data: {
        appointmentId: stored.appointmentId,
        attemptId: stored.attemptId,
        accessToken: stored.accessToken,
      },
    })
      .then((statusRes) => {
        setIsPaymentChecking(false);
        if (statusRes.state === 'approved' && statusRes.appointmentConfirmed) {
          clearActiveAttempt();
          const confirmedBooking: ConfirmedPaywayBooking = {
            appointmentId: stored.appointmentId,
            attemptId: stored.attemptId,
            serviceName: stored.serviceName ?? 'Corte',
            barber: stored.barber ?? 'Lautaro',
            date: stored.date ?? '',
            time: stored.time ?? '',
            clientName: stored.clientName ?? '',
            depositArs: stored.depositArs,
            servicePriceArs: resolveServicePrice(stored.serviceName ?? 'Corte', configuredServices),
          };
          paidAppointmentsRef.current.add(stored.appointmentId);
          persistConfirmedBooking(confirmedBooking);
          setResult(statusRes);
          setConfirmed(confirmedBooking);
          setOpen(false);
        } else if (statusRes.state === 'rejected') {
          clearActiveAttempt();
          setPendingCheck(null);
          setResult(statusRes);
        } else if (statusRes.state === 'review') {
          clearActiveAttempt();
          setPendingCheck(null);
          setResult(statusRes);
        } else {
          setResult(statusRes);
          setIsVerifying(true);
        }
      })
      .catch(() => {
        setIsPaymentChecking(false);
        setIsVerifying(true);
      });
  }, [configuredServices]);

  // Slower background poll when modal is closed or fast poll exhausted
  useEffect(() => {
    if (!pendingCheck || isVerifying || isApprovedConfirmed || result?.state === 'rejected' || result?.state === 'review') {
      return;
    }
    let active = true;
    const bgIntervalId = setInterval(async () => {
      if (!active) return;
      try {
        const statusRes = await checkPaywayPaymentStatusFn({
          data: {
            appointmentId: pendingCheck.appointmentId,
            attemptId: pendingCheck.attemptId,
            accessToken: pendingCheck.accessToken,
          },
        });
        if (!active) return;
        if (statusRes.state === 'approved' && statusRes.appointmentConfirmed) {
          clearInterval(bgIntervalId);
          clearActiveAttempt();
          const activeDraft = draftRef.current;
          const confirmedBooking: ConfirmedPaywayBooking = {
            appointmentId: pendingCheck.appointmentId,
            attemptId: pendingCheck.attemptId,
            serviceName: activeDraft?.serviceName ?? 'Corte',
            barber: activeDraft?.barber ?? 'Lautaro',
            date: activeDraft?.date ?? '',
            time: activeDraft?.time ?? '',
            clientName: activeDraft?.name ?? '',
            depositArs: pendingCheck.depositArs,
            servicePriceArs: resolveServicePrice(activeDraft?.serviceName ?? 'Corte', configuredServices),
          };
          paidAppointmentsRef.current.add(pendingCheck.appointmentId);
          persistConfirmedBooking(confirmedBooking);
          setResult(statusRes);
          setConfirmed(confirmedBooking);
          setOpen(false);
          setPendingCheck(null);
        } else if (statusRes.state === 'rejected') {
          clearInterval(bgIntervalId);
          clearActiveAttempt();
          setPendingCheck(null);
          setResult(statusRes);
          setPollExhausted(false);
        } else if (statusRes.state === 'review') {
          clearInterval(bgIntervalId);
          clearActiveAttempt();
          setPendingCheck(null);
          setResult(statusRes);
        }
      } catch {
        /* Background poll transient ignore */
      }
    }, 10000);

    return () => {
      active = false;
      clearInterval(bgIntervalId);
    };
  }, [pendingCheck, isVerifying, isApprovedConfirmed, result, configuredServices]);

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
    setShowCvvHelp(false);
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
    if (opening.current || hasPendingPayment || result?.state === 'unknown' || result?.state === 'review') { setOpen(true); return; }
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
        clearActiveAttempt();
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
      if (response.state === 'rejected' || response.state === 'review') {
        clearActiveAttempt();
        setPendingCheck(null);
        setResult(response);
        return;
      }
      if (response.state === 'unknown' || response.state === 'verifying') {
        const activeDraft = draftRef.current;
        persistActiveAttempt({
          appointmentId: checkout.appointmentId,
          attemptId: checkout.attemptId,
          accessToken: checkout.accessToken,
          depositArs: checkout.depositArs,
          barber: activeDraft?.barber,
          serviceName: activeDraft?.serviceName,
          date: activeDraft?.date,
          time: activeDraft?.time,
          clientName: activeDraft?.name,
        });
        setPendingCheck({
          appointmentId: checkout.appointmentId,
          attemptId: checkout.attemptId,
          accessToken: checkout.accessToken,
          depositArs: checkout.depositArs,
        });
        setIsVerifying(true);
        setPollExhausted(false);
        setResult(response);
        return;
      }
      setResult(response);
    } catch {
      if (sent && checkout) {
        const activeDraft = draftRef.current;
        persistActiveAttempt({
          appointmentId: checkout.appointmentId,
          attemptId: checkout.attemptId,
          accessToken: checkout.accessToken,
          depositArs: checkout.depositArs,
          barber: activeDraft?.barber,
          serviceName: activeDraft?.serviceName,
          date: activeDraft?.date,
          time: activeDraft?.time,
          clientName: activeDraft?.name,
        });
        setPendingCheck({
          appointmentId: checkout.appointmentId,
          attemptId: checkout.attemptId,
          accessToken: checkout.accessToken,
          depositArs: checkout.depositArs,
        });
        setIsVerifying(true);
        setPollExhausted(false);
        setResult({ state: 'unknown', message: PAYWAY_MESSAGES.verifying });
        setCheckout(null);
      } else {
        setResult({ state: 'recoverable', message: 'No pudimos validar la tarjeta. Revisá sus datos e intentá nuevamente.' });
      }
    } finally {
      form.reset();
      resetFormState();
      paying.current = false;
      setStage('idle');
    }
  }

  function startNewReservation() {
    clearConfirmedBookingView();
    clearActiveAttempt();
    resetFormState();
    draftRef.current = null;
    setPendingCheck(null);
    setIsVerifying(false);
    setPollExhausted(false);
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
            <Button
              type="button"
              className="action-brand booking-next-button confirmation-btn-home"
              aria-label="Volver al inicio"
              onClick={startNewReservation}
            >
              Volver al inicio
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="payway-reservation">
      <Booking
        variant="v3"
        onPaymentRequest={begin}
        paymentActionLabel={hasReviewNotice ? 'Ver detalle de revisión' : hasPendingPayment ? 'Ver estado del pago' : undefined}
        paymentNotice={
          hasReviewNotice ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm text-amber-600 dark:text-amber-400" role="alert">
              <p className="font-semibold">Pago registrado en revisión</p>
              <p className="mt-1 text-xs opacity-90">{PAYWAY_MESSAGES.late_review}</p>
            </div>
          ) : hasPendingPayment ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm text-amber-600 dark:text-amber-400" role="alert">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse inline-block" />
                <p className="font-semibold">Pago en verificación</p>
              </div>
              <p className="mt-1 text-xs opacity-90">
                Estamos comprobando tu pago. Podés cerrar o ver el estado en cualquier momento. No vuelvas a pagar mientras la verificación esté pendiente.
              </p>
            </div>
          ) : undefined
        }
        isPaymentChecking={isPaymentChecking}
        initialStep={initialAttempt ? 4 : undefined}
        initialService={
          initialAttempt?.serviceName?.toLowerCase().includes('barba') && !initialAttempt?.serviceName?.toLowerCase().includes('corte')
            ? 'barba'
            : initialAttempt?.serviceName?.toLowerCase().includes('barba')
              ? 'corte-barba'
              : initialAttempt
                ? 'corte'
                : undefined
        }
        initialBarber={(initialAttempt?.barber as any) ?? undefined}
        initialDate={initialAttempt?.date}
        initialTime={initialAttempt?.time}
        initialContact={initialAttempt?.clientName ? { name: initialAttempt.clientName, email: '', phone: '', notes: '' } : undefined}
      />
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
          <DialogTitle className="payway-checkout-title">Pagá la seña a Kani con Payway</DialogTitle>
          <DialogDescription className="payway-checkout-subtitle">
            {checkout ? `Seña: ${money(checkout.depositArs)} · Pago seguro` : 'Reserva experimental con Payway'}
          </DialogDescription>
          {preparing && <p role="status">Preparando pago seguro…</p>}
          {result && !isVerifying && !pollExhausted && result.state !== 'unknown' && result.state !== 'review' && (
            <p role={result.state === 'approved' ? 'status' : 'alert'} className="payway-result">{result.message}</p>
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
                            <option key={m.value} value={m.value} disabled={isCurrentYearSelected && m.num < currentMonth}>
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
                        {expiryStatus === 'valid' && (
                          <span className="field-validation-icon valid" style={{ right: '28px' }} aria-hidden="true">
                            <Check size={14} />
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                  {expiryError && (
                    <span id="expiry-error" className="field-validation-message" role="alert">
                      {expiryError}
                    </span>
                  )}
                </div>

                {/* Security Code (CVV) in independent row with contextual help */}
                <div className="payway-field-group">
                  <div className="payway-label-with-help">
                    <label htmlFor="card-security-code" className="payway-field-label-text">
                      Código de seguridad (CVV)
                    </label>
                    <div className="payway-help-wrapper">
                      <button
                        type="button"
                        className="payway-help-trigger"
                        aria-label="Ayuda sobre el CVV"
                        aria-expanded={showCvvHelp}
                        aria-controls="cvv-help-bubble"
                        onClick={() => setShowCvvHelp(prev => !prev)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') setShowCvvHelp(false);
                        }}
                      >
                        <HelpCircle size={14} aria-hidden="true" />
                      </button>
                      {showCvvHelp && (
                        <div
                          id="cvv-help-bubble"
                          role="tooltip"
                          className="payway-help-bubble"
                        >
                          {detected.brand === 'american-express'
                            ? '4 dígitos del frente de la tarjeta.'
                            : '3 dígitos del reverso de la tarjeta.'}
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
          {isVerifying && (
            <div className="payway-verifying-box space-y-4 py-4 text-center" role="status">
              <div className="flex justify-center items-center">
                <Loader2 className="animate-spin text-muted-foreground" size={36} />
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-base">Estamos verificando tu pago</p>
                <p className="text-sm text-muted-foreground">
                  Estamos verificando tu pago. Podés cerrar esta ventana; seguiremos comprobándolo. No vuelvas a pagar mientras la verificación esté pendiente.
                </p>
              </div>
            </div>
          )}
          {pollExhausted && (
            <div className="space-y-2 text-center py-2" role="alert">
              <p className="text-sm font-semibold">Estamos verificando tu pago</p>
              <p className="text-xs text-muted-foreground">
                Estamos verificando tu pago. Podés cerrar esta ventana; seguiremos comprobándolo. No vuelvas a pagar mientras la verificación esté pendiente.
              </p>
            </div>
          )}
          {result?.state === 'unknown' && !isVerifying && !pollExhausted && (
            <div className="space-y-2 text-center py-2" role="alert">
              <p className="text-sm font-semibold">Verificación de pago pendiente</p>
              <p className="text-xs text-muted-foreground">
                Estamos verificando tu pago. Podés cerrar esta ventana; seguiremos comprobándolo. No vuelvas a pagar mientras la verificación esté pendiente.
              </p>
            </div>
          )}
          {result?.state === 'review' && (
            <div className="space-y-2 text-center py-2" role="alert">
              <p className="text-sm font-semibold">Pago registrado en revisión</p>
              <p className="text-xs text-muted-foreground">
                Tu pago fue recibido, pero el horario seleccionado ya no está disponible. Nos comunicaremos con vos a la brevedad para coordinar tu turno o reintegro.
              </p>
            </div>
          )}
          {!checkout && stage === 'idle' && !preparing && (
            <Button variant="outline" onClick={() => setOpen(false)}>
              {terminal || hasPendingPayment || isVerifying ? 'Cerrar' : 'Volver a mis datos'}
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
