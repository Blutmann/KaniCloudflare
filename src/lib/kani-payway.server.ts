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
  clientId?: string;
  clientEmail?: string;
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

      const clientEmail = appointment.clientEmail?.trim().toLowerCase();
      if (!clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
        return { state: 'recoverable', message: 'No pudimos verificar el email de la reserva. Revisá tus datos e intentá nuevamente.' };
      }
      const customerId = (appointment.clientId || appointment.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);

      let approvalSaved = false;
      try {
        const response = await fetcher(`${config.apiBaseUrl}/payments`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35_000),
          headers: { apikey: config.privateKey, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
          body: JSON.stringify({
            site_transaction_id: attempt.siteTransactionId,
            token: input.token,
            payment_method_id: input.paymentMethodId,
            bin: input.bin,
            amount,
            currency: 'ARS',
            installments: 1,
            description: 'Seña turno Kani Barber Studio',
            payment_type: 'single',
            sub_payments: [],
            customer: {
              id: customerId,
              email: clientEmail,
            },
          }),
        });
        const rawJson = await response.json().catch(() => ({}));
        const normalized = normalizePaywayResponse(rawJson);

        const classification = classifyPaywayResponse({
          responseStatus: response.status,
          ok: response.ok,
          normalized,
          expectedSiteTransactionId: attempt.siteTransactionId,
          expectedAmount: amount,
          expectedSiteId: config.siteId,
        });

        logPaywayDiagnostic({
          httpStatus: response.status,
          paywayStatus: normalized.status,
          errorType: normalized.errorType,
          errorCode: normalized.errorCode,
          providerId: normalized.id,
          siteTransactionId: normalized.siteTransactionId,
          classification: classification.kind,
          detail: 'code' in classification ? classification.code : ('reason' in classification ? classification.reason : undefined),
        });

        if (classification.kind === 'APPROVED') {
          await store.settle(attempt.id, 'approved', classification.providerId, 'approved');
          approvalSaved = true;
          const confirmed = await store.confirm(appointment.id, attempt.id, classification.providerId, amount);
          return confirmed
            ? { state: 'approved', message: PAYWAY_MESSAGES.approved, appointmentConfirmed: true }
            : { state: 'unknown', message: PAYWAY_MESSAGES.unknown };
        }

        if (classification.kind === 'REJECTED') {
          await store.settle(attempt.id, 'rejected', classification.providerId, 'rejected', classification.code);
          return { state: 'rejected', message: PAYWAY_MESSAGES.rejected };
        }

        if (classification.kind === 'TECHNICAL_ERROR') {
          await store.settle(attempt.id, 'rejected', undefined, 'rejected', 'validation_error');
          return { state: 'rejected', message: PAYWAY_MESSAGES.technical_error };
        }

        // UNKNOWN branch
        await store.settle(attempt.id, 'unknown');
        return { state: 'unknown', message: PAYWAY_MESSAGES.unknown };
      } catch (err) {
        logPaywayDiagnostic({
          httpStatus: 0,
          classification: 'UNKNOWN',
          detail: err instanceof Error ? err.name : 'UNKNOWN_EXCEPTION',
        });
        if (!approvalSaved) {
          try {
            await store.settle(attempt.id, 'unknown');
          } catch { /* Still fail closed if persistence is unavailable. */ }
        }
        return { state: 'unknown', message: PAYWAY_MESSAGES.unknown };
      }
    },
  };
}

export type NormalizedPaywayResponse = {
  id: string | null;
  siteTransactionId: string | null;
  amount: number | null;
  currency: string | null;
  siteId: string | null;
  status: string | null;
  errorType: string | null;
  errorCode: string | null;
  validationErrors: unknown[] | null;
  message: string | null;
};

