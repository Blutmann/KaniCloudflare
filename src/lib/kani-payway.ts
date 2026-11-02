// Public contracts only. No credentials, runtime bindings or provider responses here.
export type PaywayState = 'approved' | 'rejected' | 'unknown' | 'recoverable' | 'unavailable' | 'verifying' | 'review';
export type PaywayResult = { state: PaywayState; message: string; appointmentConfirmed?: boolean };
export type PaywayDraft = {
  barber: string; serviceName: string; date: string; time: string;
  name: string; email: string; phone: string; notes: string;
  benefitCode?: string;
};
export type PaywayCheckout = {
  appointmentId: string; attemptId: string; accessToken: string; depositArs: number;
  publicKey: string; apiBaseUrl: string;
  methods: { id: number; label: string }[];
  benefitCode?: string;
};
export type PaywayPreparation =
  | { ready: true; checkout: PaywayCheckout }
  | { ready: false; message: string; state?: 'unknown' | 'recoverable'; correlationId?: string; stage?: string };
export type PaywayPaymentInput = {
  appointmentId: string; attemptId: string; accessToken: string;
  token: string; bin: string; paymentMethodId: number;
};
export type PaywayStatusInput = {
  appointmentId: string;
  attemptId: string;
  accessToken: string;
};

export const PAYWAY_MESSAGES = {
  unavailable: 'El pago no está disponible en este momento. No se realizó ningún cobro ni se guardó un turno.',
  unknown: 'Estamos verificando tu pago. Podés cerrar esta ventana; seguiremos comprobándolo. No vuelvas a pagar mientras la verificación esté pendiente.',
  verifying: 'Estamos verificando tu pago. Podés cerrar esta ventana; seguiremos comprobándolo. No vuelvas a pagar mientras la verificación esté pendiente.',
  late_review: 'Tu pago fue registrado pero el turno ya no estaba disponible. Nos comunicaremos con vos a la brevedad.',
  approved: 'Seña aprobada. Tu turno está confirmado.',
  rejected: 'El pago fue rechazado. No se confirmó el turno. Podés intentar con otra tarjeta.',
  recoverable: 'No pudimos iniciar el pago. Revisá los datos y volvé a intentar.',
  technical_error: 'No pudimos procesar el pago. Revisá los datos e intentá nuevamente.',
} as const;

export const PAYWAY_SANDBOX_BASES = [
  'https://developers-ventasonline.payway.com.ar/api/v2',
  'https://developers.decidir.com/api/v2',
] as const;

export const PAYWAY_PRODUCTION_BASE = 'https://ventasonline.payway.com.ar/api/v2';

export const PAYWAY_PRODUCTION_BASES = [
  'https://ventasonline.payway.com.ar/api/v2',
  'https://live.decidir.com/api/v2',
] as const;

export const PAYWAY_ALLOWED_BASES = [
  ...PAYWAY_SANDBOX_BASES,
  ...PAYWAY_PRODUCTION_BASES,
] as const;

export function normalizePaywayBaseUrl(value: string | undefined): string {
  if (!value) return '';
  const trimmed = value.trim().replace(/\/+$/, '');
  if (
    trimmed === 'https://developers-ventasonline.payway.com.ar' ||
    trimmed === 'https://developers.decidir.com' ||
    trimmed === 'https://live.decidir.com' ||
    trimmed === 'https://ventasonline.payway.com.ar'
  ) {
    return `${trimmed}/api/v2`;
  }
  return trimmed;
}

export function isPaywayAllowedBase(value: string, environment?: 'sandbox' | 'production'): boolean {
  const normalized = normalizePaywayBaseUrl(value);
  if (environment === 'production') {
    return (PAYWAY_PRODUCTION_BASES as readonly string[]).includes(normalized);
  }
  if (environment === 'sandbox') {
    return (PAYWAY_SANDBOX_BASES as readonly string[]).includes(normalized);
  }
  return (PAYWAY_ALLOWED_BASES as readonly string[]).includes(normalized);
}

