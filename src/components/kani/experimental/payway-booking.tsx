import { useRef, useState } from 'react';
import { Booking, type BookingPaymentDraft } from '@/components/kani/booking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { preparePaywayCheckoutFn, payPaywayDepositFn } from '@/lib/kani-payway.functions';
import { tokenizePaywayForm } from '@/lib/kani-payway.browser';
import { PAYWAY_MESSAGES, type PaywayCheckout, type PaywayResult } from '@/lib/kani-payway';
import { money } from '@/lib/kani-model';

export function PaywayBooking() {
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [checkout, setCheckout] = useState<PaywayCheckout | null>(null);
  const [result, setResult] = useState<PaywayResult | null>(null);
  const [stage, setStage] = useState<'idle' | 'tokenizing' | 'paying'>('idle');
  const opening = useRef(false);
  const paying = useRef(false);
  const terminal = result?.state === 'approved' || result?.state === 'unknown';

  async function begin(draft: BookingPaymentDraft) {
    if (opening.current || terminal) { setOpen(true); return; }
    opening.current = true;
    setOpen(true); setPreparing(true); setResult(null); setCheckout(null);
    try {
      const response = await preparePaywayCheckoutFn({ data: draft });
      if (response.ready) setCheckout(response.checkout);
      else setResult({ state: 'unavailable', message: response.message });
    } catch { setResult({ state: 'unavailable', message: PAYWAY_MESSAGES.unavailable }); }
    finally { opening.current = false; setPreparing(false); }
  }

  async function pay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (paying.current || terminal || !checkout) return;
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
      setResult(response);
      // A rejection consumes this attempt; a new server attempt is required, never reuse it.
      if (response.state !== 'recoverable') setCheckout(null);
    } catch {
      setResult({ state: sent ? 'unknown' : 'recoverable', message: sent ? PAYWAY_MESSAGES.unknown : 'No pudimos validar la tarjeta. Revisá sus datos e intentá nuevamente.' });
      if (sent) setCheckout(null);
    } finally { form.reset(); paying.current = false; setStage('idle'); }
  }

  return <div className="payway-reservation">
    <Booking combinedDateTime onPaymentRequest={begin} />
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
