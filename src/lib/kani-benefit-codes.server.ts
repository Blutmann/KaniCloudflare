import { createPaymentSupabaseClient } from './kani-payment-db.server';
import { createRequestSupabaseClient, getRequestAuthToken } from './kani-notifications.server';
import {
  type BenefitCalculation,
  type BenefitCodeItem,
  type BenefitCodeType,
  type BenefitDurationUnit,
  type BenefitQuote,
  type BenefitUsageMode,
  type BenefitValidityType,
  calculateBenefitAmounts,
  calculateValidityDates,
  generateBenefitCodeString,
  normalizeBenefitCode,
} from './kani-benefit-codes';

/**
 * Validates that the request or provided token belongs to an active ADMIN staff member.
 * Throws an explicit error if unauthorized or unauthenticated.
 */
export async function assertAdminSession(explicitToken?: string): Promise<{
  userId: string;
  token: string;
  profile: { role: string; display_name: string | null; active: boolean };
  supabase: any;
}> {
  let token = explicitToken?.trim();
  if (!token) {
    try {
      token = getRequestAuthToken();
    } catch {
      // ignore
    }
  }

  if (!token) {
    throw new Error('AUTH_REQUIRED: Debe iniciar sesión como administrador para gestionar códigos de beneficio.');
  }

  const supabase = await createRequestSupabaseClient(token);
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    const isExpired = userError?.message?.toLowerCase().includes('expired') || (userError as any)?.status === 401;
    throw new Error(
      isExpired
        ? 'SESSION_EXPIRED: Su sesión ha expirado. Por favor, vuelva a iniciar sesión.'
        : 'SESSION_INVALID: Sesión inválida o expirada. Por favor, vuelva a iniciar sesión.'
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from('staff_profiles')
    .select('role, display_name, active')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.active || profile.role !== 'ADMIN') {
    throw new Error('UNAUTHORIZED_ADMIN_ONLY: Acceso denegado. Se requieren permisos de administrador.');
  }

  return {
    userId: user.id,
    token,
    profile: profile as { role: string; display_name: string | null; active: boolean },
    supabase,
  };
}

/**
 * Lists benefit codes for admin maintenance view.
 * Requires ADMIN role checked via Supabase session.
 * Preserves exact RPC signature when called without optional parameters,
 * and falls back seamlessly if the schema cache has not yet reloaded the parameterized signature.
 */
export async function adminListBenefitCodes(authToken?: string, includeDeleted?: boolean): Promise<BenefitCodeItem[]> {
  const { supabase } = await assertAdminSession(authToken);
  let res = includeDeleted !== undefined
    ? await supabase.rpc('admin_list_benefit_codes', { p_include_deleted: includeDeleted })
    : await supabase.rpc('admin_list_benefit_codes');

  // Fallback: If PostgREST reports PGRST202 (parameterized signature not found in schema cache),
  // retry calling the legacy zero-argument function admin_list_benefit_codes()
  if (res.error && (res.error.code === 'PGRST202' || (res.error.message && res.error.message.includes('schema cache'))) && includeDeleted !== undefined) {
    console.warn('[Kani Benefit Codes] Parameterized admin_list_benefit_codes not found in schema cache, retrying 0-arg signature:', res.error.message);
    res = await supabase.rpc('admin_list_benefit_codes');
  }

  if (res.error) {
    console.error('[Kani Benefit Codes] Error fetching admin list:', res.error);
    throw new Error(res.error.message || 'Error al consultar códigos de beneficio');
  }

  const rawList = (res.data as any[]) || [];
  const mapped = rawList.map(item => ({
    ...item,
    usage_mode: item.usage_mode || 'SINGLE_USE',
    validity_type: item.validity_type || 'NO_EXPIRATION',
    times_used: item.times_used ?? (item.status === 'CONSUMED' ? 1 : 0),
    deleted_at: item.deleted_at || null,
    usages: item.usages || [],
  })) as BenefitCodeItem[];

  if (includeDeleted === false) {
    return mapped.filter(item => !item.deleted_at);
  }

  return mapped;
}

