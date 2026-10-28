import { arsToPaywayAmount, isPaywaySandboxBase, normalizePaywayBaseUrl, PAYWAY_MESSAGES, validatePaywayPayment,
  type PaywayDraft, type PaywayPaymentInput, type PaywayPreparation, type PaywayResult } from './kani-payway';

type EnvironmentReader = (name: string) => string | undefined;
export type PaywayConfig = {
  apiBaseUrl: string; publicKey: string; privateKey: string; siteId: string;
  methods: { id: number; label: string }[];
};

export function readPaywayConfig(env: EnvironmentReader): PaywayConfig | null {
  // This laboratory deliberately has no production mode or arbitrary destination.
  if (env('PAYWAY_SANDBOX_ENABLED') !== 'true' || env('PAYWAY_ENVIRONMENT') !== 'sandbox' || env('SUPABASE_URL') !== 'https://iockpxtkflyjfagkvgnr.supabase.co') return null;
  const apiBaseUrl = normalizePaywayBaseUrl(env('PAYWAY_API_BASE_URL'));
  const publicKey = env('PAYWAY_PUBLIC_API_KEY');
  const privateKey = env('PAYWAY_PRIVATE_API_KEY');
  const siteId = env('PAYWAY_SITE_ID');
  if (!isPaywaySandboxBase(apiBaseUrl) || !publicKey || !privateKey || !siteId || !/^\d{1,20}$/.test(siteId)) return null;
  try {
    const methods: PaywayConfig['methods'] = JSON.parse(env('PAYWAY_PAYMENT_METHODS') ?? '[]');
    if (!Array.isArray(methods) || !methods.length || methods.length > 50 || methods.some(m =>
      !Number.isSafeInteger(m.id) || m.id <= 0 || typeof m.label !== 'string' || !m.label.trim() || m.label.length > 80)) return null;
    return { apiBaseUrl, publicKey, privateKey, siteId, methods: methods.map(({ id, label }) => ({ id, label })) };
  } catch { return null; }
}

export function newPaywayAttemptId(): string { return crypto.randomUUID().replaceAll('-', ''); }
export function paywayTransactionId(attemptId: string): string {
  if (!/^[a-f0-9]{32}$/i.test(attemptId)) throw new Error('PAYWAY_ATTEMPT_INVALID');
  return `KANI${attemptId}`; // 36 alphanumeric characters; provider limit is 39.
}

export type PaywayAppointment = {
  id: string; status: string; depositArs: number; servicePriceArs: number;
  depositPaid: boolean; origin: string;
};
export type PaywayAttempt = {
  id: string; appointmentId: string; siteTransactionId: string; amount: number;
  state: 'prepared' | 'processing' | 'approved' | 'rejected' | 'unknown';
  result?: PaywayResult;
};

/** Durable adapter contract. No in-memory lock is substituted for cross-Worker atomicity.
 * claim verifies the checkout capability, locks the appointment, checks expiry and
 * claims the attempt atomically, including exclusion of other processing/unknown attempts.
 * settle persists provider evidence; confirm rechecks slot/expiry and confirms once.
 */
export interface PaywayStore {
  prepare(draft: PaywayDraft): Promise<{
    appointmentId: string; attemptId: string; accessToken: string; depositArs: number;
  }>;
  claim(input: Pick<PaywayPaymentInput, 'appointmentId' | 'attemptId' | 'accessToken'>): Promise<{
    acquired: boolean; appointment: PaywayAppointment; attempt: PaywayAttempt;
  }>;
  settle(attemptId: string, state: 'approved' | 'rejected' | 'unknown', providerId?: string, providerStatus?: string, providerCode?: string): Promise<void>;
  confirm(appointmentId: string, attemptId: string, providerId: string, amount: number): Promise<boolean>;
}

