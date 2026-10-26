import { isPaywaySandboxBase, type PaywayCheckout } from './kani-payway';

/** Card values remain in the DOM and in this short-lived request only. No state,
 * storage, telemetry, error payloads or calls to Kani contain PAN/CVV.
 * Official REST contract: Gateway / Solicitud de Token de Pago.
 */
export async function tokenizePaywayForm(form: HTMLFormElement, checkout: PaywayCheckout) {
  if (!isPaywaySandboxBase(checkout.apiBaseUrl)) throw new Error('PAYWAY_TOKENIZATION_UNAVAILABLE');
  const value = (key: string) => (form.elements.namedItem(key) as HTMLInputElement | null)?.value.trim() ?? '';
  const response = await fetch(`${checkout.apiBaseUrl}/tokens`, {
    method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { apikey: checkout.publicKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card_number: value('card_number').replace(/\s/g, ''), security_code: value('security_code'),
      card_expiration_month: value('card_expiration_month'), card_expiration_year: value('card_expiration_year'),
      card_holder_name: value('card_holder_name'),
      card_holder_identification: { type: 'dni', number: value('card_holder_doc_number') },
    }),
  });
  if (!response.ok) throw new Error('PAYWAY_TOKENIZATION_FAILED');
  const data = await response.json() as { id?: unknown; bin?: unknown };
  if (typeof data.id !== 'string' || !/^[A-Za-z0-9-]{1,36}$/.test(data.id) ||
    typeof data.bin !== 'string' || !/^\d{6}$/.test(data.bin)) throw new Error('PAYWAY_TOKENIZATION_FAILED');
  return { token: data.id, bin: data.bin };
}