export function isPaywaySandboxBase(value: string): boolean {
  return isPaywayAllowedBase(value, 'sandbox');
}

export function isPaywayProductionBase(value: string): boolean {
  return isPaywayAllowedBase(value, 'production');
}

export function isPaywayApiBase(value: string): boolean {
  return isPaywaySandboxBase(value) || isPaywayProductionBase(value);
}

export function arsToPaywayAmount(ars: number): number {
  const amount = Math.round(ars * 100);
  if (!Number.isFinite(ars) || ars <= 0 || !Number.isSafeInteger(amount) || Math.abs(ars * 100 - amount) > 0.000001) {
    throw new Error('PAYWAY_AMOUNT_INVALID');
  }
  return amount;
}

// No arbitrary payload is forwarded to server functions (in particular, PAN/CVV).
export function validatePaywayPayment(input: unknown): PaywayPaymentInput {
  if (!input || typeof input !== 'object') throw new Error('PAYWAY_INPUT_INVALID');
  const d = input as Partial<PaywayPaymentInput> & Record<string, unknown>;
  const keys = ['appointmentId', 'attemptId', 'accessToken', 'token', 'bin', 'paymentMethodId'];
  if (Object.keys(d).some(key => !keys.includes(key)) ||
    !/^[a-f0-9-]{36}$/i.test(String(d.appointmentId)) ||
    !/^[a-f0-9]{32}$/i.test(String(d.attemptId)) ||
    typeof d.accessToken !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(d.accessToken) ||
    typeof d.token !== 'string' || !/^[A-Za-z0-9-]{1,36}$/.test(d.token) ||
    typeof d.bin !== 'string' || !/^\d{6}$/.test(d.bin) ||
    !Number.isSafeInteger(d.paymentMethodId) || Number(d.paymentMethodId) <= 0) {
    throw new Error('PAYWAY_INPUT_INVALID');
  }
  return d as PaywayPaymentInput;
}

export function validatePaywayDraft(input: unknown): PaywayDraft {
  if (!input || typeof input !== 'object') throw new Error('PAYWAY_DRAFT_INVALID');
  const d = input as Partial<PaywayDraft> & Record<string, unknown>;
  const limits: Record<string, number> = { barber: 100, serviceName: 100, date: 10, time: 5, name: 120, email: 254, phone: 30, notes: 500, benefitCode: 32 };
  if (Object.keys(d).some(key => !(key in limits))) throw new Error('PAYWAY_DRAFT_INVALID');
  for (const [key, max] of Object.entries(limits)) {
    if (key === 'benefitCode' && (d[key] === undefined || d[key] === null || d[key] === '')) {
      continue;
    }
    if (typeof d[key] !== 'string' || (d[key] as string).length > max || key !== 'notes' && key !== 'benefitCode' && !(d[key] as string).trim()) {
      throw new Error('PAYWAY_DRAFT_INVALID');
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date)) || !/^\d{2}:\d{2}$/.test(String(d.time)) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.email))) throw new Error('PAYWAY_DRAFT_INVALID');
  return d as PaywayDraft;
}

export function validatePaywayStatusQuery(input: unknown): PaywayStatusInput {
  if (!input || typeof input !== 'object') throw new Error('PAYWAY_INPUT_INVALID');
  const d = input as Partial<PaywayStatusInput> & Record<string, unknown>;
  if (
    !/^[a-f0-9-]{36}$/i.test(String(d.appointmentId)) ||
    !/^[a-f0-9]{32}$/i.test(String(d.attemptId)) ||
    typeof d.accessToken !== 'string' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(d.accessToken)
  ) {
    throw new Error('PAYWAY_INPUT_INVALID');
  }
  return {
    appointmentId: String(d.appointmentId),
    attemptId: String(d.attemptId),
    accessToken: d.accessToken,
  };
}