export function createPaywayService({ config, store, fetcher = fetch }: {
  config: PaywayConfig | null; store: PaywayStore | null; fetcher?: typeof fetch;
}) {
  return {
    async prepare(draft: PaywayDraft): Promise<PaywayPreparation> {
      if (!config || !store || !isPaywaySandboxBase(config.apiBaseUrl)) return { ready: false, message: PAYWAY_MESSAGES.unavailable };
      try {
        const prepared = await store.prepare(draft);
        arsToPaywayAmount(prepared.depositArs);
        return { ready: true, checkout: { appointmentId: prepared.appointmentId, attemptId: prepared.attemptId,
          accessToken: prepared.accessToken, depositArs: prepared.depositArs,
          publicKey: config.publicKey, apiBaseUrl: config.apiBaseUrl, methods: config.methods } };
      } catch (cause) {
        return cause instanceof Error && cause.message === 'PAYMENT_REVIEW_REQUIRED'
          ? { ready: false, state: 'unknown', message: PAYWAY_MESSAGES.unknown }
          : { ready: false, message: PAYWAY_MESSAGES.unavailable };
      }
    },
    async pay(raw: unknown): Promise<PaywayResult> {
      if (!config || !store || !isPaywaySandboxBase(config.apiBaseUrl)) return { state: 'unavailable', message: PAYWAY_MESSAGES.unavailable };
      let input: PaywayPaymentInput;
      try { input = validatePaywayPayment(raw); }
      catch { return { state: 'recoverable', message: PAYWAY_MESSAGES.recoverable }; }
      if (!config.methods.some(m => m.id === input.paymentMethodId)) return { state: 'recoverable', message: PAYWAY_MESSAGES.recoverable };
      let claim: Awaited<ReturnType<PaywayStore['claim']>>;
      try { claim = await store.claim({ appointmentId: input.appointmentId, attemptId: input.attemptId, accessToken: input.accessToken }); }
      catch { return { state: 'unknown', message: PAYWAY_MESSAGES.unknown }; }
      if (claim.appointment.id !== input.appointmentId || claim.attempt.id !== input.attemptId ||
        claim.attempt.appointmentId !== input.appointmentId) return { state: 'unknown', message: PAYWAY_MESSAGES.unknown };
      if (!claim.acquired) {
        // Never trust a client's retry or replay a token. Return only a durable result.
        return claim.attempt.result ?? { state: 'unknown', message: PAYWAY_MESSAGES.unknown };
      }
      const { appointment, attempt } = claim;
      let amount: number;
      try { amount = arsToPaywayAmount(appointment.depositArs); }
      catch { return { state: 'unknown', message: PAYWAY_MESSAGES.unknown }; }
      if (appointment.id !== input.appointmentId || attempt.id !== input.attemptId ||
        attempt.appointmentId !== appointment.id || attempt.siteTransactionId !== paywayTransactionId(input.attemptId) ||
        attempt.amount !== amount || appointment.status !== 'PENDING' || appointment.depositPaid ||
        appointment.origin !== 'PUBLIC_WEB' || !Number.isFinite(appointment.servicePriceArs) || appointment.depositArs > appointment.servicePriceArs) {
        return { state: 'unknown', message: PAYWAY_MESSAGES.unknown };
      }
      let approvalSaved = false;
      try {
        const response = await fetcher(`${config.apiBaseUrl}/payments`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35_000),
          headers: { apikey: config.privateKey, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
          body: JSON.stringify({ site_transaction_id: attempt.siteTransactionId, token: input.token,
            payment_method_id: input.paymentMethodId, bin: input.bin, amount, currency: 'ARS',
            installments: 1, payment_type: 'single', sub_payments: [] }),
        });
        // No automatic retries, provider logs, raw errors or raw responses to the browser.
        const payment = await response.json() as {
          id?: unknown; site_transaction_id?: unknown; amount?: unknown;
          currency?: unknown; site_id?: unknown; status?: unknown;
        };
        const providerId = typeof payment.id === 'number' && Number.isSafeInteger(payment.id) && payment.id > 0
          ? String(payment.id)
          : typeof payment.id === 'string' && /^\d+$/.test(payment.id)
          ? payment.id
          : null;
        const amountMatches = payment.amount === amount ||
          (typeof payment.amount === 'number' && Math.round(payment.amount * 100) === amount);
        const matches = Boolean(
          providerId &&
          payment.site_transaction_id === attempt.siteTransactionId &&
          amountMatches &&
          typeof payment.currency === 'string' &&
          payment.currency.toUpperCase() === 'ARS' &&
          (payment.site_id == null || String(payment.site_id) === String(config.siteId))
        );
        if (!matches) throw new Error('PAYWAY_EVIDENCE_MISMATCH');
        if (response.ok && payment.status === 'approved') {
          await store.settle(attempt.id, 'approved', providerId, 'approved');
          approvalSaved = true;
          const confirmed = await store.confirm(appointment.id, attempt.id, providerId, amount);
          return confirmed
            ? { state: 'approved', message: PAYWAY_MESSAGES.approved, appointmentConfirmed: true }
            : { state: 'unknown', message: PAYWAY_MESSAGES.unknown };
        }
        // Exact literal only; reject envelopes must be certified with the merchant's sandbox.
        if (payment.status === 'rejected') {
          await store.settle(attempt.id, 'rejected', providerId, 'rejected');
          return { state: 'rejected', message: PAYWAY_MESSAGES.rejected };
        }
        throw new Error('PAYWAY_RESULT_UNCERTAIN');
      } catch {
        if (!approvalSaved) {
          try { await store.settle(attempt.id, 'unknown'); } catch { /* Still fail closed if persistence is unavailable. */ }
        }
        return { state: 'unknown', message: PAYWAY_MESSAGES.unknown };
      }
    },
  };
}

