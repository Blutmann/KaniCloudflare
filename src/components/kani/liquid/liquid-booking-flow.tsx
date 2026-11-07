import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Flame,
  HelpCircle,
  Loader2,
  Lock,
  MapPin,
  Scissors,
  Sparkles,
  Tag,
  User,
  Users,
  X,
} from 'lucide-react';
import {
  services as fallbackServices,
  barbers,
  barberInstagramHandles,
  money,
  parseDate,
  isoDate,
  dateLabel,
  formatServiceName,
  type Barber,
  type ServiceId,
} from '@/lib/kani-model';
import {
  readConfiguredServices,
  readPublicAvailabilityStarts,
  availabilityStartTimesForServiceDate,
  eligibleBarbersForAvailabilityStart,
  type ConfiguredService,
  type PublicAvailabilityStart,
} from '@/lib/kani-availability';
import { businessDateToday } from '@/lib/kani-mobile-appointments';
import { createRealAppointment } from '@/lib/kani-appointments';
import { getDynamicDownPayment } from '@/lib/kani-down-payment';
import { validateBenefitCodeQuoteFn, confirmZeroDepositBookingFn } from '@/lib/kani-benefit-codes.functions';
import type { BenefitQuote } from '@/lib/kani-benefit-codes';
import {
  preparePaywayCheckoutFn,
  payPaywayDepositFn,
  checkPaywayPaymentStatusFn,
} from '@/lib/kani-payway.functions';
import { tokenizePaywayForm } from '@/lib/kani-payway.browser';
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
import { CardBrandBadge } from '@/components/kani/experimental/card-brand-badges';
import { BookingConfirmedScreen, type ConfirmedBookingData } from '@/components/kani/booking-confirmed-screen';
import { PUBLIC_RESERVABLE_BARBERS } from './liquid-landing';
import { normalizePhone, type PhoneCountry } from '@/lib/kani-phone';

const PhoneInput = lazy(() =>
  import('@/components/kani/phone-input').then((m) => ({ default: m.PhoneInput }))
);

const CONFIRMED_STORAGE_KEY = 'kani:liquid:confirmed-booking';

export interface LiquidBookingFlowProps {
  initialService?: ServiceId | null;
  initialBarber?: Barber | null;
  onExitBooking: () => void;
  configuredServices?: ConfiguredService[];
}