/**
 * Creates a new benefit code from the admin maintenance panel.
 * Supports usage mode (SINGLE_USE / REUSABLE) and the 5 validity options.
 */
export async function adminCreateBenefitCode(params: {
  type: BenefitCodeType;
  internalNote?: string;
  code?: string;
  usageMode?: BenefitUsageMode;
  validityType?: BenefitValidityType;
  startDate?: string;
  endDate?: string;
  durationValue?: number;
  durationUnit?: BenefitDurationUnit;
  token?: string;
}): Promise<BenefitCodeItem> {
  const { supabase } = await assertAdminSession(params.token);
  const generatedCode = params.code ? normalizeBenefitCode(params.code) : generateBenefitCodeString();

  const usageMode = params.usageMode || 'SINGLE_USE';
  const validityType = params.validityType || 'NO_EXPIRATION';

  const dates = calculateValidityDates({
    validityType,
    startDate: params.startDate,
    endDate: params.endDate,
    durationValue: params.durationValue,
    durationUnit: params.durationUnit,
  });

  if (!dates.isValid && dates.error) {
    throw new Error(`VALIDITY_ERROR: ${dates.error}`);
  }

  let res = await supabase.rpc('admin_create_benefit_code', {
    p_type: params.type,
    p_internal_note: params.internalNote || null,
    p_code: generatedCode,
    p_usage_mode: usageMode,
    p_validity_type: validityType,
    p_valid_from: dates.validFromIso,
    p_valid_until: dates.validUntilIso,
    p_duration_value: params.durationValue || null,
    p_duration_unit: params.durationUnit || null,
  });

  // Fallback: If PostgREST has the legacy 3-param signature in schema cache
  if (res.error && (res.error.code === 'PGRST202' || (res.error.message && res.error.message.includes('schema cache')))) {
    console.warn('[Kani Benefit Codes] 9-param admin_create_benefit_code not found, retrying 3-param legacy signature:', res.error.message);
    res = await supabase.rpc('admin_create_benefit_code', {
      p_type: params.type,
      p_internal_note: params.internalNote || null,
      p_code: generatedCode,
    });
  }

  if (res.error) {
    console.error('[Kani Benefit Codes] Error creating code:', res.error);
    throw new Error(res.error.message || 'Error al generar código de beneficio');
  }

  const rawItem = (res.data as any) || {};
  return {
    ...rawItem,
    code: rawItem.code || generatedCode,
    type: rawItem.type || params.type,
    internal_note: rawItem.internal_note ?? params.internalNote ?? null,
    status: rawItem.status || 'ACTIVE',
    usage_mode: rawItem.usage_mode || usageMode,
    validity_type: rawItem.validity_type || validityType,
    valid_from: rawItem.valid_from || dates.validFromIso,
    valid_until: rawItem.valid_until || dates.validUntilIso,
    validity_duration_value: rawItem.validity_duration_value ?? params.durationValue ?? null,
    validity_duration_unit: rawItem.validity_duration_unit ?? params.durationUnit ?? null,
    times_used: rawItem.times_used ?? 0,
    deleted_at: rawItem.deleted_at || null,
    usages: rawItem.usages || [],
  } as BenefitCodeItem;
}

/**
 * Updates validity of an active/reusable benefit code.
 */
export async function adminUpdateBenefitCodeValidity(params: {
  codeId: string;
  validityType: BenefitValidityType;
  startDate?: string;
  endDate?: string;
  durationValue?: number;
  durationUnit?: BenefitDurationUnit;
  token?: string;
}): Promise<BenefitCodeItem> {
  const { supabase } = await assertAdminSession(params.token);

  const dates = calculateValidityDates({
    validityType: params.validityType,
    startDate: params.startDate,
    endDate: params.endDate,
    durationValue: params.durationValue,
    durationUnit: params.durationUnit,
  });

  if (!dates.isValid && dates.error) {
    throw new Error(`VALIDITY_ERROR: ${dates.error}`);
  }

  const { data, error } = await supabase.rpc('admin_update_benefit_code_validity', {
    p_code_id: params.codeId,
    p_validity_type: params.validityType,
    p_valid_from: dates.validFromIso,
    p_valid_until: dates.validUntilIso,
    p_duration_value: params.durationValue || null,
    p_duration_unit: params.durationUnit || null,
  });

  if (error) {
    console.error('[Kani Benefit Codes] Error updating code validity:', error);
    throw new Error(error.message || 'Error al actualizar vigencia del código');
  }

  return data as BenefitCodeItem;
}