export async function queryPaywayPayment(
  config: PaywayConfig,
  siteTransactionId: string,
  fetcher: typeof fetch = fetch
): Promise<{ matches: boolean; providerId: string; status: 'approved' | 'rejected' | 'unknown' } | null> {
  if (!config || !isPaywaySandboxBase(config.apiBaseUrl)) return null;
  try {
    const url = `${config.apiBaseUrl}/payments?siteOperationId=${encodeURIComponent(siteTransactionId)}`;
    const response = await fetcher(url, {
      method: 'GET',
      headers: { apikey: config.privateKey, 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      results?: Array<{
        id?: unknown;
        site_transaction_id?: unknown;
        amount?: unknown;
        currency?: unknown;
        status?: unknown;
        site_id?: unknown;
      }>;
      id?: unknown;
      site_transaction_id?: unknown;
      status?: unknown;
    };
    const items = Array.isArray(body.results) ? body.results : (body.id ? [body] : []);
    const item = items.find((p) => p.site_transaction_id === siteTransactionId);
    if (!item) return null;
    const providerId =
      typeof item.id === 'number' && Number.isSafeInteger(item.id) && item.id > 0
        ? String(item.id)
        : typeof item.id === 'string' && /^\d+$/.test(item.id)
        ? item.id
        : null;
    if (!providerId) return null;
    const status =
      item.status === 'approved'
        ? ('approved' as const)
        : item.status === 'rejected'
        ? ('rejected' as const)
        : ('unknown' as const);
    return { matches: true, providerId, status };
  } catch {
    return null;
  }
}

export async function runtimePaywayService() {
  const { getRuntimeEnv } = await import('./kani-mercadopago.server');
  const config = readPaywayConfig(getRuntimeEnv);
  if (!config) return createPaywayService({ config: null, store: null });
  let secret = getRuntimeEnv('PAYWAY_CHECKOUT_SECRET');
  if (!secret || secret.length < 32) {
    const salt = getRuntimeEnv('SUPABASE_SERVICE_ROLE_KEY') ?? 'kani_sandbox_checkout_secret_salt_32';
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(config.privateKey + salt));
    secret = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const { createPaymentSupabaseClient } = await import('./kani-payment-db.server');
  const { createPaywayStore } = await import('./kani-payway-store.server');
  const { paywaySessionAccess } = await import('./kani-payway-session.server');
  return createPaywayService({ config, store: createPaywayStore(await createPaymentSupabaseClient(), config.siteId, paywaySessionAccess(secret)) });
}