export function LiquidBookingFlow({
  initialService = null,
  initialBarber = null,
  onExitBooking,
  configuredServices: initialConfiguredServices,
}: LiquidBookingFlowProps) {
  // Step index: 0 = Servicio, 1 = Barbero, 2 = Fecha, 3 = Horario, 4 = Datos, 5 = Pago
  const [step, setStep] = useState<number>(0);
  const [service, setService] = useState<ServiceId | null>(() => initialService);
  const [barber, setBarber] = useState<Barber | null>(() => initialBarber);
  const [barberDeferred, setBarberDeferred] = useState(false);
  const [date, setDate] = useState<string>('');
  const [time, setTime] = useState<string>('');

  const [servicesList, setServicesList] = useState<ConfiguredService[]>(initialConfiguredServices ?? []);
  const [month, setMonth] = useState<Date>(() => parseDate(businessDateToday()));
  const [availabilityStarts, setAvailabilityStarts] = useState<PublicAvailabilityStart[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  // Contact form
  const [contact, setContact] = useState({ name: '', phone: '', email: '', notes: '' });
  const [phoneCountry, setPhoneCountry] = useState<PhoneCountry>('AR');
  const [benefitCode, setBenefitCode] = useState('');
  const [appliedBenefit, setAppliedBenefit] = useState<BenefitQuote | null>(null);
  const [validatingBenefit, setValidatingBenefit] = useState(false);
  const [benefitError, setBenefitError] = useState<string | null>(null);

  // Payway card fields
  const [cardNumber, setCardNumber] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [monthExpiry, setMonthExpiry] = useState('');
  const [yearExpiry, setYearExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [dniNumber, setDniNumber] = useState('');
  const [isPaying, setIsPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Confirmation state
  const [confirmedBooking, setConfirmedBooking] = useState<ConfirmedBookingData | null>(null);

  // Load configured services if not provided
  useEffect(() => {
    if (initialConfiguredServices && initialConfiguredServices.length > 0) return;
    void readConfiguredServices()
      .then((data) => {
        if (data.length > 0) setServicesList(data);
      })
      .catch(() => {
        setServicesList(fallbackServices as unknown as ConfiguredService[]);
      });
  }, [initialConfiguredServices]);

  // Load availability when month/barber changes
  useEffect(() => {
    let active = true;
    const year = month.getFullYear();
    const m = month.getMonth();
    const firstDayIso = `${year}-${String(m + 1).padStart(2, '0')}-01`;
    const lastDayOfMonth = new Date(year, m + 1, 0).getDate();
    const lastDayIso = `${year}-${String(m + 1).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;

    setLoadingAvailability(true);
    readPublicAvailabilityStarts(barberDeferred ? null : barber, firstDayIso, lastDayIso)
      .then((data) => {
        if (!active) return;
        // Filter out any starts from non-public barbers (e.g. Franco)
        const filtered = data.filter((s) => PUBLIC_RESERVABLE_BARBERS.includes(s.barber_name));
        setAvailabilityStarts(filtered);
      })
      .catch((err) => {
        console.error('Availability load error:', err);
      })
      .finally(() => {
        if (active) setLoadingAvailability(false);
      });

    return () => {
      active = false;
    };
  }, [month, barber, barberDeferred]);

  // Resolve active service details
  const activeServiceObj = useMemo(() => {
    if (!service) return null;
    return servicesList.find((s) => s.id === service) ?? fallbackServices.find((s) => s.id === service) ?? null;
  }, [service, servicesList]);

  const serviceName = activeServiceObj?.name ?? 'Corte';
  const servicePrice = activeServiceObj?.price ?? 25000;
  const depositArs = useMemo(() => {
    if (appliedBenefit?.benefitType === 'FREE_SERVICE' || appliedBenefit?.benefitType === 'NO_DEPOSIT') {
      return 0;
    }
    return getDynamicDownPayment();
  }, [appliedBenefit]);

  // Available dates in current month for active service
  const availableDatesSet = useMemo(() => {
    const set = new Set<string>();
    const now = new Date();
    for (const start of availabilityStarts) {
      if (
        availabilityStartTimesForServiceDate(
          availabilityStarts,
          start.slot_date,
          serviceName,
          now,
          barberDeferred ? null : barber
        ).length > 0
      ) {
        set.add(start.slot_date);
      }
    }
    return set;
  }, [availabilityStarts, serviceName, barber, barberDeferred]);

  // Available time slots on selected date
  const availableSlots = useMemo(() => {
    if (!date) return [];
    const now = new Date();
    return availabilityStartTimesForServiceDate(
      availabilityStarts,
      date,
      serviceName,
      now,
      barberDeferred ? null : barber
    );
  }, [availabilityStarts, date, serviceName, barber, barberDeferred]);

  // Eligible candidate barbers if "Elegir más adelante"
  const candidateBarbers = useMemo(() => {
    if (!service || !date || !time || !barberDeferred) return [];
    const now = new Date();
    const eligible = eligibleBarbersForAvailabilityStart(
      availabilityStarts,
      date,
      time,
      serviceName,
      now
    );
    // Explicitly guarantee only public reservable barbers are assigned
    return eligible.filter((b) => PUBLIC_RESERVABLE_BARBERS.includes(b));
  }, [service, date, time, barberDeferred, availabilityStarts, serviceName]);

  // If deferred barber and only 1 candidate available, auto-assign
  useEffect(() => {
    if (barberDeferred && time && candidateBarbers.length === 1 && barber !== candidateBarbers[0]) {
      setBarber(candidateBarbers[0]);
    }
  }, [barberDeferred, time, candidateBarbers, barber]);

  // Benefit code validation
  const handleApplyBenefitCode = async () => {
    if (!benefitCode.trim()) return;
    setValidatingBenefit(true);
    setBenefitError(null);
    try {
      const quote = await validateBenefitCodeQuoteFn({
        data: {
          code: benefitCode.trim().toUpperCase(),
          serviceName,
          barberName: barber ?? candidateBarbers[0] ?? 'Lautaro',
        },
      });
      setAppliedBenefit(quote);
    } catch (err) {
      setAppliedBenefit(null);
      setBenefitError('Código inválido o no aplicable.');
    } finally {
      setValidatingBenefit(false);
    }
  };

  // Step Validation logic
  const canContinue = useMemo(() => {
    switch (step) {
      case 0:
        return Boolean(service);
      case 1:
        return Boolean(barber || barberDeferred);
      case 2:
        return Boolean(date && availableDatesSet.has(date));
      case 3:
        return Boolean(time && availableSlots.includes(time) && (barber || candidateBarbers.length > 0));
      case 4:
        return (
          contact.name.trim().length >= 3 &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()) &&
          Boolean(normalizePhone(contact.phone, phoneCountry))
        );
      case 5:
        return true;
      default:
        return false;
    }
  }, [step, service, barber, barberDeferred, date, availableDatesSet, time, availableSlots, candidateBarbers, contact, phoneCountry]);

  // Navigation handlers
  const handleNext = () => {
    if (step === 3 && barberDeferred && !barber && candidateBarbers.length > 0) {
      setBarber(candidateBarbers[0]);
    }
    if (step < 5) {
      setStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (step === 0) {
      onExitBooking();
    } else {
      setStep((prev) => prev - 1);
    }
  };

  // Payment submission
  const handleExecutePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPaying(true);
    setPaymentError(null);

    const finalBarber = barber ?? candidateBarbers[0] ?? 'Lautaro';

    try {
      // If $0 deposit with benefit code
      if (depositArs === 0 && appliedBenefit?.code) {
        await confirmZeroDepositBookingFn({
          data: {
            barberName: finalBarber,
            serviceName,
            bookingDate: date,
            startTime: time,
            clientName: contact.name.trim(),
            clientPhone: contact.phone.trim(),
            clientEmail: contact.email.trim(),
            benefitCode: appliedBenefit.code,
            notes: contact.notes.trim() || undefined,
          },
        });

        const confirmed: ConfirmedBookingData = {
          serviceName,
          barber: finalBarber,
          date,
          time,
          clientName: contact.name.trim(),
          depositArs: 0,
          servicePriceArs: servicePrice,
          benefitCode: appliedBenefit.code,
          benefitType: appliedBenefit.benefitType,
        };
        setConfirmedBooking(confirmed);
        return;
      }

      // Standard Payway flow
      // 1. Prepare checkout
      const checkoutRes = await preparePaywayCheckoutFn({
        data: {
          serviceName,
          barberName: finalBarber,
          bookingDate: date,
          startTime: time,
          clientName: contact.name.trim(),
          clientPhone: contact.phone.trim(),
          clientEmail: contact.email.trim(),
          notes: contact.notes.trim() || undefined,
          benefitCode: appliedBenefit?.code,
        },
      });

      if (!checkoutRes.checkout) {
        throw new Error('No se pudo inicializar la pasarela de pago.');
      }

      // 2. Tokenize card
      const tokenResult = await tokenizePaywayForm({
        form: {
          cardNumber,
          cardholderName,
          cardExpirationMonth: monthExpiry,
          cardExpirationYear: yearExpiry,
          securityCode: cvv,
          identificationType: 'DNI',
          identificationNumber: dniNumber,
        },
        publicKey: checkoutRes.checkout.publicKey,
        environment: checkoutRes.checkout.environment,
      });

      if (!tokenResult.token) {
        throw new Error(tokenResult.error || 'Tarjeta rechazada. Verificá los datos ingresados.');
      }

      // 3. Process payment
      const paymentRes = await payPaywayDepositFn({
        data: {
          appointmentId: checkoutRes.checkout.appointmentId,
          attemptId: checkoutRes.checkout.attemptId,
          accessToken: checkoutRes.checkout.accessToken,
          token: tokenResult.token,
          bin: tokenResult.bin,
          paymentMethodId: tokenResult.paymentMethodId,
        },
      });

      if (paymentRes.state === 'approved' && paymentRes.appointmentConfirmed) {
        const confirmed: ConfirmedBookingData = {
          appointmentId: checkoutRes.checkout.appointmentId,
          serviceName,
          barber: finalBarber,
          date,
          time,
          clientName: contact.name.trim(),
          depositArs: checkoutRes.checkout.amountArs,
          servicePriceArs: servicePrice,
          benefitCode: appliedBenefit?.code,
          benefitType: appliedBenefit?.benefitType,
        };
        setConfirmedBooking(confirmed);
      } else {
        throw new Error(paymentRes.message || 'El pago no fue aprobado. Verificá los fondos o probá con otra tarjeta.');
      }
    } catch (err) {
      console.error('Payment failure:', err);
      setPaymentError(err instanceof Error ? err.message : 'Ocurrió un error al procesar el pago.');
    } finally {
      setIsPaying(false);
    }
  };

  // If confirmed, show confirmation screen
  if (confirmedBooking) {
    return (
      <div className="liquid-booking-confirmed py-8">
        <BookingConfirmedScreen
          confirmed={confirmedBooking}
          homeUrl="/reservar-turno-liquid"
          homeLabel="Volver al inicio"
          onHomeClick={onExitBooking}
        />
      </div>
    );
  }

  // Stepper labels
  const stepLabels = ['Servicio', 'Barbero', 'Fecha', 'Horario', 'Datos', 'Pago'];

  return (
    <div className="liquid-booking-container max-w-2xl mx-auto py-6 px-4">
      {/* Top Header / Back Bar */}
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={handleBack}
          className="liquid-btn-secondary text-xs py-2 px-3.5 inline-flex items-center gap-1.5"
          aria-label="Volver"
        >
          <ArrowLeft size={14} />
          <span>{step === 0 ? 'Volver a KANI' : 'Paso anterior'}</span>
        </button>

        <span className="text-xs font-semibold text-[var(--lq-text-muted)] tracking-wider uppercase">
          Paso {step + 1} de 6 · {stepLabels[step]}
        </span>
      </div>

      {/* Liquid Progress Stepper */}
      <div className="liquid-stepper">
        <div className="liquid-step-line" />
        {stepLabels.map((lbl, idx) => (
          <div
            key={lbl}
            className={`liquid-step-node ${idx === step ? 'active' : ''} ${idx < step ? 'completed' : ''}`}
            onClick={() => {
              if (idx < step) setStep(idx);
            }}
          >
            <div className="liquid-step-circle">
              {idx < step ? <Check size={14} /> : idx + 1}
            </div>
            <span className="liquid-step-label hidden sm:block">{lbl}</span>
          </div>
        ))}
      </div>

      {/* ====================================================================
          STEP 0: SERVICIO
          ==================================================================== */}
      {step === 0 && (
        <div className="space-y-4">
          <div>
            <h2 className="liquid-serif-heading text-2xl text-[var(--lq-text-primary)]">
              Elegí un servicio
            </h2>
            <p className="text-sm text-[var(--lq-text-secondary)] mt-0.5">
              Todos los servicios incluyen lavado de cabello y bebida de cortesía.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <div
              className={`liquid-option-card ${service === 'corte' ? 'selected' : ''}`}
              onClick={() => setService('corte')}
            >
              <div className="liquid-barber-avatar-inner w-12 h-12 flex-shrink-0 bg-[var(--lq-glass-border-subtle)]">
                <Scissors className="w-5 h-5 text-[var(--lq-carmesi)] dark:text-[#ff9fb2]" />
              </div>
              <div className="flex-1">
                <span className="block font-semibold text-base text-[var(--lq-text-primary)]">Corte</span>
                <span className="block text-xs text-[var(--lq-text-muted)]">45 minutos · Precisión y estilo</span>
              </div>
              <div className="text-right">
                <span className="block font-bold text-base text-[var(--lq-carmesi)] dark:text-[#ff9fb2]">
                  {money(servicesList.find((s) => s.id === 'corte')?.price || 25000)}
                </span>
              </div>
              <div className="liquid-radio-circle">
                {service === 'corte' && <Check size={12} />}
              </div>
            </div>

            <div
              className={`liquid-option-card ${service === 'corte-barba' ? 'selected' : ''}`}
              onClick={() => setService('corte-barba')}
            >
              <div className="liquid-barber-avatar-inner w-12 h-12 flex-shrink-0 bg-[var(--lq-glass-border-subtle)]">
                <Sparkles className="w-5 h-5 text-[var(--lq-carmesi)] dark:text-[#ff9fb2]" />
              </div>
              <div className="flex-1">
                <span className="block font-semibold text-base text-[var(--lq-text-primary)]">Corte y barba</span>
                <span className="block text-xs text-[var(--lq-text-muted)]">60 minutos · Experiencia completa</span>
              </div>
              <div className="text-right">
                <span className="block font-bold text-base text-[var(--lq-carmesi)] dark:text-[#ff9fb2]">
                  {money(servicesList.find((s) => s.id === 'corte-barba')?.price || 30000)}
                </span>
              </div>
              <div className="liquid-radio-circle">
                {service === 'corte-barba' && <Check size={12} />}
              </div>
            </div>

            <div
              className={`liquid-option-card ${service === 'barba' ? 'selected' : ''}`}
              onClick={() => setService('barba')}
            >
              <div className="liquid-barber-avatar-inner w-12 h-12 flex-shrink-0 bg-[var(--lq-glass-border-subtle)]">
                <Flame className="w-5 h-5 text-[var(--lq-carmesi)] dark:text-[#ff9fb2]" />
              </div>
              <div className="flex-1">
                <span className="block font-semibold text-base text-[var(--lq-text-primary)]">Barba</span>
                <span className="block text-xs text-[var(--lq-text-muted)]">30 minutos · Perfilado y toalla caliente</span>
              </div>
              <div className="text-right">
                <span className="block font-bold text-base text-[var(--lq-carmesi)] dark:text-[#ff9fb2]">
                  {money(servicesList.find((s) => s.id === 'barba')?.price || 15000)}
                </span>
              </div>
              <div className="liquid-radio-circle">
                {service === 'barba' && <Check size={12} />}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          STEP 1: BARBERO
          ==================================================================== */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="liquid-serif-heading text-2xl text-[var(--lq-text-primary)]">
              Elegí un barbero
            </h2>
            <p className="text-sm text-[var(--lq-text-secondary)] mt-0.5">
              Seleccioná a tu profesional de preferencia o dejá que el sistema te asigne.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            {PUBLIC_RESERVABLE_BARBERS.map((bName) => (
              <div
                key={bName}
                className={`liquid-option-card ${barber === bName && !barberDeferred ? 'selected' : ''}`}
                onClick={() => {
                  setBarber(bName);
                  setBarberDeferred(false);
                }}
              >
                <div className="liquid-barber-avatar-inner w-12 h-12 flex-shrink-0 font-bold bg-[var(--lq-glass-border-subtle)]">
                  {bName.charAt(0)}
                </div>
                <div className="flex-1">
                  <span className="block font-semibold text-base text-[var(--lq-text-primary)]">{bName}</span>
                  <span className="block text-xs text-[var(--lq-text-muted)]">{barberInstagramHandles[bName]}</span>
                </div>
                <div className="liquid-radio-circle">
                  {barber === bName && !barberDeferred && <Check size={12} />}
                </div>
              </div>
            ))}

            {/* Elegir más adelante */}
            <div
              className={`liquid-option-card ${barberDeferred ? 'selected' : ''}`}
              onClick={() => {
                setBarber(null);
                setBarberDeferred(true);
                setDate('');
                setTime('');
              }}
            >
              <div className="liquid-barber-avatar-inner w-12 h-12 flex-shrink-0 bg-[var(--lq-glass-border-subtle)]">
                <Users className="w-5 h-5 text-[var(--lq-carmesi)] dark:text-[#ff9fb2]" />
              </div>
              <div className="flex-1">
                <span className="block font-semibold text-base text-[var(--lq-text-primary)]">
                  Cualquier barbero disponible
                </span>
                <span className="block text-xs text-[var(--lq-text-muted)]">
                  El sistema asignará según fecha y horario
                </span>
              </div>
              <div className="liquid-radio-circle">
                {barberDeferred && <Check size={12} />}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          STEP 2: FECHA
          ==================================================================== */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h2 className="liquid-serif-heading text-2xl text-[var(--lq-text-primary)]">
              Elegí una fecha
            </h2>
            <p className="text-sm text-[var(--lq-text-secondary)] mt-0.5">
              Horario de atención: Lunes a sábados de 10:00 a 20:00 hs.
            </p>
          </div>

          <div className="liquid-glass-card liquid-calendar">
            <div className="liquid-cal-header">
              <span className="font-serif font-bold text-lg text-[var(--lq-text-primary)] capitalize">
                {month.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
              </span>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="p-2 rounded-full hover:bg-[var(--lq-glass-border-subtle)] transition-colors"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                  aria-label="Mes anterior"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  className="p-2 rounded-full hover:bg-[var(--lq-glass-border-subtle)] transition-colors"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                  aria-label="Mes siguiente"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            <div className="liquid-cal-grid">
              {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
                <div key={i} className="liquid-cal-day-label">
                  {d}
                </div>
              ))}

              {(() => {
                const year = month.getFullYear();
                const m = month.getMonth();
                const firstDayIndex = (new Date(year, m, 1).getDay() + 6) % 7; // Monday = 0
                const daysInMonth = new Date(year, m + 1, 0).getDate();
                const todayIso = businessDateToday();

                const cells = [];
                for (let i = 0; i < firstDayIndex; i++) {
                  cells.push(<div key={`pad-${i}`} className="liquid-cal-day disabled" />);
                }

                for (let day = 1; day <= daysInMonth; day++) {
                  const dayIso = `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const isAvailable = availableDatesSet.has(dayIso);
                  const isSelected = date === dayIso;
                  const isToday = dayIso === todayIso;

                  cells.push(
                    <button
                      key={dayIso}
                      type="button"
                      disabled={!isAvailable}
                      className={`liquid-cal-day ${isAvailable ? 'available' : 'disabled'} ${
                        isSelected ? 'selected' : ''
                      } ${isToday ? 'today' : ''}`}
                      onClick={() => {
                        setDate(dayIso);
                        setTime('');
                      }}
                    >
                      {day}
                    </button>
                  );
                }
                return cells;
              })()}
            </div>

            {loadingAvailability && (
              <div className="flex items-center justify-center gap-2 mt-4 text-xs text-[var(--lq-text-muted)]">
                <Loader2 size={14} className="animate-spin" />
                <span>Consultando disponibilidad en vivo...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====================================================================
          STEP 3: HORARIO
          ==================================================================== */}
      {step === 3 && (
        <div className="space-y-4">
          <div>
            <h2 className="liquid-serif-heading text-2xl text-[var(--lq-text-primary)]">
              Elegí un horario
            </h2>
            <p className="text-sm text-[var(--lq-text-secondary)] mt-0.5">
              Fecha seleccionada: {date ? dateLabel(date) : ''}
            </p>
          </div>

          {availableSlots.length === 0 ? (
            <div className="liquid-glass-card p-6 text-center">
              <Clock size={28} className="mx-auto text-[var(--lq-text-muted)] mb-2" />
              <p className="font-semibold text-[var(--lq-text-primary)]">No hay horarios disponibles para esta fecha.</p>
              <button
                type="button"
                className="liquid-btn-secondary text-xs mt-3 py-1.5 px-4"
                onClick={() => setStep(2)}
              >
                Elegir otra fecha
              </button>
            </div>
          ) : (
            <div className="liquid-glass-card p-5">
              <div className="liquid-time-grid">
                {availableSlots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    className={`liquid-time-slot ${time === slot ? 'selected' : ''}`}
                    onClick={() => setTime(slot)}
                  >
                    {slot}
                  </button>
                ))}
              </div>

              {barberDeferred && time && candidateBarbers.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[var(--lq-glass-border-subtle)]">
                  <span className="block text-xs font-semibold text-[var(--lq-text-muted)] uppercase mb-2">
                    {candidateBarbers.length === 1 ? 'Barbero asignado:' : 'Barbero disponible:'}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {candidateBarbers.map((cand) => (
                      <button
                        key={cand}
                        type="button"
                        className={`liquid-glass-pill px-3 py-1.5 text-xs font-medium ${
                          barber === cand ? 'active' : ''
                        }`}
                        onClick={() => setBarber(cand)}
                      >
                        <User size={12} />
                        <span>{cand}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
          STEP 4: DATOS
          ==================================================================== */}
      {step === 4 && (
        <div className="space-y-4">
          <div>
            <h2 className="liquid-serif-heading text-2xl text-[var(--lq-text-primary)]">
              Tus datos de contacto
            </h2>
            <p className="text-sm text-[var(--lq-text-secondary)] mt-0.5">
              Te enviaremos la confirmación del turno por correo y WhatsApp.
            </p>
          </div>

          <div className="liquid-glass-card p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--lq-text-muted)] mb-1.5">
                Nombre y Apellido
              </label>
              <input
                type="text"
                required
                className="liquid-input"
                placeholder="Ej. Juan Pérez"
                value={contact.name}
                onChange={(e) => setContact({ ...contact, name: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--lq-text-muted)] mb-1.5">
                Teléfono móvil (WhatsApp)
              </label>
              <Suspense fallback={<input type="tel" className="liquid-input" />}>
                <PhoneInput
                  value={contact.phone}
                  onChange={(val) => setContact({ ...contact, phone: val })}
                  country={phoneCountry}
                  onCountryChange={setPhoneCountry}
                  className="w-full"
                  inputClassName="liquid-input"
                />
              </Suspense>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--lq-text-muted)] mb-1.5">
                Correo electrónico
              </label>
              <input
                type="email"
                required
                className="liquid-input"
                placeholder="nombre@email.com"
                value={contact.email}
                onChange={(e) => setContact({ ...contact, email: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--lq-text-muted)] mb-1.5">
                Notas adicionales (opcional)
              </label>
              <textarea
                rows={2}
                className="liquid-input resize-none"
                placeholder="Preferencias o indicaciones sobre tu corte..."
                value={contact.notes}
                onChange={(e) => setContact({ ...contact, notes: e.target.value })}
              />
            </div>

            {/* Cupón de descuento */}
            <div className="pt-2 border-t border-[var(--lq-glass-border-subtle)]">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--lq-text-muted)] mb-1.5">
                Código de descuento / beneficio
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="liquid-input uppercase tracking-wider text-sm flex-1"
                  placeholder="CÓDIGO"
                  value={benefitCode}
                  onChange={(e) => setBenefitCode(e.target.value.toUpperCase())}
                />
                <button
                  type="button"
                  className="liquid-btn-secondary text-xs px-4"
                  onClick={handleApplyBenefitCode}
                  disabled={validatingBenefit || !benefitCode.trim()}
                >
                  {validatingBenefit ? <Loader2 size={14} className="animate-spin" /> : 'Aplicar'}
                </button>
              </div>
              {appliedBenefit && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-1.5 flex items-center gap-1">
                  <Check size={12} />
                  Código aplicado: {appliedBenefit.description || 'Descuento confirmado'}
                </p>
              )}
              {benefitError && (
                <p className="text-xs text-rose-500 font-medium mt-1.5">
                  {benefitError}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          STEP 5: PAGO Y CONFIRMACIÓN (PAYWAY)
          ==================================================================== */}
      {step === 5 && (
        <div className="space-y-4">
          <div>
            <h2 className="liquid-serif-heading text-2xl text-[var(--lq-text-primary)]">
              Confirmación & Seña
            </h2>
            <p className="text-sm text-[var(--lq-text-secondary)] mt-0.5">
              Revisá los detalles de tu turno y asegurá tu lugar con PayWay.
            </p>
          </div>

          {/* Resumen Card */}
          <div className="liquid-glass-card p-5 space-y-2.5">
            <div className="flex justify-between items-center text-sm border-b border-[var(--lq-glass-border-subtle)] pb-2">
              <span className="text-[var(--lq-text-muted)]">Servicio:</span>
              <span className="font-semibold text-[var(--lq-text-primary)]">{serviceName}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-[var(--lq-glass-border-subtle)] pb-2">
              <span className="text-[var(--lq-text-muted)]">Barbero:</span>
              <span className="font-semibold text-[var(--lq-text-primary)]">{barber ?? candidateBarbers[0]}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-[var(--lq-glass-border-subtle)] pb-2">
              <span className="text-[var(--lq-text-muted)]">Fecha y hora:</span>
              <span className="font-semibold text-[var(--lq-text-primary)]">{dateLabel(date)} · {time} hs</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-[var(--lq-glass-border-subtle)] pb-2">
              <span className="text-[var(--lq-text-muted)]">Valor total del servicio:</span>
              <span className="font-semibold text-[var(--lq-text-primary)]">{money(servicePrice)}</span>
            </div>
            <div className="flex justify-between items-center text-base pt-1">
              <span className="font-bold text-[var(--lq-text-primary)]">Seña requerida ahora:</span>
              <span className="font-bold text-lg text-[var(--lq-carmesi)] dark:text-[#ff9fb2]">
                {depositArs === 0 ? 'Sin seña ($0)' : money(depositArs)}
              </span>
            </div>
            {depositArs > 0 && (
              <p className="text-xs text-[var(--lq-text-muted)] mt-1">
                El saldo restante de {money(servicePrice - depositArs)} se abona en el estudio el día de tu turno.
              </p>
            )}
          </div>

          {/* Payway Form */}
          {depositArs > 0 ? (
            <form onSubmit={handleExecutePayment} className="liquid-glass-card p-6 space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--lq-text-muted)]">
                <Lock size={13} className="text-emerald-500" />
                <span>Pago seguro cifrado con PayWay</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--lq-text-muted)] mb-1">
                  Número de tarjeta
                </label>
                <input
                  type="text"
                  required
                  maxLength={19}
                  className="liquid-input"
                  placeholder="4500 0000 0000 0000"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(formatCardPan(e.target.value))}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--lq-text-muted)] mb-1">
                  Nombre y apellido (como figura en la tarjeta)
                </label>
                <input
                  type="text"
                  required
                  className="liquid-input uppercase"
                  placeholder="JUAN PEREZ"
                  value={cardholderName}
                  onChange={(e) => setCardholderName(e.target.value.toUpperCase())}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--lq-text-muted)] mb-1">
                    Vencimiento (MM/AA)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      maxLength={2}
                      className="liquid-input text-center"
                      placeholder="MM"
                      value={monthExpiry}
                      onChange={(e) => setMonthExpiry(e.target.value.replace(/\D/g, ''))}
                    />
                    <input
                      type="text"
                      required
                      maxLength={2}
                      className="liquid-input text-center"
                      placeholder="AA"
                      value={yearExpiry}
                      onChange={(e) => setYearExpiry(e.target.value.replace(/\D/g, ''))}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--lq-text-muted)] mb-1">
                    Código de seguridad (CVV)
                  </label>
                  <input
                    type="password"
                    required
                    maxLength={4}
                    className="liquid-input text-center"
                    placeholder="123"
                    value={cvv}
                    onChange={(e) => setCvv(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--lq-text-muted)] mb-1">
                  DNI del titular
                </label>
                <input
                  type="text"
                  required
                  className="liquid-input"
                  placeholder="12.345.678"
                  value={dniNumber}
                  onChange={(e) => setDniNumber(formatDni(e.target.value))}
                />
              </div>

              {paymentError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-500 font-medium">
                  {paymentError}
                </div>
              )}

              <button
                type="submit"
                disabled={isPaying}
                className="liquid-btn-primary w-full mt-4 py-3.5"
              >
                {isPaying ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Confirmando con PayWay...</span>
                  </>
                ) : (
                  <>
                    <CreditCard size={16} />
                    <span>Abonar seña {money(depositArs)}</span>
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="liquid-glass-card p-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center">
                <Check size={24} />
              </div>
              <div>
                <h3 className="font-semibold text-lg text-[var(--lq-text-primary)]">
                  Turno con 100% de bonificación
                </h3>
                <p className="text-xs text-[var(--lq-text-muted)] max-w-sm mx-auto mt-1">
                  Tu código de beneficio te exime del pago de la seña. Confirmá directamente tu turno a continuación.
                </p>
              </div>

              {paymentError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-500 font-medium">
                  {paymentError}
                </div>
              )}

              <button
                type="button"
                disabled={isPaying}
                onClick={handleExecutePayment}
                className="liquid-btn-primary w-full py-3.5"
              >
                {isPaying ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Confirmando tu reserva...</span>
                  </>
                ) : (
                  <span>Confirmar turno gratuito</span>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Floating Bottom Navigation (Mobile & Desktop) */}
      {step < 5 && (
        <div className="mt-8 pt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            className="liquid-btn-secondary flex-1 sm:flex-initial"
            onClick={handleBack}
          >
            <span>{step === 0 ? 'Cancelar' : 'Volver'}</span>
          </button>

          <button
            type="button"
            className="liquid-btn-primary flex-1 sm:flex-initial"
            disabled={!canContinue}
            onClick={handleNext}
          >
            <span>Continuar</span>
          </button>
        </div>
      )}
    </div>
  );
}