/**
 * Toggles status (Active / Disabled) with business validation:
 * - If code is expired, prevents activation and prompts to update validity first.
 * - Single-use consumed codes cannot be reactivated.
 */
export async function adminToggleBenefitCodeStatus(params: {
  codeId: string;
  active: boolean;
  token?: string;
}): Promise<boolean> {
  const { supabase } = await assertAdminSession(params.token);
  let res = await supabase.rpc('admin_toggle_benefit_code_status', {
    p_code_id: params.codeId,
    p_active: params.active,
  });

  // Fallback: If admin_toggle_benefit_code_status is not yet in schema cache and intent is disabling
  if (res.error && (res.error.code === 'PGRST202' || (res.error.message && res.error.message.includes('schema cache'))) && !params.active) {
    console.warn('[Kani Benefit Codes] admin_toggle_benefit_code_status not found, retrying admin_disable_benefit_code');
    res = await supabase.rpc('admin_disable_benefit_code', {
      p_code_id: params.codeId,
    });
  }

  if (res.error) {
    console.error('[Kani Benefit Codes] Error toggling code status:', res.error);
    throw new Error(res.error.message || 'Error al cambiar estado del código');
  }

  return Boolean(res.data);
}

/**
 * Disables an active benefit code from admin panel (calls admin_disable_benefit_code RPC).
 */
export async function adminDisableBenefitCode(codeId: string, authToken?: string): Promise<boolean> {
  const { supabase } = await assertAdminSession(authToken);
  const { data, error } = await supabase.rpc('admin_disable_benefit_code', {
    p_code_id: codeId,
  });

  if (error) {
    console.error('[Kani Benefit Codes] Error disabling code:', error);
    throw new Error(error.message || 'Error al desactivar el código');
  }

  return Boolean(data);
}

/**
 * Soft deletes a benefit code with audit registration.
 * Preserves all associations, clients and historical bookings.
 * Does not allow reusing the code text.
 */
export async function adminDeleteBenefitCode(codeId: string, authToken?: string): Promise<boolean> {
  const { supabase } = await assertAdminSession(authToken);
  const { data, error } = await supabase.rpc('admin_delete_benefit_code', {
    p_code_id: codeId,
  });

  if (error) {
    console.error('[Kani Benefit Codes] Error deleting code:', error);
    throw new Error(error.message || 'Error al eliminar el código');
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
    usageMode: res.usageMode,
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
  usageMode?: BenefitUsageMode;
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

  // Dispatch notification and calendar sync before completing response to guarantee execution in serverless/workers
  if (res.notificationClaimToken && res.appointmentId) {
    try {
      const { dispatchAppointmentNotification } = await import('./kani-notifications.functions');
      await dispatchAppointmentNotification({
        appointmentId: res.appointmentId,
        claimToken: res.notificationClaimToken,
        clientPhone: params.clientPhone,
      });
    } catch (dispatchErr) {
      console.warn('[Kani Benefit Codes] Notification dispatch deferred to recovery:', dispatchErr);
    }
  }

  // Trigger Google Calendar sync queue immediately for this confirmation
  try {
    const { processCalendarSyncQueue } = await import('./kani-google-calendar-sync');
    await processCalendarSyncQueue({ limit: 5 });
  } catch (calErr) {
    console.warn('[Kani Benefit Codes] Calendar sync trigger error:', calErr);
  }

  return {
    success: true,
    appointmentId: res.appointmentId,
    requestNumber: Number(res.requestNumber),
    notificationClaimToken: res.notificationClaimToken,
    calculation,
    usageMode: res.usageMode,
  };
}

/**
 * Locks a benefit code temporarily to a Payway checkout attempt.
 * For REUSABLE codes, records attempt lock without blocking the code for others.
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
