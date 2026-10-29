import { useEffect, useRef, useState } from 'react';
import { Check, Instagram, MapPin } from 'lucide-react';
import { Booking, type BookingPaymentDraft } from '@/components/kani/booking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { preparePaywayCheckoutFn, payPaywayDepositFn } from '@/lib/kani-payway.functions';
import { tokenizePaywayForm } from '@/lib/kani-payway.browser';
import { PAYWAY_MESSAGES, type PaywayCheckout, type PaywayResult } from '@/lib/kani-payway';
import { readConfiguredServices, type ConfiguredService } from '@/lib/kani-availability';
import { dateLabel, money, services } from '@/lib/kani-model';

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
  const draftRef = useRef<BookingPaymentDraft | null>(null);
  const paidAppointmentsRef = useRef<Set<string>>(readPaidAppointments());
  const opening = useRef(false);
  const paying = useRef(false);
  const isApprovedConfirmed = Boolean(confirmed) || (result?.state === 'approved' && result?.appointmentConfirmed === true);
  const terminal = isApprovedConfirmed || result?.state === 'unknown';

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
    if (!form.reportValidity()) return;
    paying.current = true; setStage('tokenizing'); setResult(null);
    let sent = false;
    try {
      const token = await tokenizePaywayForm(form, checkout);
      // The selected payment-method ID is non-sensitive; the provider validates the BIN.
      const paymentMethodId = Number((form.elements.namedItem('paymentMethod') as HTMLSelectElement).value);
      form.reset(); // Clear all card values before calling Kani.
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
    } finally { form.reset(); paying.current = false; setStage('idle'); }
  }

  function startNewReservation() {
    clearConfirmedBookingView();
    draftRef.current = null;
    setConfirmed(null);
    setResult(null);
    setCheckout(null);
    setOpen(false);
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

  return <div className="payway-reservation">
    <Booking variant="v3" onPaymentRequest={begin} />
    <Dialog open={open} onOpenChange={value => { if (!paying.current && !opening.current) setOpen(value); }}>
      <DialogContent className="payway-checkout" onEscapeKeyDown={e => { if (paying.current) e.preventDefault(); }} onPointerDownOutside={e => { if (paying.current) e.preventDefault(); }}>
        <DialogTitle>Pagar seña con Payway</DialogTitle>
        <DialogDescription>{checkout ? `Seña: ${money(checkout.depositArs)} · Pago seguro` : 'Reserva experimental con Payway'}</DialogDescription>
        {preparing && <p role="status">Preparando pago seguro…</p>}
        {result && <p role={result.state === 'approved' ? 'status' : 'alert'} className="payway-result">{result.message}</p>}
        {checkout && !terminal && <form onSubmit={pay} autoComplete="off" data-private="redact" data-sensitive="true" className="payway-card-form">
          <fieldset disabled={stage !== 'idle'}>
            <label>Medio de pago<select name="paymentMethod" required aria-label="Medio de pago">{checkout.methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
            <label>Número de tarjeta<Input name="card_number" aria-label="Número de tarjeta" inputMode="numeric" autoComplete="off" maxLength={23} required pattern="[0-9 ]{15,23}" /></label>
            <div className="payway-card-row">
              <label>Mes<Input name="card_expiration_month" aria-label="Mes de vencimiento" placeholder="MM" inputMode="numeric" autoComplete="off" required pattern="0[1-9]|1[0-2]" maxLength={2} /></label>
              <label>Año<Input name="card_expiration_year" aria-label="Año de vencimiento" placeholder="AA" inputMode="numeric" autoComplete="off" required pattern="[0-9]{2}" maxLength={2} /></label>
              <label>Código<Input name="security_code" aria-label="Código de seguridad" type="password" inputMode="numeric" autoComplete="off" required pattern="[0-9]{3,4}" maxLength={4} /></label>
            </div>
            <label>Titular<Input name="card_holder_name" aria-label="Nombre del titular" autoComplete="off" required maxLength={60} /></label>
            <label>DNI del titular<Input name="card_holder_doc_number" aria-label="DNI del titular" inputMode="numeric" autoComplete="off" required pattern="[0-9]{6,10}" maxLength={10} /></label>
            <Button type="submit" className="action-positive" disabled={stage !== 'idle'}>{stage === 'tokenizing' ? 'Validando tarjeta…' : stage === 'paying' ? 'Procesando pago…' : 'Pagar seña'}</Button>
          </fieldset>
        </form>}
        {result?.state === 'unknown' && <p className="text-sm">Conservá esta pantalla y contactá al estudio. Tu turno todavía no está confirmado.</p>}
        {!checkout && stage === 'idle' && !preparing && <Button variant="outline" onClick={() => setOpen(false)}>{terminal ? 'Cerrar' : 'Volver a mis datos'}</Button>}
      </DialogContent>
    </Dialog>
  </div>;
}
