import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, CircleAlert, HelpCircle, Instagram, Loader2, MapPin, X } from 'lucide-react';
import { Booking, mapBenefitErrorMessage, type BookingPaymentDraft } from '@/components/kani/booking';
import { clearBookingDraft } from '@/lib/kani-booking-draft';
import { validateBenefitCodeQuoteFn } from '@/lib/kani-benefit-codes.functions';
import { normalizeBenefitCode, type BenefitQuote } from '@/lib/kani-benefit-codes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { preparePaywayCheckoutFn, payPaywayDepositFn, checkPaywayPaymentStatusFn } from '@/lib/kani-payway.functions';
import { tokenizePaywayForm } from '@/lib/kani-payway.browser';
import { PAYWAY_MESSAGES, type PaywayCheckout, type PaywayResult } from '@/lib/kani-payway';
import { isAvailabilityConflictError, SlotUnavailableConflictError } from '@/lib/kani-booking-slots';
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
import { BookingConfirmedScreen } from '@/components/kani/booking-confirmed-screen';
import {
  BookingConfirmationStatusView,
  type SmartConfirmationErrorKind,
  type SmartConfirmationPhase,
} from './booking-confirmation-modal';
import { CardBrandBadge } from './card-brand-badges';
import type { LiquidGlassMotionAdapter } from './liquid-glass-motion.types';
import { isLiquidGlassPath } from './liquid-glass-shell';
import {
  playConfirmationChime,
  readConfirmationSoundEnabled,
  unlockConfirmationAudio,
} from './liquid-glass-feedback';

const PROLONGED_CONFIRMATION_DELAY_MS = 4500;

function isLikelyNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String((err as any)?.message ?? err ?? '').toLowerCase();
  return (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('fetch') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('aborted') ||
    msg.includes('err_internet') ||
    msg.includes('load failed')
  );
}

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
  benefitType?: 'NO_DEPOSIT' | 'FREE_SERVICE' | 'PERCENT_10' | 'PERCENT_50' | null;
  benefitCode?: string | null;
  originalPriceArs?: number | null;
  discountAmountArs?: number | null;
  finalPriceArs?: number | null;
  onlineDepositArs?: number | null;
  inPersonBalanceArs?: number | null;
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
  clearBookingDraft();
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

