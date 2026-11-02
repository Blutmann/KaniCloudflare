import { createPaymentSupabaseClient } from './kani-payment-db.server';
import {
  type BenefitCalculation,
  type BenefitCodeItem,
  type BenefitCodeType,
  calculateBenefitAmounts,
  generateBenefitCodeString,
  normalizeBenefitCode,
} from './kani-benefit-codes';

/**
 * Lists benefit codes for admin maintenance view.
 * Requires ADMIN role checked via Supabase session or service role.
 */
export async function adminListBenefitCodes(): Promise<BenefitCodeItem[]> {
  const db = await createPaymentSupabaseClient();
  const { data, error } = await db.rpc('admin_list_benefit_codes');
  if (error) {
    console.error('[Kani Benefit Codes] Error fetching admin list:', error);
    throw new Error(error.message || 'Error al consultar códigos de beneficio');
  }
  return (data as BenefitCodeItem[]) || [];
}

/**
 * Creates a new benefit code from the admin maintenance panel.
 */
export async function adminCreateBenefitCode(params: {
  type: BenefitCodeType;
  internalNote?: string;
  code?: string;
}): Promise<BenefitCodeItem> {
  const db = await createPaymentSupabaseClient();
  const generatedCode = params.code ? normalizeBenefitCode(params.code) : generateBenefitCodeString();

  const { data, error } = await db.rpc('admin_create_benefit_code', {
    p_type: params.type,
    p_internal_note: params.internalNote || null,
    p_code: generatedCode,
  });

  if (error) {
    console.error('[Kani Benefit Codes] Error creating code:', error);
    throw new Error(error.message || 'Error al generar código de beneficio');
  }

  return data as BenefitCodeItem;
}

/**
 * Disables an active benefit code from admin panel.
 */
export async function adminDisableBenefitCode(codeId: string): Promise<boolean> {
  const db = await createPaymentSupabaseClient();
  const { data, error } = await db.rpc('admin_disable_benefit_code', {
    p_code_id: codeId,
  });

  if (error) {
    console.error('[Kani Benefit Codes] Error disabling code:', error);
    throw new Error(error.message || 'Error al desactivar el código');
  }

  return Boolean(data);
}

/**
 * Validates and quotes a benefit code in the public booking flow.
 * Recalculates all pricing and invariants strictly on the server.
 * Does NOT consume or lock the code.
 */
export async function validateBenefitCodeQuote(params: {
  code: string;
  serviceName: string;
  barberName: string;
}): Promise<BenefitQuote> {
  const normalized = normalizeBenefitCode(params.code);
  if (!normalized) {
    return { valid: false, message: 'Ingresá un código de beneficio.', error: 'Ingresá un código de beneficio.' };
  }

  const db = await createPaymentSupabaseClient();
  const { data, error } = await db.rpc('validate_and_quote_benefit_code', {
    p_code: normalized,
    p_service_name: params.serviceName,
    p_barber_name: params.barberName,
  });

  if (error) {
    console.error('[Kani Benefit Codes] Validation RPC error:', error);
    return { valid: false, message: 'No se pudo verificar el código en este momento.', error: 'No se pudo verificar el código en este momento.' };
  }

  const res = data as any;
  if (!res || !res.valid) {
    const msg = res?.error || res?.message || 'Código no válido o no disponible.';
    return { valid: false, message: msg, error: msg };
  }

  // Enforce calculation invariants on the server
  const calculation = calculateBenefitAmounts(
    res.originalPriceArs,
    res.onlineDepositArs + (res.benefitType === 'PERCENT_10' || res.benefitType === 'PERCENT_50' ? 0 : 5000),
    res.benefitType,
    normalized
  );

  return {
    valid: true,
    ...calculation,
    type: calculation.benefitType,
    label: calculation.benefitLabel,
    calculation,
  };
}

/**
 * Confirms an appointment when online deposit is $0 (NO_DEPOSIT or FREE_SERVICE).
 * Bypasses Payway completely and commits appointment and benefit code atomically.
 */
export async function confirmZeroDepositBooking(params: {
  barberName: string;
  serviceName: string;
  bookingDate: string;
  startTime: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  benefitCode: string;
  notes?: string;
}): Promise<{
  success: boolean;
  appointmentId: string;
  requestNumber: number;
  notificationClaimToken?: string;
  calculation: BenefitCalculation;
}> {
  const db = await createPaymentSupabaseClient();
  const { data, error } = await db.rpc('confirm_zero_deposit_appointment', {
    p_barber_name: params.barberName,
    p_service_name: params.serviceName,
    p_booking_date: params.bookingDate,
    p_start_time: params.startTime,
    p_client_name: params.clientName,
    p_client_phone: params.clientPhone,
    p_client_email: params.clientEmail,
    p_benefit_code: normalizeBenefitCode(params.benefitCode),
    p_notes: params.notes || null,
  });

  if (error || !data) {
    console.error('[Kani Benefit Codes] Zero-deposit confirmation error:', error);
    throw new Error(error?.message || 'No se pudo confirmar la reserva con beneficio.');
  }

  const res = data as any;
  const calculation = calculateBenefitAmounts(
    res.originalPriceArs,
    0,
    res.benefitType,
    params.benefitCode
  );

  // Dispatch notification asynchronously if claim token is present
  if (res.notificationClaimToken && res.appointmentId) {
    try {
      const { dispatchAppointmentNotification } = await import('./kani-notifications.functions');
      void dispatchAppointmentNotification({
        appointmentId: res.appointmentId,
        claimToken: res.notificationClaimToken,
      }).catch((dispatchErr) => {
        console.warn('[Kani Benefit Codes] Notification dispatch deferred to recovery:', dispatchErr);
      });
    } catch {
      // Recovery outbox persists in database
    }
  }

  return {
    success: true,
    appointmentId: res.appointmentId,
    requestNumber: Number(res.requestNumber),
    notificationClaimToken: res.notificationClaimToken,
    calculation,
  };
}

/**
 * Locks a benefit code temporarily to a Payway checkout attempt.
 */
export async function lockBenefitCodeToAttempt(code: string, attemptId: string, ttlSeconds = 600): Promise<boolean> {
  const db = await createPaymentSupabaseClient();
  const { data, error } = await db.rpc('lock_benefit_code_attempt', {
    p_code: normalizeBenefitCode(code),
    p_attempt_id: attemptId,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) {
    console.warn('[Kani Benefit Codes] Lock attempt warning:', error);
    return false;
  }
  return Boolean(data);
}

/**
 * Releases a benefit code after a failed or abandoned attempt.
 */
export async function releaseBenefitCodeAttempt(code: string, attemptId: string): Promise<boolean> {
  const db = await createPaymentSupabaseClient();
  const { data, error } = await db.rpc('release_benefit_code_attempt', {
    p_code: normalizeBenefitCode(code),
    p_attempt_id: attemptId,
  });
  if (error) {
    console.warn('[Kani Benefit Codes] Release attempt warning:', error);
    return false;
  }
  return Boolean(data);
}