export function normalizePaywayResponse(raw: unknown): NormalizedPaywayResponse {
  if (typeof raw !== 'object' || raw === null) {
    return {
      id: null,
      siteTransactionId: null,
      amount: null,
      currency: null,
      siteId: null,
      status: null,
      errorType: null,
      errorCode: null,
      validationErrors: null,
      message: null,
    };
  }

  const rawObj = raw as Record<string, unknown>;
  const target: Record<string, unknown> =
    'data_response' in rawObj && typeof rawObj.data_response === 'object' && rawObj.data_response !== null
      ? (rawObj.data_response as Record<string, unknown>)
      : rawObj;

  const rawId = target.id ?? rawObj.id;
  const id =
    typeof rawId === 'number' && Number.isSafeInteger(rawId) && rawId > 0
      ? String(rawId)
      : typeof rawId === 'string' && /^\d+$/.test(rawId)
      ? rawId
      : null;

  const rawSiteTx = target.site_transaction_id ?? rawObj.site_transaction_id;
  const siteTransactionId = typeof rawSiteTx === 'string' && rawSiteTx.trim() ? rawSiteTx.trim() : null;

  const rawAmount = target.amount ?? rawObj.amount;
  const amount = typeof rawAmount === 'number' && Number.isFinite(rawAmount) ? rawAmount : null;

  const rawCurrency = target.currency ?? rawObj.currency;
  const currency = typeof rawCurrency === 'string' && rawCurrency.trim() ? rawCurrency.trim().toUpperCase() : null;

  const rawSiteId = target.site_id ?? rawObj.site_id;
  const siteId = rawSiteId != null ? String(rawSiteId).trim() : null;

  const rawStatus = target.status ?? rawObj.status;
  const status = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : null;

  const rawErrorType =
    target.error_type ??
    rawObj.error_type ??
    (typeof target.error === 'object' && target.error !== null && 'type' in (target.error as Record<string, unknown>)
      ? ((target.error as Record<string, unknown>).type as unknown)
      : null);
  const errorType = typeof rawErrorType === 'string' && rawErrorType.trim() ? rawErrorType.trim() : null;

  const rawValidation = target.validation_errors ?? rawObj.validation_errors;
  const validationErrors = Array.isArray(rawValidation) ? rawValidation : null;

  let errorCode: string | null = null;
  const statusDetails = target.status_details ?? rawObj.status_details;
  if (typeof statusDetails === 'object' && statusDetails !== null) {
    const errorObj = (statusDetails as Record<string, unknown>).error;
    if (typeof errorObj === 'object' && errorObj !== null) {
      const reasonObj = (errorObj as Record<string, unknown>).reason;
      if (typeof reasonObj === 'object' && reasonObj !== null && (reasonObj as Record<string, unknown>).id != null) {
        errorCode = String((reasonObj as Record<string, unknown>).id);
      } else if (typeof (errorObj as Record<string, unknown>).type === 'string') {
        errorCode = String((errorObj as Record<string, unknown>).type);
      }
    }
  }
  if (!errorCode && validationErrors && validationErrors.length > 0) {
    const first = validationErrors[0];
    if (typeof first === 'object' && first !== null) {
      const code = (first as Record<string, unknown>).code ?? (first as Record<string, unknown>).param;
      if (code) errorCode = String(code);
    }
  }
  if (!errorCode && typeof target.error === 'string') {
    errorCode = target.error;
  }

  const rawMsg = target.message ?? rawObj.message;
  const message = typeof rawMsg === 'string' ? rawMsg : null;

  return {
    id,
    siteTransactionId,
    amount,
    currency,
    siteId,
    status,
    errorType,
    errorCode,
    validationErrors,
    message,
  };
}

export type PaywayClassification =
  | { kind: 'APPROVED'; providerId: string; status: 'approved' }
  | { kind: 'REJECTED'; providerId?: string; status: 'rejected'; code?: string }
  | { kind: 'TECHNICAL_ERROR'; code?: string }
  | { kind: 'UNKNOWN'; reason: string };

export function classifyPaywayResponse({
  responseStatus,
  ok,
  normalized,
  expectedSiteTransactionId,
  expectedAmount,
  expectedSiteId,
}: {
  responseStatus: number;
  ok: boolean;
  normalized: NormalizedPaywayResponse;
  expectedSiteTransactionId: string;
  expectedAmount: number;
  expectedSiteId: string;
}): PaywayClassification {
  const providerId = normalized.id;

  // 1. HTTP 5xx or server/gateway error: cannot rule out processing -> UNKNOWN
  if (responseStatus >= 500) {
    return { kind: 'UNKNOWN', reason: `HTTP_${responseStatus}_GATEWAY_ERROR` };
  }

  const amountMatches =
    normalized.amount === expectedAmount ||
    (typeof normalized.amount === 'number' && Math.round(normalized.amount * 100) === expectedAmount);

  // 2. Strict evidence check for APPROVED:
  // Must satisfy all positive evidence conditions:
  const hasStrictApprovedEvidence = Boolean(
    ok &&
    normalized.status === 'approved' &&
    providerId &&
    normalized.siteTransactionId === expectedSiteTransactionId &&
    amountMatches &&
    normalized.currency === 'ARS' &&
    (normalized.siteId == null || normalized.siteId === expectedSiteId)
  );

  if (hasStrictApprovedEvidence) {
    return { kind: 'APPROVED', providerId: providerId!, status: 'approved' };
  }

  // If status is 'approved' but fails any strict evidence check:
  // Never confirm, never settle as rejected -> UNKNOWN
  if (normalized.status === 'approved') {
    return { kind: 'UNKNOWN', reason: 'APPROVED_EVIDENCE_MISMATCH' };
  }

  // 3. Explicit REJECTED check:
  if (normalized.status === 'rejected') {
    // Validate available evidence does not contradict current attempt:
    if (normalized.siteTransactionId != null && normalized.siteTransactionId !== expectedSiteTransactionId) {
      return { kind: 'UNKNOWN', reason: 'REJECTED_CONTRADICTORY_SITE_TRANSACTION_ID' };
    }
    if (normalized.currency != null && normalized.currency !== 'ARS') {
      return { kind: 'UNKNOWN', reason: 'REJECTED_CONTRADICTORY_CURRENCY' };
    }
    if (normalized.siteId != null && normalized.siteId !== expectedSiteId) {
      return { kind: 'UNKNOWN', reason: 'REJECTED_CONTRADICTORY_SITE_ID' };
    }
    if (normalized.amount != null && !amountMatches) {
      return { kind: 'UNKNOWN', reason: 'REJECTED_CONTRADICTORY_AMOUNT' };
    }

    return {
      kind: 'REJECTED',
      providerId: providerId ?? undefined,
      status: 'rejected',
      code: normalized.errorCode ?? normalized.errorType ?? undefined,
    };
  }

  // 4. Known Technical / Validation error on HTTP 400 or 422:
  const isTechnicalValidation =
    !ok &&
    (responseStatus === 400 || responseStatus === 422) &&
    providerId == null &&
    (
      normalized.errorType === 'invalid_request_error' ||
      (Array.isArray(normalized.validationErrors) && normalized.validationErrors.length > 0) ||
      (normalized.message != null && normalized.status == null)
    );

  if (isTechnicalValidation) {
    return {
      kind: 'TECHNICAL_ERROR',
      code: normalized.errorCode ?? normalized.errorType ?? 'validation_error',
    };
  }

  // 5. Any ambiguous, unknown status
  return { kind: 'UNKNOWN', reason: `AMBIGUOUS_RESPONSE_HTTP_${responseStatus}` };
}