export function PaywayBooking({
  homeUrl = '/reservar',
  experimentalMotion,
}: {
  homeUrl?: string;
  experimentalMotion?: LiquidGlassMotionAdapter;
} = {}) {
  const isOldClassic = homeUrl.endsWith('-old') || homeUrl.includes('-old/');
  const isLiquid = Boolean(experimentalMotion) || (!isOldClassic && isLiquidGlassPath(homeUrl));
  const termsUrl = isOldClassic ? '/terminos-y-condiciones-old' : '/terminos-y-condiciones';
  const privacyUrl = isOldClassic ? '/politica-de-privacidad-old' : '/politica-de-privacidad';
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
  const [invalidBenefitNotice, setInvalidBenefitNotice] = useState<string | null>(null);
  const [modalDiscountOpen, setModalDiscountOpen] = useState(false);
  const [modalDiscountCode, setModalDiscountCode] = useState('');
  const [modalDiscountLoading, setModalDiscountLoading] = useState(false);
  const [modalDiscountError, setModalDiscountError] = useState<string | null>(null);
  const [modalDiscountApplied, setModalDiscountApplied] = useState<BenefitQuote | null>(null);
  const [externalBenefitSync, setExternalBenefitSync] = useState<{
    version: number;
    code: string;
    quote: BenefitQuote | null;
  } | null>(null);
  const modalDiscountInFlightRef = useRef(false);
  const [smartPhase, setSmartPhase] = useState<SmartConfirmationPhase>('idle');
  const [smartError, setSmartError] = useState<{
    kind: SmartConfirmationErrorKind;
    detail: string;
    canRetry: boolean;
  } | null>(null);
  const [manualStatusChecking, setManualStatusChecking] = useState(false);

  // V12.47.23: Si la confirmación sigue pendiente más allá del tiempo habitual, pasar a verificación prolongada
  useEffect(() => {
    if (smartPhase !== 'processing') return;
    const timer = window.setTimeout(() => {
      setSmartPhase(current => (current === 'processing' ? 'prolonged' : current));
    }, PROLONGED_CONFIRMATION_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [smartPhase]);

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
  const [cvvHelpPlacement, setCvvHelpPlacement] = useState<'top' | 'bottom'>('top');
  const cvvHelpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showCvvHelp) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (cvvHelpRef.current && !cvvHelpRef.current.contains(event.target as Node)) {
        setShowCvvHelp(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowCvvHelp(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showCvvHelp]);

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

  function notifyVerifiedConfirmationSound(appointmentId: string) {
    if (!isLiquid || !readConfirmationSoundEnabled()) return;
    playConfirmationChime(appointmentId, { enabled: true });
  }
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
          clearActiveAttempt();
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
          setSmartPhase('idle');
          setSmartError(null);
          setConfirmed(confirmedBooking);
          notifyVerifiedConfirmationSound(confirmedBooking.appointmentId);
          setOpen(false);
          if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
            window.scrollTo({ top: 0, behavior: 'instant' });
          }
          return;
        }
        if (statusRes.state === 'rejected') {
          clearInterval(intervalId);
          clearActiveAttempt();
          setIsVerifying(false);
          setPendingCheck(null);
          setResult(statusRes);
          setSmartError({
            kind: 'payment_rejected',
            detail: statusRes.message || PAYWAY_MESSAGES.rejected,
            canRetry: true,
          });
          setSmartPhase('error');
          return;
        }
        if (statusRes.state === 'review') {
          clearInterval(intervalId);
          clearActiveAttempt();
          setIsVerifying(false);
          setPendingCheck(null);
          setResult(statusRes);
          setSmartError({
            kind: 'payment_review',
            detail: statusRes.message || PAYWAY_MESSAGES.late_review,
            canRetry: false,
          });
          setSmartPhase('error');
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
          setSmartPhase('prolonged');
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
          setSmartPhase('idle');
          setSmartError(null);
          setConfirmed(confirmedBooking);
          notifyVerifiedConfirmationSound(confirmedBooking.appointmentId);
          setOpen(false);
        } else if (statusRes.state === 'rejected') {
          clearActiveAttempt();
          setPendingCheck(null);
          setResult(statusRes);
          setSmartError({
            kind: 'payment_rejected',
            detail: statusRes.message || PAYWAY_MESSAGES.rejected,
            canRetry: true,
          });
          setSmartPhase('error');
        } else if (statusRes.state === 'review') {
          clearActiveAttempt();
          setPendingCheck(null);
          setResult(statusRes);
          setSmartError({
            kind: 'payment_review',
            detail: statusRes.message || PAYWAY_MESSAGES.late_review,
            canRetry: false,
          });
          setSmartPhase('error');
        } else {
          setResult(statusRes);
          setIsVerifying(true);
          setSmartPhase('prolonged');
        }
      })
      .catch(() => {
        setIsPaymentChecking(false);
        setIsVerifying(true);
        setSmartPhase('prolonged');
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
          setSmartPhase('idle');
          setSmartError(null);
          setConfirmed(confirmedBooking);
          notifyVerifiedConfirmationSound(confirmedBooking.appointmentId);
          setOpen(false);
          setPendingCheck(null);
        } else if (statusRes.state === 'rejected') {
          clearInterval(bgIntervalId);
          clearActiveAttempt();
          setPendingCheck(null);
          setResult(statusRes);
          setPollExhausted(false);
          setSmartError({
            kind: 'payment_rejected',
            detail: statusRes.message || PAYWAY_MESSAGES.rejected,
            canRetry: true,
          });
          setSmartPhase('error');
        } else if (statusRes.state === 'review') {
          clearInterval(bgIntervalId);
          clearActiveAttempt();
          setPendingCheck(null);
          setResult(statusRes);
          setSmartError({
            kind: 'payment_review',
            detail: statusRes.message || PAYWAY_MESSAGES.late_review,
            canRetry: false,
          });
          setSmartPhase('error');
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
  const isPanIncomplete = !isPanEmpty && panValidation.status === 'idle';
  const showPanInvalid =
    panValidation.status === 'invalid' ||
    ((touched.cardNumber || submitAttempted) && (isPanEmpty || isPanIncomplete));
  const showPanValid = !isPanEmpty && panValidation.status === 'valid' && detected.isSupported && Boolean(detected.methodId);
  const panStatus = showPanValid ? 'valid' : showPanInvalid ? 'invalid' : 'idle';
  const panError = showPanInvalid
    ? isPanEmpty
      ? 'Ingresá el número de tarjeta.'
      : panValidation.errorMessage ??
        (detected.rawBrand && !detected.isSupported
          ? 'Esta tarjeta no está disponible como medio de pago.'
          : 'Número de tarjeta inválido.')
    : null;

  const expiryValidation = useMemo(() => validateExpiry(month, year, now), [month, year, now]);
  const isExpiryIncomplete = !month || !year;
  const showExpiryInvalid =
    (!isExpiryIncomplete && expiryValidation.status === 'invalid') ||
    ((touched.expiry || submitAttempted) && (isExpiryIncomplete || expiryValidation.status === 'invalid'));
  const showExpiryValid = !isExpiryIncomplete && expiryValidation.status === 'valid';
  const expiryStatus = showExpiryValid ? 'valid' : showExpiryInvalid ? 'invalid' : 'idle';
  const expiryError = showExpiryInvalid
    ? (isExpiryIncomplete ? 'Seleccioná mes y año de vencimiento.' : expiryValidation.errorMessage)
    : null;
  const monthInvalid = showExpiryInvalid && (!month || expiryValidation.status === 'invalid');
  const yearInvalid = showExpiryInvalid && (!year || expiryValidation.status === 'invalid');

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

  const isCardFormValid =
    showPanValid &&
    showExpiryValid &&
    showCvvValid &&
    showHolderValid &&
    showDniValid &&
    detected.isSupported &&
    Boolean(detected.methodId);

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
    if (opening.current || smartPhase === 'processing' || hasPendingPayment || result?.state === 'unknown' || result?.state === 'review') {
      setOpen(true);
      return;
    }
    if (isLiquid && readConfirmationSoundEnabled()) {
      unlockConfirmationAudio();
    }
    draftRef.current = draft;
    const hasRejectedDiscount = Boolean(!draft.benefitCode && draft.invalidBenefitNotice);
    setInvalidBenefitNotice(draft.benefitCode ? null : (draft.invalidBenefitNotice ?? null));
    setModalDiscountOpen(hasRejectedDiscount);
    setModalDiscountCode(hasRejectedDiscount ? (draft.rejectedBenefitCode ?? '') : '');
    setModalDiscountLoading(false);
    setModalDiscountError(null);
    setModalDiscountApplied(null);

    // Flujo de confirmación directa sin seña (NO_DEPOSIT / FREE_SERVICE)
    if (draft.benefitQuote?.skipOnlinePayment && draft.benefitCode) {
      opening.current = true;
      setOpen(true);
      setPreparing(true);
      setSmartError(null);
      setSmartPhase('processing');
      setResult(null);
      setCheckout(null);
      let slotConflictToThrow: SlotUnavailableConflictError | null = null;
      try {
        const { confirmZeroDepositBookingFn } = await import('@/lib/kani-benefit-codes.functions');
        const confirmedResult = await confirmZeroDepositBookingFn({
          data: {
            benefitCode: draft.benefitCode,
            barberName: draft.barber,
            serviceName: draft.serviceName,
            bookingDate: draft.date,
            startTime: draft.time,
            clientName: draft.name,
            clientPhone: draft.phone,
            clientEmail: draft.email,
            notes: draft.notes,
          },
        });
        if (confirmedResult.success) {
          const confirmedBooking: ConfirmedPaywayBooking = {
            appointmentId: confirmedResult.appointmentId,
            attemptId: 'zero-deposit',
            serviceName: draft.serviceName,
            barber: draft.barber,
            date: draft.date,
            time: draft.time,
            clientName: draft.name,
            depositArs: 0,
            servicePriceArs: confirmedResult.calculation.originalPriceArs,
            benefitType: confirmedResult.calculation.benefitType,
            benefitCode: confirmedResult.calculation.code,
            originalPriceArs: confirmedResult.calculation.originalPriceArs,
            discountAmountArs: confirmedResult.calculation.discountAmountArs,
            finalPriceArs: confirmedResult.calculation.finalPriceArs,
            onlineDepositArs: confirmedResult.calculation.onlineDepositArs,
            inPersonBalanceArs: confirmedResult.calculation.inPersonBalanceArs,
          };
          paidAppointmentsRef.current.add(confirmedResult.appointmentId);
          persistConfirmedBooking(confirmedBooking);
          setSmartPhase('idle');
          setSmartError(null);
          setConfirmed(confirmedBooking);
          notifyVerifiedConfirmationSound(confirmedBooking.appointmentId);
          setOpen(false);
          if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
            window.scrollTo({ top: 0, behavior: 'instant' });
          }
          return;
        }
        setSmartError({
          kind: 'zero_deposit',
          detail: 'No pudimos confirmar la reserva con el beneficio. Tus datos no se perdieron.',
          canRetry: true,
        });
        setSmartPhase('error');
      } catch (err: any) {
        const rawMsg = err?.message || '';
        let friendlyMsg = 'No pudimos confirmar tu reserva. Tus datos no se perdieron.';
        if (rawMsg.includes('BENEFIT_CODE_ALREADY_CONSUMED') || rawMsg.includes('ya fue utilizado')) {
          friendlyMsg = 'Este código de beneficio ya fue utilizado.';
        } else if (rawMsg.includes('BENEFIT_CODE_DISABLED') || rawMsg.includes('desactivado')) {
          friendlyMsg = 'Este código de beneficio ha sido desactivado.';
        } else if (rawMsg.includes('BENEFIT_CODE_LOCKED') || rawMsg.includes('bloqueado')) {
          friendlyMsg = 'El código está siendo utilizado en otra reserva en curso. Reintentá en unos minutos.';
        } else if (rawMsg.includes('BENEFIT_CODE_NOT_FOUND') || rawMsg.includes('no existe')) {
          friendlyMsg = 'El código de beneficio no existe o es inválido.';
        } else if (
          rawMsg.includes('SLOT_COLLISION') ||
          rawMsg.includes('no está disponible') ||
          rawMsg.includes('ya tiene un turno') ||
          rawMsg.includes('SLOT_ALREADY_BOOKED') ||
          isAvailabilityConflictError(rawMsg)
        ) {
          setSmartPhase('idle');
          setSmartError(null);
          setOpen(false);
          slotConflictToThrow = new SlotUnavailableConflictError('Ese horario ya no está disponible. Elegí otro para continuar.', {
            phase: 'pre_payment',
            slotDate: draft.date,
            slotTime: draft.time,
          });
        } else if (isLikelyNetworkError(err)) {
          friendlyMsg = 'Detectamos un problema de conexión. Verificá tu red e intentá nuevamente; tus datos siguen guardados.';
        } else if (rawMsg) {
          friendlyMsg = rawMsg;
        }
        if (!slotConflictToThrow) {
          setSmartError({
            kind: 'zero_deposit',
            detail: friendlyMsg,
            canRetry: true,
          });
          setSmartPhase('error');
        }
      } finally {
        opening.current = false;
        setPreparing(false);
      }
      if (slotConflictToThrow) {
        throw slotConflictToThrow;
      }
      return;
    }

    if (draft.name && !cardHolder) {
      setCardHolder(draft.name);
    }
    opening.current = true;
    setOpen(true);
    setPreparing(true);
    setSmartError(null);
    setSmartPhase('processing');
    setResult(null);
    setCheckout(null);
    let slotConflictToThrow: SlotUnavailableConflictError | null = null;
    try {
      const sanitizedDraft: PaywayDraft = {
        barber: draft.barber,
        serviceName: draft.serviceName,
        date: draft.date,
        time: draft.time,
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        notes: draft.notes ?? '',
        ...(draft.benefitCode ? { benefitCode: draft.benefitCode } : {}),
      };
      const response = await preparePaywayCheckoutFn({ data: sanitizedDraft });
      if (response.ready) {
        if (paidAppointmentsRef.current.has(response.checkout.appointmentId)) {
          setSmartPhase('idle');
          setOpen(false);
          return;
        }
        setSmartPhase('idle');
        setSmartError(null);
        setCheckout(response.checkout);
      } else if (response.state === 'recoverable' && isAvailabilityConflictError(response.message)) {
        setSmartPhase('idle');
        setSmartError(null);
        setOpen(false);
        setResult(null);
        setCheckout(null);
        slotConflictToThrow = new SlotUnavailableConflictError(response.message, {
          phase: 'pre_payment',
          slotDate: draft.date,
          slotTime: draft.time,
        });
      } else {
        const msg = response.message || PAYWAY_MESSAGES.unavailable;
        setResult({ state: response.state ?? 'unavailable', message: msg });
        setSmartError({
          kind: 'prepare',
          detail: msg,
          canRetry: true,
        });
        setSmartPhase('error');
      }
    } catch (err) {
      const msg = isLikelyNetworkError(err)
        ? 'No pudimos conectarnos para iniciar la confirmación. Verificá tu conexión e intentá nuevamente.'
        : PAYWAY_MESSAGES.unavailable;
      setResult({ state: 'unavailable', message: msg });
      setSmartError({
        kind: 'prepare',
        detail: msg,
        canRetry: true,
      });
      setSmartPhase('error');
    } finally {
      opening.current = false;
      setPreparing(false);
    }
    if (slotConflictToThrow) {
      throw slotConflictToThrow;
    }
  }

  async function handleModalApplyDiscount() {
    const activeDraft = draftRef.current;
    const cleanCode = modalDiscountCode.trim();
    if (!activeDraft || modalDiscountInFlightRef.current || stage !== 'idle') return;
    if (!normalizeBenefitCode(cleanCode)) {
      setModalDiscountError('Ingresá un código de descuento válido.');
      return;
    }
    modalDiscountInFlightRef.current = true;
    setModalDiscountLoading(true);
    setModalDiscountError(null);
    try {
      const quote = await validateBenefitCodeQuoteFn({
        data: {
          code: cleanCode,
          serviceName: activeDraft.serviceName,
          barber: activeDraft.barber,
        },
      });
      if (!quote.valid) {
        setModalDiscountApplied(null);
        setModalDiscountError(mapBenefitErrorMessage(quote.message || quote.error));
        return;
      }

      // Sincronizar descuento válido con el paso «Datos»
      setExternalBenefitSync({
        version: Date.now(),
        code: quote.code,
        quote,
      });

      if (quote.skipOnlinePayment) {
        setSmartError(null);
        setSmartPhase('processing');
        const { confirmZeroDepositBookingFn } = await import('@/lib/kani-benefit-codes.functions');
        const confirmedResult = await confirmZeroDepositBookingFn({
          data: {
            benefitCode: quote.code,
            barberName: activeDraft.barber,
            serviceName: activeDraft.serviceName,
            bookingDate: activeDraft.date,
            startTime: activeDraft.time,
            clientName: activeDraft.name,
            clientPhone: activeDraft.phone,
            clientEmail: activeDraft.email,
            notes: activeDraft.notes,
          },
        });
        if (confirmedResult.success) {
          const confirmedBooking: ConfirmedPaywayBooking = {
            appointmentId: confirmedResult.appointmentId,
            attemptId: 'zero-deposit',
            serviceName: activeDraft.serviceName,
            barber: activeDraft.barber,
            date: activeDraft.date,
            time: activeDraft.time,
            clientName: activeDraft.name,
            depositArs: 0,
            servicePriceArs: confirmedResult.calculation.originalPriceArs,
            benefitType: confirmedResult.calculation.benefitType,
            benefitCode: confirmedResult.calculation.code,
            originalPriceArs: confirmedResult.calculation.originalPriceArs,
            discountAmountArs: confirmedResult.calculation.discountAmountArs,
            finalPriceArs: confirmedResult.calculation.finalPriceArs,
            onlineDepositArs: confirmedResult.calculation.onlineDepositArs,
            inPersonBalanceArs: confirmedResult.calculation.inPersonBalanceArs,
          };
          paidAppointmentsRef.current.add(confirmedResult.appointmentId);
          persistConfirmedBooking(confirmedBooking);
          setSmartPhase('idle');
          setSmartError(null);
          setConfirmed(confirmedBooking);
          notifyVerifiedConfirmationSound(confirmedBooking.appointmentId);
          setOpen(false);
          return;
        }
        setSmartPhase('idle');
        setModalDiscountError('No pudimos confirmar el turno con el beneficio. Intentá nuevamente.');
        return;
      }

      const sanitizedDraft: PaywayDraft = {
        barber: activeDraft.barber,
        serviceName: activeDraft.serviceName,
        date: activeDraft.date,
        time: activeDraft.time,
        name: activeDraft.name,
        email: activeDraft.email,
        phone: activeDraft.phone,
        notes: activeDraft.notes ?? '',
        benefitCode: quote.code,
      };
      const response = await preparePaywayCheckoutFn({ data: sanitizedDraft });
      if (response.ready) {
        draftRef.current = {
          ...activeDraft,
          benefitCode: quote.code,
          benefitQuote: quote,
          invalidBenefitNotice: undefined,
        };
        setCheckout(response.checkout);
        setModalDiscountApplied(quote);
        setModalDiscountCode(quote.code);
        setInvalidBenefitNotice(null);
        setModalDiscountError(null);
      } else {
        setModalDiscountApplied(null);
        setModalDiscountError(response.message || 'No pudimos actualizar el importe con el descuento.');
      }
    } catch (err: unknown) {
      setSmartPhase('idle');
      setModalDiscountApplied(null);
      setModalDiscountError(mapBenefitErrorMessage(err));
    } finally {
      modalDiscountInFlightRef.current = false;
      setModalDiscountLoading(false);
    }
  }

  async function pay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (paying.current || terminal || !checkout || paidAppointmentsRef.current.has(checkout.appointmentId)) return;
    if (isLiquid && readConfirmationSoundEnabled()) {
      unlockConfirmationAudio();
    }
    const form = event.currentTarget;

    setSubmitAttempted(true);

    const hasPanError = isPanEmpty || isPanIncomplete || panValidation.status === 'invalid' || !detected.isSupported || !detected.methodId;
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

    paying.current = true;
    setStage('tokenizing');
    setSmartError(null);
    setSmartPhase('processing');
    setResult(null);
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
          servicePriceArs: activeDraft?.benefitQuote?.originalPriceArs ?? resolveServicePrice(activeDraft?.serviceName ?? 'Corte', configuredServices),
          benefitType: activeDraft?.benefitQuote?.type ?? null,
          benefitCode: activeDraft?.benefitCode ?? null,
          originalPriceArs: activeDraft?.benefitQuote?.originalPriceArs ?? null,
          discountAmountArs: activeDraft?.benefitQuote?.discountAmountArs ?? null,
          finalPriceArs: activeDraft?.benefitQuote?.finalPriceArs ?? null,
          onlineDepositArs: activeDraft?.benefitQuote?.onlineDepositArs ?? null,
          inPersonBalanceArs: activeDraft?.benefitQuote?.inPersonBalanceArs ?? null,
        };
        paidAppointmentsRef.current.add(checkout.appointmentId);
        persistConfirmedBooking(confirmedBooking);
        setResult(response);
        setSmartPhase('idle');
        setSmartError(null);
        setConfirmed(confirmedBooking);
        notifyVerifiedConfirmationSound(confirmedBooking.appointmentId);
        setOpen(false);
        if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
          window.scrollTo({ top: 0, behavior: 'instant' });
        }
        return;
      }
      if (response.state === 'rejected') {
        clearActiveAttempt();
        setPendingCheck(null);
        setResult(response);
        setSmartError({
          kind: 'payment_rejected',
          detail: response.message || PAYWAY_MESSAGES.rejected,
          canRetry: true,
        });
        setSmartPhase('error');
        return;
      }
      if (response.state === 'review') {
        clearActiveAttempt();
        setPendingCheck(null);
        setResult(response);
        setSmartError({
          kind: 'payment_review',
          detail: response.message || PAYWAY_MESSAGES.late_review,
          canRetry: false,
        });
        setSmartPhase('error');
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
        setSmartPhase('prolonged');
        return;
      }
      setResult(response);
      setSmartError({
        kind: 'payment_unavailable',
        detail: response.message || PAYWAY_MESSAGES.technical_error,
        canRetry: true,
      });
      setSmartPhase('error');
    } catch (err) {
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
        setSmartPhase('prolonged');
        setCheckout(null);
      } else {
        const detail = isLikelyNetworkError(err)
          ? 'Se perdió la conexión antes de enviar el pago. Verificá tu red e intentá nuevamente.'
          : 'No pudimos validar la tarjeta. Revisá sus datos e intentá nuevamente.';
        setResult({ state: 'recoverable', message: detail });
        setSmartError({
          kind: 'tokenize',
          detail,
          canRetry: true,
        });
        setSmartPhase('error');
      }
    } finally {
      form.reset();
      resetFormState();
      paying.current = false;
      setStage('idle');
    }
  }

  async function handleManualCheckStatus() {
    if (!pendingCheck || manualStatusChecking) return;
    setManualStatusChecking(true);
    try {
      const statusRes = await checkPaywayPaymentStatusFn({
        data: {
          appointmentId: pendingCheck.appointmentId,
          attemptId: pendingCheck.attemptId,
          accessToken: pendingCheck.accessToken,
        },
      });
      if (statusRes.state === 'approved' && statusRes.appointmentConfirmed) {
        clearActiveAttempt();
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
        setSmartPhase('idle');
        setSmartError(null);
        setPendingCheck(null);
        setConfirmed(confirmedBooking);
        notifyVerifiedConfirmationSound(confirmedBooking.appointmentId);
        setOpen(false);
        if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
          window.scrollTo({ top: 0, behavior: 'instant' });
        }
        return;
      }
      if (statusRes.state === 'rejected') {
        clearActiveAttempt();
        setIsVerifying(false);
        setPendingCheck(null);
        setPollExhausted(false);
        setResult(statusRes);
        setSmartError({
          kind: 'payment_rejected',
          detail: statusRes.message || PAYWAY_MESSAGES.rejected,
          canRetry: true,
        });
        setSmartPhase('error');
        return;
      }
      if (statusRes.state === 'review') {
        clearActiveAttempt();
        setIsVerifying(false);
        setPendingCheck(null);
        setResult(statusRes);
        setSmartError({
          kind: 'payment_review',
          detail: statusRes.message || PAYWAY_MESSAGES.late_review,
          canRetry: false,
        });
        setSmartPhase('error');
        return;
      }
      setResult(statusRes);
      setSmartPhase('prolonged');
    } catch {
      setSmartPhase('prolonged');
    } finally {
      setManualStatusChecking(false);
    }
  }

  function handleSmartRetry() {
    if (hasPendingPayment || isVerifying || paying.current || opening.current) return;
    if (smartError?.kind === 'tokenize' && checkout) {
      setSmartError(null);
      setSmartPhase('idle');
      setResult(null);
      return;
    }
    const activeDraft = draftRef.current;
    if (!activeDraft) {
      setSmartPhase('idle');
      setSmartError(null);
      setOpen(false);
      return;
    }
    setSmartError(null);
    setSmartPhase('idle');
    setResult(null);
    void begin(activeDraft);
  }

  function handleBackToBooking() {
    if (paying.current || opening.current) return;
    setOpen(false);
    if (!hasPendingPayment && !isVerifying && !pollExhausted) {
      setSmartPhase('idle');
      setSmartError(null);
    }
    resetFormState();
  }

  function startNewReservation() {
    clearConfirmedBookingView();
    clearActiveAttempt();
    resetFormState();
    draftRef.current = null;
    setPendingCheck(null);
    setIsVerifying(false);
    setPollExhausted(false);
    setSmartPhase('idle');
    setSmartError(null);
    setConfirmed(null);
    setResult(null);
    setCheckout(null);
    setInvalidBenefitNotice(null);
    setOpen(false);
  }

  function handleCardNumberChange(e: React.ChangeEvent<HTMLInputElement>) {
    const prevDigits = cardNumber.replace(/\D/g, '');
    const digits = e.target.value.replace(/\D/g, '');
    const tempDetected = detectCardNetwork(digits, checkout?.methods ?? []);
    const maxDigits = tempDetected.lengths[tempDetected.lengths.length - 1] ?? 19;
    const truncated = digits.slice(0, maxDigits);
    const formatted = formatCardPan(truncated, tempDetected.gaps);
    setCardNumber(formatted);
    const tempValidation = validatePan(formatted, tempDetected, checkout?.methods ?? []);
    if (tempValidation.status !== 'idle' || (prevDigits.length >= (tempDetected.lengths[0] ?? 16) && truncated.length < prevDigits.length) || (prevDigits.length > 0 && !truncated)) {
      markTouched('cardNumber');
    }
  }

  function handleCvvChange(e: React.ChangeEvent<HTMLInputElement>) {
    const prevDigits = cvv.replace(/\D/g, '');
    const digits = e.target.value.replace(/\D/g, '').slice(0, detected.codeSize);
    setCvv(digits);
    if (digits.length === detected.codeSize || (prevDigits.length > 0 && digits.length < prevDigits.length)) {
      markTouched('cvv');
    }
  }

  function handleDniChange(e: React.ChangeEvent<HTMLInputElement>) {
    const prevDigits = dni.replace(/\D/g, '');
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
    setDni(formatDni(digits));
    if (digits.length >= 7 || (prevDigits.length > 0 && digits.length < prevDigits.length)) {
      markTouched('dni');
    }
  }

  if (confirmed) {
    return (
      <BookingConfirmedScreen
        confirmed={confirmed}
        onHomeClick={startNewReservation}
        homeUrl={homeUrl}
      />
    );
  }

  return (
    <div className="payway-reservation">
      <Booking
        variant="v3"
        experimentalMotion={experimentalMotion}
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
        hasActivePaymentAttempt={hasPendingPayment || hasReviewNotice || result?.state === 'unknown'}
        suppressDraftRecovery={Boolean(initialAttempt || hasPendingPayment || hasReviewNotice || isPaymentChecking || confirmed || open)}
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
        externalBenefitSync={externalBenefitSync}
      />
      {(() => {
        const activeSmartPhase: SmartConfirmationPhase =
          smartPhase !== 'idle'
            ? smartPhase
            : isVerifying || pollExhausted || result?.state === 'unknown'
              ? 'prolonged'
              : preparing || stage !== 'idle'
                ? 'processing'
                : 'idle';
        const isSmartStatusView = activeSmartPhase !== 'idle';
        const isProcessingLock = activeSmartPhase === 'processing' || paying.current || opening.current;

        return (
      <Dialog
        open={open}
        onOpenChange={value => {
          if (!isProcessingLock) {
            setOpen(value);
            if (!value) {
              resetFormState();
              if (!hasPendingPayment && !isVerifying && !pollExhausted) {
                setSmartPhase('idle');
                setSmartError(null);
              }
            }
          }
        }}
      >
        <DialogContent
          className={isSmartStatusView ? 'payway-checkout smart-confirm-modal' : 'payway-checkout'}
          showCloseButton={false}
          onEscapeKeyDown={e => { if (isProcessingLock) e.preventDefault(); }}
          onPointerDownOutside={e => { if (isProcessingLock) e.preventDefault(); }}
        >
          {!isSmartStatusView && (
          <div className="payway-checkout-header">
            <DialogTitle className="payway-checkout-title">Pagá la seña con Payway</DialogTitle>
            <DialogClose
              className="payway-modal-close"
              aria-label="Cerrar"
              disabled={isProcessingLock}
            >
              <X size={16} aria-hidden="true" />
            </DialogClose>
            <DialogDescription className="payway-checkout-subtitle">
              {checkout
                ? `Seña: ${money(checkout.depositArs ?? 0)} · Pago seguro · Kani Barber Studio`
                : 'Pago seguro de seña · Kani Barber Studio'}
            </DialogDescription>
          </div>
          )}
          {isSmartStatusView && (
            <BookingConfirmationStatusView
              phase={activeSmartPhase}
              errorKind={smartError?.kind ?? (result?.state === 'review' ? 'payment_review' : hasPendingPayment ? 'pending_unknown' : null)}
              errorDetail={smartError?.detail ?? result?.message ?? null}
              canRetry={Boolean(smartError?.canRetry && !hasPendingPayment && !isVerifying)}
              canCheckStatus={Boolean(pendingCheck)}
              isCheckingStatus={manualStatusChecking}
              onRetry={handleSmartRetry}
              onCheckStatus={handleManualCheckStatus}
              onBackToBooking={activeSmartPhase === 'processing' ? undefined : handleBackToBooking}
            />
          )}
          {!isSmartStatusView && result && !isVerifying && !pollExhausted && result.state !== 'unknown' && result.state !== 'review' && (
            <p role={result.state === 'approved' ? 'status' : 'alert'} className="payway-result">{result.message}</p>
          )}
          {checkout && !terminal && (
            <form
              onSubmit={pay}
              autoComplete="off"
              noValidate
              data-private="redact"
              data-sensitive="true"
              className="payway-card-form"
              style={isSmartStatusView ? { display: 'none' } : undefined}
              aria-hidden={isSmartStatusView || undefined}
            >
              <input type="hidden" name="paymentMethod" value={detected.methodId ?? ''} />
              <div className="payway-checkout-body">
                {modalDiscountOpen && !isApprovedConfirmed && (
                  <div className="payway-discount-retry-box" role="region" aria-label="Código de descuento">
                    {!modalDiscountApplied ? (
                      <>
                        <div className="payway-discount-retry-notice" role="status" aria-live="polite">
                          <CircleAlert size={14} className="payway-benefit-warning-icon shrink-0" aria-hidden="true" />
                          <p className="payway-discount-retry-text">
                            No pudimos aplicar el descuento. Revisá el código o continuá con la seña habitual.
                          </p>
                        </div>
                        <div className="payway-discount-retry-row">
                          <Input
                            type="text"
                            aria-label="Código de descuento"
                            placeholder="Código de descuento"
                            value={modalDiscountCode}
                            disabled={modalDiscountLoading || stage !== 'idle'}
                            className="payway-discount-retry-input"
                            onChange={e => {
                              setModalDiscountCode(e.target.value.toUpperCase());
                              if (modalDiscountError) setModalDiscountError(null);
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleModalApplyDiscount();
                              }
                            }}
                          />
                          <Button
                            type="button"
                            className="payway-discount-retry-btn"
                            disabled={modalDiscountLoading || stage !== 'idle' || !modalDiscountCode.trim()}
                            onClick={() => void handleModalApplyDiscount()}
                          >
                            {modalDiscountLoading ? 'Validando…' : 'Aplicar'}
                          </Button>
                        </div>
                        {modalDiscountError && (
                          <p className="payway-discount-retry-error" role="alert">
                            {modalDiscountError}
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="payway-discount-applied-inline" role="status" aria-live="polite">
                        <CheckCircle2 size={14} className="shrink-0" aria-hidden="true" />
                        <span>
                          Descuento <strong>{modalDiscountApplied.code}</strong> aplicado · Seña:{' '}
                          <strong>{money(checkout.depositArs ?? modalDiscountApplied.onlineDepositArs)}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                )}
                <fieldset disabled={stage !== 'idle'}>
                  {/* Card Number with integrated network badge (100%) */}
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
                              const val = e.target.value;
                              setMonth(val);
                              if (year || !val || month) markTouched('expiry');
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
                              const val = e.target.value;
                              setYear(val);
                              if (month || !val || year) markTouched('expiry');
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

                  {/* Security Code (CVV) 50% | DNI of Cardholder 50% */}
                  <div className="payway-cvv-dni-row">
                    <div className="payway-field-group payway-cvv-col">
                      <div className="payway-col-label-row">
                        <label htmlFor="card-security-code" className="payway-field-label-text">
                          <span className="payway-cvv-label-desktop">Código de seguridad (CVV)</span>
                          <span className="payway-cvv-label-mobile" aria-hidden="true">CVV</span>
                        </label>
                        <div className="payway-help-wrapper" ref={cvvHelpRef}>
                          <button
                            type="button"
                            className="payway-help-trigger"
                            aria-label="Ayuda sobre el CVV"
                            aria-expanded={showCvvHelp}
                            aria-controls="cvv-help-bubble"
                            onClick={() => {
                              setShowCvvHelp(prev => {
                                const next = !prev;
                                if (next && cvvHelpRef.current) {
                                  const triggerRect = cvvHelpRef.current.getBoundingClientRect();
                                  const scrollBody = cvvHelpRef.current.closest('.payway-checkout-body');
                                  const topBoundary = scrollBody
                                    ? scrollBody.getBoundingClientRect().top
                                    : 0;
                                  const spaceAbove = triggerRect.top - topBoundary;
                                  setCvvHelpPlacement(spaceAbove < 68 ? 'bottom' : 'top');
                                }
                                return next;
                              });
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Escape') setShowCvvHelp(false);
                            }}
                          >
                            <HelpCircle size={13} aria-hidden="true" />
                          </button>
                          {showCvvHelp && (
                            <div
                              id="cvv-help-bubble"
                              role="tooltip"
                              className={`payway-help-bubble is-${cvvHelpPlacement}`}
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

                    <div className="payway-field-group payway-dni-col">
                      <div className="payway-col-label-row">
                        <label htmlFor="card-holder-dni" className="payway-field-label-text">
                          DNI del titular
                        </label>
                      </div>
                      <span className={`field-control ${dniStatus}`}>
                        <Input
                          id="card-holder-dni"
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
                    </div>
                  </div>

                  {/* Cardholder Name (100%) */}
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
                        onChange={e => {
                          setCardHolder(e.target.value);
                          markTouched('cardHolder');
                        }}
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

                  <p className="payway-legal-disclaimer text-xs text-muted-foreground text-left my-2 leading-relaxed">
                    Al confirmar tu reserva, aceptás nuestros{' '}
                    <a
                      href={termsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-foreground text-gold transition-colors"
                    >
                      Términos y Condiciones
                    </a>{' '}
                    y nuestra{' '}
                    <a
                      href={privacyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-foreground text-gold transition-colors"
                    >
                      Política de Privacidad
                    </a>.
                  </p>
                </fieldset>
              </div>

              <div className="payway-checkout-footer">
                <Button type="submit" className="action-positive payway-submit-btn" disabled={!isCardFormValid || stage !== 'idle'}>
                  {stage === 'tokenizing'
                    ? 'Validando tarjeta…'
                    : stage === 'paying'
                      ? 'Procesando pago…'
                      : `Pagar seña ${checkout ? money(checkout.depositArs) : '$5.000'}`}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
        );
      })()}
    </div>
  );
}