function logPaywayDiagnostic(info: {
  httpStatus: number;
  paywayStatus?: string | null;
  errorType?: string | null;
  errorCode?: string | null;
  providerId?: string | null;
  siteTransactionId?: string | null;
  classification: string;
  detail?: string;
}): void {
  // Safe diagnostic log: Strictly NO PAN, CVV, token, API keys, Authorization, DNI, or cardholder names.
  try {
    console.warn('[Payway Gateway Diagnostic]', JSON.stringify({
      httpStatus: info.httpStatus,
      paywayStatus: info.paywayStatus ?? undefined,
      errorType: info.errorType ?? undefined,
      errorCode: info.errorCode ?? undefined,
      providerId: info.providerId ?? undefined,
      siteTransactionId: info.siteTransactionId ?? undefined,
      classification: info.classification,
      detail: info.detail ?? undefined,
      timestamp: new Date().toISOString(),
    }));
  } catch {
    /* Logging never throws */
  }
}

export async function queryPaywayPayment(
  config: PaywayConfig,
  siteTransactionId: string,
  fetcher: typeof fetch = fetch
): Promise<{ matches: boolean; providerId: string | null; status: 'approved' | 'rejected' | 'unknown' | 'not_found' } | null> {
  if (!config || !isPaywaySandboxBase(config.apiBaseUrl)) return null;
  try {
    const url = `${config.apiBaseUrl}/payments?siteOperationId=${encodeURIComponent(siteTransactionId)}`;
    const response = await fetcher(url, {
      method: 'GET',
      headers: { apikey: config.privateKey, 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const rawResults = body.results ?? (body.data_response ? [body.data_response] : body.id ? [body] : []);
    const items = Array.isArray(rawResults) ? rawResults : [];
    if (items.length === 0) {
      return { matches: false, providerId: null, status: 'not_found' };
    }
    const rawItem = items.find((p: any) => p && typeof p === 'object' && p.site_transaction_id === siteTransactionId);
    if (!rawItem) {
      return { matches: false, providerId: null, status: 'not_found' };
    }
    const normalized = normalizePaywayResponse(rawItem);
    const providerId = normalized.id;

    if (normalized.status === 'approved') {
      const isApprovedEvidenceValid = Boolean(
        providerId &&
        normalized.siteTransactionId === siteTransactionId &&
        normalized.currency === 'ARS' &&
        (normalized.siteId == null || normalized.siteId === config.siteId)
      );
      return isApprovedEvidenceValid
        ? { matches: true, providerId, status: 'approved' }
        : { matches: false, providerId, status: 'unknown' };
    }

    if (normalized.status === 'rejected') {
      const isContradictory = Boolean(
        (normalized.siteTransactionId != null && normalized.siteTransactionId !== siteTransactionId) ||
        (normalized.currency != null && normalized.currency !== 'ARS') ||
        (normalized.siteId != null && normalized.siteId !== config.siteId)
      );
      return isContradictory
        ? { matches: false, providerId, status: 'unknown' }
        : { matches: true, providerId, status: 'rejected' };
    }

    return { matches: false, providerId, status: 'unknown' };
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
