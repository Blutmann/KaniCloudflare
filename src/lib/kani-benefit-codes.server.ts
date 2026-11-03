import { createPaymentSupabaseClient } from './kani-payment-db.server';
import { createRequestSupabaseClient, getRequestAuthToken } from './kani-notifications.server';
import {
  type BenefitCalculation,
  type BenefitCodeItem,
  type BenefitCodeType,
  type BenefitCodeUsageItem,
  type BenefitDurationUnit,
  type BenefitQuote,
  type BenefitUsageMode,
  type BenefitValidityType,
  calculateBenefitAmounts,
  calculateValidityDates,
  generateBenefitCodeString,
  normalizeBenefitCode,
} from './kani-benefit-codes';
import { formatServiceName } from './kani-model';

const KANI_META_PREFIX = '[[KANI_META:';
const KANI_META_SUFFIX = ']]';

export interface BenefitCodeEmbeddedMeta {
  usageMode?: BenefitUsageMode;
  validityType?: BenefitValidityType;
  validFrom?: string | null;
  validUntil?: string | null;
  validityDurationValue?: number | null;
  validityDurationUnit?: BenefitDurationUnit | null;
  timesUsed?: number;
  deletedAt?: string | null;
  deletedByUserId?: string | null;
  deletedByDisplayName?: string | null;
  lastEditedAt?: string | null;
  lastEditedByUserId?: string | null;
  lastEditedByDisplayName?: string | null;
}

export function parseInternalNoteMetadata(rawNote: string | null | undefined): {
  cleanNote: string | null;
  meta: BenefitCodeEmbeddedMeta | null;
} {
  if (!rawNote || typeof rawNote !== 'string') {
    return { cleanNote: null, meta: null };
  }
  const idx = rawNote.lastIndexOf(KANI_META_PREFIX);
  if (idx === -1 || !rawNote.endsWith(KANI_META_SUFFIX)) {
    return { cleanNote: rawNote.trim() || null, meta: null };
  }
  const cleanPart = rawNote.slice(0, idx).trim();
  const jsonPart = rawNote.slice(idx + KANI_META_PREFIX.length, rawNote.length - KANI_META_SUFFIX.length);
  try {
    const parsed = JSON.parse(jsonPart) as BenefitCodeEmbeddedMeta;
    return {
      cleanNote: cleanPart || null,
      meta: parsed && typeof parsed === 'object' ? parsed : null,
    };
  } catch {
    return { cleanNote: rawNote.trim() || null, meta: null };
  }
}

export function encodeInternalNoteWithMetadata(
  cleanNote: string | null | undefined,
  meta: BenefitCodeEmbeddedMeta
): string {
  const base = (cleanNote ?? '').trim();
  const json = JSON.stringify(meta);
  return base ? `${base}\n${KANI_META_PREFIX}${json}${KANI_META_SUFFIX}` : `${KANI_META_PREFIX}${json}${KANI_META_SUFFIX}`;
}

export function normalizeBenefitCodeRow(
  raw: any,
  appointmentUsages?: BenefitCodeUsageItem[]
): BenefitCodeItem {
  const rawNote = raw?.internalNote ?? raw?.internal_note ?? null;
  const { cleanNote, meta } = parseInternalNoteMetadata(rawNote);
  const code = String(raw?.code || '');

  const usageMode: BenefitUsageMode =
    raw?.usageMode ||
    raw?.usage_mode ||
    meta?.usageMode ||
    'SINGLE_USE';

  const validityType: BenefitValidityType =
    raw?.validityType ||
    raw?.validity_type ||
    meta?.validityType ||
    'NO_EXPIRATION';

  const createdAt: string =
    raw?.createdAt ||
    raw?.created_at ||
    new Date().toISOString();

  const updatedAt: string =
    raw?.updatedAt ||
    raw?.updated_at ||
    createdAt;

  const validFrom: string =
    raw?.validFrom ||
    raw?.valid_from ||
    meta?.validFrom ||
    createdAt;

  const validUntil: string | null =
    raw?.validUntil ??
    raw?.valid_until ??
    meta?.validUntil ??
    null;

  const validityDurationValue: number | null =
    raw?.validityDurationValue ??
    raw?.validity_duration_value ??
    meta?.validityDurationValue ??
    null;

  const validityDurationUnit: BenefitDurationUnit | null =
    raw?.validityDurationUnit ??
    raw?.validity_duration_unit ??
    meta?.validityDurationUnit ??
    null;

  const deletedAt: string | null =
    raw?.deletedAt ??
    raw?.deleted_at ??
    meta?.deletedAt ??
    null;

  const deletedByUserId: string | null =
    raw?.deletedByUserId ??
    raw?.deleted_by_user_id ??
    meta?.deletedByUserId ??
    null;

  const deletedByDisplayName: string | null =
    raw?.deletedByDisplayName ??
    raw?.deleted_by_display_name ??
    meta?.deletedByDisplayName ??
    null;

  const consumedAt: string | null = raw?.consumedAt ?? raw?.consumed_at ?? null;
  const consumedAppointmentId: string | null = raw?.consumedAppointmentId ?? raw?.consumed_appointment_id ?? null;

  // Merge RPC usages and appointment usages deduplicated by appointmentId
  const rawUsages: BenefitCodeUsageItem[] = Array.isArray(raw?.usages) ? raw.usages : [];
  const mergedUsagesMap = new Map<string, BenefitCodeUsageItem>();
  for (const u of rawUsages) {
    if (u && u.appointmentId) {
      mergedUsagesMap.set(u.appointmentId, {
        ...u,
        serviceName: u.serviceName ? formatServiceName(u.serviceName) : u.serviceName,
      });
    }
  }
  if (Array.isArray(appointmentUsages)) {
    for (const u of appointmentUsages) {
      if (u && u.appointmentId && !mergedUsagesMap.has(u.appointmentId)) {
        mergedUsagesMap.set(u.appointmentId, u);
      }
    }
  }
  // If single consumption exists on the code row itself and isn't in usages yet, include it
  if (consumedAppointmentId && !mergedUsagesMap.has(consumedAppointmentId)) {
    mergedUsagesMap.set(consumedAppointmentId, {
      id: `usage-${consumedAppointmentId}`,
      appointmentId: consumedAppointmentId,
      requestNumber: raw?.appointmentRequestNumber ?? null,
      bookingDate: raw?.appointmentDate ?? null,
      bookingTime: raw?.appointmentTime ?? null,
      appointmentStatus: raw?.appointmentStatus ?? null,
      serviceName: raw?.appointmentService ? formatServiceName(raw.appointmentService) : null,
      barberName: raw?.appointmentBarber ?? null,
      clientId: raw?.consumedClientId ?? raw?.consumed_client_id ?? null,
      clientName: raw?.clientName ?? null,
      clientPhone: raw?.clientPhone ?? null,
      clientEmail: raw?.clientEmail ?? null,
      usedAt: consumedAt || updatedAt,
      originalPriceArs: raw?.originalPriceArs ?? raw?.original_price_ars ?? null,
      discountAmountArs: raw?.discountAmountArs ?? raw?.discount_amount_ars ?? null,
      finalPriceArs: raw?.finalPriceArs ?? raw?.final_price_ars ?? null,
      onlineDepositArs: raw?.onlineDepositArs ?? raw?.online_deposit_ars ?? null,
      inPersonBalanceArs: raw?.inPersonBalanceArs ?? raw?.in_person_balance_ars ?? null,
      isAppointmentCancelled: Boolean(raw?.isAppointmentCancelled || raw?.appointmentStatus === 'CANCELLED'),
    });
  }

  const usages = Array.from(mergedUsagesMap.values()).sort(
    (a, b) => new Date(b.usedAt || 0).getTime() - new Date(a.usedAt || 0).getTime()
  );

  const explicitTimesUsed = raw?.timesUsed ?? raw?.times_used ?? meta?.timesUsed;
  const timesUsed = Math.max(
    typeof explicitTimesUsed === 'number' ? explicitTimesUsed : 0,
    usages.length,
    consumedAt || consumedAppointmentId || raw?.status === 'CONSUMED' ? 1 : 0
  );

  // If a REUSABLE code was marked CONSUMED by a legacy RPC/trigger, its effective raw status is ACTIVE
  let effectiveRawStatus = raw?.status || 'ACTIVE';
  if (usageMode === 'REUSABLE' && effectiveRawStatus === 'CONSUMED') {
    effectiveRawStatus = 'ACTIVE';
  }
  if (deletedAt) {
    effectiveRawStatus = 'DELETED';
  }

  const latestUsage = usages[0];

  const normalized: any = {
    ...raw,
    id: raw?.id,
    code,
    type: raw?.type,
    usageMode,
    usage_mode: usageMode,
    validityType,
    validity_type: validityType,
    validFrom,
    valid_from: validFrom,
    validUntil,
    valid_until: validUntil,
    validityDurationValue,
    validity_duration_value: validityDurationValue,
    validityDurationUnit,
    validity_duration_unit: validityDurationUnit,
    timesUsed,
    times_used: timesUsed,
    internalNote: cleanNote,
    internal_note: cleanNote,
    status: effectiveRawStatus,
    rawStatus: raw?.status,
    createdByUserId: raw?.createdByUserId ?? raw?.created_by_user_id ?? null,
    createdByDisplayName: raw?.createdByDisplayName ?? raw?.created_by_display_name ?? 'Administrador',
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
    lastEditedAt: raw?.lastEditedAt ?? raw?.last_edited_at ?? meta?.lastEditedAt ?? null,
    lastEditedByUserId: raw?.lastEditedByUserId ?? raw?.last_edited_by_user_id ?? meta?.lastEditedByUserId ?? null,
    lastEditedByDisplayName: raw?.lastEditedByDisplayName ?? raw?.last_edited_by_display_name ?? meta?.lastEditedByDisplayName ?? null,
    deletedAt,
    deleted_at: deletedAt,
    deletedByUserId,
    deleted_by_user_id: deletedByUserId,
    deletedByDisplayName,
    deleted_by_display_name: deletedByDisplayName,
    consumedAt: consumedAt ?? latestUsage?.usedAt ?? null,
    consumed_at: consumedAt ?? latestUsage?.usedAt ?? null,
    consumedAppointmentId: consumedAppointmentId ?? latestUsage?.appointmentId ?? null,
    consumed_appointment_id: consumedAppointmentId ?? latestUsage?.appointmentId ?? null,
    consumedClientId: raw?.consumedClientId ?? raw?.consumed_client_id ?? latestUsage?.clientId ?? null,
    clientName: raw?.clientName ?? latestUsage?.clientName ?? null,
    clientPhone: raw?.clientPhone ?? latestUsage?.clientPhone ?? null,
    clientEmail: raw?.clientEmail ?? latestUsage?.clientEmail ?? null,
    appointmentRequestNumber: raw?.appointmentRequestNumber ?? latestUsage?.requestNumber ?? null,
    appointmentDate: raw?.appointmentDate ?? latestUsage?.bookingDate ?? null,
    appointmentTime: raw?.appointmentTime ?? latestUsage?.bookingTime ?? null,
    appointmentStatus: raw?.appointmentStatus ?? latestUsage?.appointmentStatus ?? null,
    appointmentService: raw?.appointmentService
      ? formatServiceName(raw.appointmentService)
      : latestUsage?.serviceName ?? null,
    appointmentBarber: raw?.appointmentBarber ?? latestUsage?.barberName ?? null,
    originalPriceArs: raw?.originalPriceArs ?? raw?.original_price_ars ?? latestUsage?.originalPriceArs ?? null,
    discountAmountArs: raw?.discountAmountArs ?? raw?.discount_amount_ars ?? latestUsage?.discountAmountArs ?? null,
    finalPriceArs: raw?.finalPriceArs ?? raw?.final_price_ars ?? latestUsage?.finalPriceArs ?? null,
    onlineDepositArs: raw?.onlineDepositArs ?? raw?.online_deposit_ars ?? latestUsage?.onlineDepositArs ?? null,
    inPersonBalanceArs: raw?.inPersonBalanceArs ?? raw?.in_person_balance_ars ?? latestUsage?.inPersonBalanceArs ?? null,
    isAppointmentCancelled: Boolean(
      raw?.isAppointmentCancelled ?? (raw?.appointmentStatus === 'CANCELLED' || latestUsage?.isAppointmentCancelled)
    ),
    usages,
  };

  return normalized as BenefitCodeItem;
}

function isSchemaCacheMissingError(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '');
  return (
    code === 'PGRST202' ||
    msg.includes('schema cache') ||
    msg.includes('Could not find the function')
  );
}

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
  if (res.error && isSchemaCacheMissingError(res.error) && includeDeleted !== undefined) {
    console.warn('[Kani Benefit Codes] Parameterized admin_list_benefit_codes not found in schema cache, retrying 0-arg signature:', res.error.message);
    res = await supabase.rpc('admin_list_benefit_codes');
  }

  if (res.error) {
    console.error('[Kani Benefit Codes] Error fetching admin list:', res.error);
    throw new Error(res.error.message || 'Error al consultar códigos de beneficio');
  }

  const rawList = (res.data as any[]) || [];

  // Enrich with 1:N appointment usages from public.appointments when service-role DB client is available
  const usagesByCode = new Map<string, BenefitCodeUsageItem[]>();
  try {
    const db = await createPaymentSupabaseClient();
    if (db && typeof db.from === 'function') {
      const { data: appts } = await db
        .from('appointments')
        .select('id, request_number, booking_date, start_time, status, created_at, benefit_code_id, benefit_code, benefit_original_price_ars, benefit_discount_amount_ars, benefit_final_price_ars, benefit_online_deposit_ars, benefit_in_person_balance_ars, client_id, clients(id, name, phone, email), services(name), barbers(name)')
        .not('benefit_code', 'is', null)
        .order('created_at', { ascending: false });

      if (Array.isArray(appts)) {
        for (const a of appts as any[]) {
          const codeKey = normalizeBenefitCode(a.benefit_code);
          if (!codeKey) continue;
          const clientObj = Array.isArray(a.clients) ? a.clients[0] : a.clients;
          const serviceObj = Array.isArray(a.services) ? a.services[0] : a.services;
          const barberObj = Array.isArray(a.barbers) ? a.barbers[0] : a.barbers;
          const usageItem: BenefitCodeUsageItem = {
            id: `appt-${a.id}`,
            appointmentId: a.id,
            requestNumber: a.request_number ?? null,
            bookingDate: a.booking_date ?? null,
            bookingTime: typeof a.start_time === 'string' ? a.start_time.slice(0, 5) : null,
            appointmentStatus: a.status ?? null,
            serviceName: serviceObj?.name ? formatServiceName(serviceObj.name) : null,
            barberName: barberObj?.name ?? null,
            clientId: a.client_id ?? clientObj?.id ?? null,
            clientName: clientObj?.name ?? null,
            clientPhone: clientObj?.phone ?? null,
            clientEmail: clientObj?.email ?? null,
            usedAt: a.created_at || new Date().toISOString(),
            originalPriceArs: a.benefit_original_price_ars ?? null,
            discountAmountArs: a.benefit_discount_amount_ars ?? null,
            finalPriceArs: a.benefit_final_price_ars ?? null,
            onlineDepositArs: a.benefit_online_deposit_ars ?? null,
            inPersonBalanceArs: a.benefit_in_person_balance_ars ?? null,
            isAppointmentCancelled: a.status === 'CANCELLED',
          };
          const list = usagesByCode.get(codeKey) || [];
          list.push(usageItem);
          usagesByCode.set(codeKey, list);
        }
      }

      // Auto-heal any REUSABLE code that a legacy trigger/RPC marked as CONSUMED
      for (const rawItem of rawList) {
        const normalizedItem = normalizeBenefitCodeRow(rawItem);
        if (normalizedItem.usageMode === 'REUSABLE' && rawItem.status === 'CONSUMED' && !normalizedItem.deletedAt) {
          await db
            .from('benefit_codes')
            .update({ status: 'ACTIVE', updated_at: new Date().toISOString() })
            .eq('id', rawItem.id);
          rawItem.status = 'ACTIVE';
        }
      }
    }
  } catch {
    // Best-effort enrichment; never fail listing if service client is unavailable in unit tests
  }

  const mapped = rawList.map(item =>
    normalizeBenefitCodeRow(item, usagesByCode.get(normalizeBenefitCode(item.code)))
  );

  if (includeDeleted === false) {
    return mapped.filter(item => !item.deletedAt);
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

  if (
    'usageMode' in params &&
    params.usageMode !== undefined &&
    params.usageMode !== 'SINGLE_USE' &&
    params.usageMode !== 'REUSABLE'
  ) {
    throw new Error('INVALID_USAGE_MODE: La modalidad debe ser SINGLE_USE o REUSABLE.');
  }

  const usageMode: BenefitUsageMode = params.usageMode || 'SINGLE_USE';
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

  const embeddedMeta: BenefitCodeEmbeddedMeta = {
    usageMode,
    validityType,
    validFrom: dates.validFromIso,
    validUntil: dates.validUntilIso,
    validityDurationValue: params.durationValue ?? null,
    validityDurationUnit: params.durationUnit ?? null,
    timesUsed: 0,
    deletedAt: null,
  };

  const noteWithMeta = encodeInternalNoteWithMetadata(params.internalNote || null, embeddedMeta);

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

  // Fallback: If PostgREST has the legacy 3-param signature in schema cache,
  // explicitly persist expansion metadata (usageMode + validity) inside internal_note
  // for BOTH SINGLE_USE and REUSABLE so the chosen modality is always saved in DB.
  if (res.error && isSchemaCacheMissingError(res.error)) {
    console.warn('[Kani Benefit Codes] 9-param admin_create_benefit_code not found, retrying 3-param legacy signature:', res.error.message);
    res = await supabase.rpc('admin_create_benefit_code', {
      p_type: params.type,
      p_internal_note: noteWithMeta,
      p_code: generatedCode,
    });
  }

  if (res.error) {
    console.error('[Kani Benefit Codes] Error creating code:', res.error);
    throw new Error(res.error.message || 'Error al generar código de beneficio');
  }

  let rawItem = (res.data as any) || {};
  const persistedMeta = parseInternalNoteMetadata(rawItem.internal_note ?? rawItem.internalNote).meta;
  const persistedUsageMode = rawItem.usage_mode || rawItem.usageMode || persistedMeta?.usageMode;

  if (rawItem.id && persistedUsageMode !== usageMode) {
    try {
      const db = await createPaymentSupabaseClient();
      if (db && typeof db.from === 'function') {
        const { data: updatedRow } = await db
          .from('benefit_codes')
          .update({ internal_note: noteWithMeta })
          .eq('id', rawItem.id)
          .select('*')
          .maybeSingle();
        if (updatedRow) {
          rawItem = updatedRow;
        }
      }
    } catch {
      // ignore if service client is mocked in unit tests
    }
  }

  return normalizeBenefitCodeRow({
    ...rawItem,
    code: rawItem.code || generatedCode,
    type: rawItem.type || params.type,
    internal_note: rawItem.internal_note ?? noteWithMeta,
    status: rawItem.status || 'ACTIVE',
    usage_mode: rawItem.usage_mode || usageMode,
    validity_type: rawItem.validity_type || validityType,
    valid_from: rawItem.valid_from || dates.validFromIso,
    valid_until: rawItem.valid_until ?? dates.validUntilIso,
    validity_duration_value: rawItem.validity_duration_value ?? params.durationValue ?? null,
    validity_duration_unit: rawItem.validity_duration_unit ?? params.durationUnit ?? null,
    times_used: rawItem.times_used ?? 0,
    deleted_at: rawItem.deleted_at || null,
    usages: rawItem.usages || [],
  });
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
  const admin = await assertAdminSession(params.token);
  const { supabase } = admin;

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

  if (!error && data) {
    return normalizeBenefitCodeRow(data);
  }

  if (error && isSchemaCacheMissingError(error)) {
    const db = await createPaymentSupabaseClient();
    const { data: row, error: fetchErr } = await db
      .from('benefit_codes')
      .select('*')
      .eq('id', params.codeId)
      .maybeSingle();

    if (fetchErr || !row) {
      throw new Error('BENEFIT_CODE_NOT_FOUND: El código de beneficio no existe.');
    }

    const existing = normalizeBenefitCodeRow(row);
    if (existing.deletedAt) {
      throw new Error('CANNOT_EDIT_DELETED_CODE: No se puede modificar un código eliminado.');
    }
    if (existing.usageMode === 'SINGLE_USE' && (row.status === 'CONSUMED' || row.consumed_at || row.consumed_appointment_id)) {
      throw new Error('CANNOT_EDIT_CONSUMED_SINGLE_USE_CODE: No se puede modificar la vigencia de un código de un solo uso ya consumido.');
    }

    const nowIso = new Date().toISOString();
    const nextMeta: BenefitCodeEmbeddedMeta = {
      usageMode: existing.usageMode,
      validityType: params.validityType,
      validFrom: dates.validFromIso,
      validUntil: dates.validUntilIso,
      validityDurationValue: params.durationValue ?? null,
      validityDurationUnit: params.durationUnit ?? null,
      timesUsed: existing.timesUsed,
      deletedAt: null,
      lastEditedAt: nowIso,
      lastEditedByUserId: admin.userId,
      lastEditedByDisplayName: admin.profile.display_name || 'Administrador',
    };

    const nextInternalNote = encodeInternalNoteWithMetadata(existing.internalNote, nextMeta);
    const nextStatus = existing.usageMode === 'REUSABLE' && row.status === 'CONSUMED' ? 'ACTIVE' : row.status;

    const { data: updatedRow, error: updateErr } = await db
      .from('benefit_codes')
      .update({
        internal_note: nextInternalNote,
        status: nextStatus,
        updated_at: nowIso,
      })
      .eq('id', params.codeId)
      .select('*')
      .single();

    if (updateErr || !updatedRow) {
      throw new Error(updateErr?.message || 'Error al actualizar vigencia del código');
    }

    return normalizeBenefitCodeRow(updatedRow);
  }

  console.error('[Kani Benefit Codes] Error updating code validity:', error);
  throw new Error(error?.message || 'Error al actualizar vigencia del código');
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
  const admin = await assertAdminSession(params.token);
  const { supabase } = admin;
  let res = await supabase.rpc('admin_toggle_benefit_code_status', {
    p_code_id: params.codeId,
    p_active: params.active,
  });

  if (!res.error) {
    return Boolean(res.data);
  }

  // Fallback when admin_toggle_benefit_code_status is not in the PostgREST schema cache
  if (isSchemaCacheMissingError(res.error)) {
    if (!params.active) {
      console.warn('[Kani Benefit Codes] admin_toggle_benefit_code_status not found, retrying admin_disable_benefit_code');
      const disableRes = await supabase.rpc('admin_disable_benefit_code', {
        p_code_id: params.codeId,
      });
      if (!disableRes.error) {
        return Boolean(disableRes.data);
      }
      if (!isSchemaCacheMissingError(disableRes.error) && !String(disableRes.error?.message || '').includes('CANNOT_DISABLE_NON_ACTIVE_CODE')) {
        throw new Error(disableRes.error.message || 'Error al cambiar estado del código');
      }
    }

    const db = await createPaymentSupabaseClient();
    const { data: row, error: fetchErr } = await db
      .from('benefit_codes')
      .select('*')
      .eq('id', params.codeId)
      .maybeSingle();

    if (fetchErr || !row) {
      throw new Error('BENEFIT_CODE_NOT_FOUND: El código de beneficio no existe.');
    }

    const existing = normalizeBenefitCodeRow(row);
    if (existing.deletedAt) {
      throw new Error('BENEFIT_CODE_NOT_FOUND: El código fue eliminado.');
    }

    const isConsumedSingleUse =
      existing.usageMode === 'SINGLE_USE' &&
      (row.status === 'CONSUMED' || Boolean(row.consumed_at) || Boolean(row.consumed_appointment_id));

    if (params.active) {
      if (isConsumedSingleUse) {
        throw new Error('CANNOT_ACTIVATE_CONSUMED_SINGLE_USE: No se puede reactivar un código de un solo uso que ya fue consumido.');
      }
      if (existing.validUntil && new Date(existing.validUntil).getTime() < Date.now()) {
        throw new Error('CODE_EXPIRED_UPDATE_VALIDITY_FIRST: El código está vencido. Actualizá su vigencia antes de activarlo.');
      }
    } else {
      if (isConsumedSingleUse) {
        throw new Error('CANNOT_DISABLE_CONSUMED_SINGLE_USE: No se puede desactivar un código de un solo uso que ya fue consumido.');
      }
    }

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await db
      .from('benefit_codes')
      .update({
        status: params.active ? 'ACTIVE' : 'DISABLED',
        locked_at: null,
        locked_expires_at: null,
        locked_attempt_id: null,
        updated_at: nowIso,
      })
      .eq('id', params.codeId);

    if (updateErr) {
      console.error('[Kani Benefit Codes] Error updating code status via fallback:', updateErr);
      throw new Error(updateErr.message || 'Error al cambiar estado del código');
    }

    return true;
  }

  console.error('[Kani Benefit Codes] Error toggling code status:', res.error);
  throw new Error(res.error.message || 'Error al cambiar estado del código');
}

/**
 * Disables an active benefit code from admin panel (calls admin_disable_benefit_code RPC).
 */
export async function adminDisableBenefitCode(codeId: string, authToken?: string): Promise<boolean> {
  const { supabase } = await assertAdminSession(authToken);
  const { data, error } = await supabase.rpc('admin_disable_benefit_code', {
    p_code_id: codeId,
  });

  if (!error) {
    return Boolean(data);
  }

  if (isSchemaCacheMissingError(error) || String(error.message || '').includes('CANNOT_DISABLE_NON_ACTIVE_CODE')) {
    return adminToggleBenefitCodeStatus({ codeId, active: false, token: authToken });
  }

  console.error('[Kani Benefit Codes] Error disabling code:', error);
  throw new Error(error.message || 'Error al desactivar el código');
}

/**
 * Soft deletes a benefit code with audit registration.
 * Preserves all associations, clients and historical bookings.
 * Does not allow reusing the code text.
 */
export async function adminDeleteBenefitCode(codeId: string, authToken?: string): Promise<boolean> {
  const admin = await assertAdminSession(authToken);
  const { supabase } = admin;
  const { data, error } = await supabase.rpc('admin_delete_benefit_code', {
    p_code_id: codeId,
  });

  if (!error) {
    return Boolean(data);
  }

  if (isSchemaCacheMissingError(error)) {
    const db = await createPaymentSupabaseClient();
    const { data: row, error: fetchErr } = await db
      .from('benefit_codes')
      .select('*')
      .eq('id', codeId)
      .maybeSingle();

    if (fetchErr || !row) {
      throw new Error('BENEFIT_CODE_NOT_FOUND: El código de beneficio no existe.');
    }

    const existing = normalizeBenefitCodeRow(row);
    if (existing.deletedAt) {
      return true;
    }

    const nowIso = new Date().toISOString();
    const nextMeta: BenefitCodeEmbeddedMeta = {
      usageMode: existing.usageMode,
      validityType: existing.validityType,
      validFrom: existing.validFrom,
      validUntil: existing.validUntil ?? null,
      validityDurationValue: existing.validityDurationValue ?? null,
      validityDurationUnit: existing.validityDurationUnit ?? null,
      timesUsed: existing.timesUsed,
      deletedAt: nowIso,
      deletedByUserId: admin.userId,
      deletedByDisplayName: admin.profile.display_name || 'Administrador',
      lastEditedAt: nowIso,
      lastEditedByUserId: admin.userId,
      lastEditedByDisplayName: admin.profile.display_name || 'Administrador',
    };

    const nextInternalNote = encodeInternalNoteWithMetadata(existing.internalNote, nextMeta);
    const keepConsumedStatus =
      existing.usageMode === 'SINGLE_USE' &&
      (row.status === 'CONSUMED' || Boolean(row.consumed_at) || Boolean(row.consumed_appointment_id));

    const { error: updateErr } = await db
      .from('benefit_codes')
      .update({
        status: keepConsumedStatus ? 'CONSUMED' : 'DISABLED',
        internal_note: nextInternalNote,
        locked_at: null,
        locked_expires_at: null,
        locked_attempt_id: null,
        updated_at: nowIso,
      })
      .eq('id', codeId);

    if (updateErr) {
      console.error('[Kani Benefit Codes] Error deleting code via fallback:', updateErr);
      throw new Error(updateErr.message || 'Error al eliminar el código');
    }

    return true;
  }

  console.error('[Kani Benefit Codes] Error deleting code:', error);
  throw new Error(error.message || 'Error al eliminar el código');
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
  let resolvedUsageMode: BenefitUsageMode | undefined;

  // Check metadata (soft-delete, validity window, and reusable status healing) when table access is available
  try {
    if (db && typeof db.from === 'function') {
      const { data: row } = await db
        .from('benefit_codes')
        .select('*')
        .eq('code', normalized)
        .maybeSingle();

      if (row) {
        const parsed = normalizeBenefitCodeRow(row);
        resolvedUsageMode = parsed.usageMode;

        if (parsed.deletedAt) {
          const msg = 'Este código ya no está disponible.';
          return { valid: false, message: msg, error: msg };
        }
        if (parsed.validFrom && new Date(parsed.validFrom).getTime() > Date.now()) {
          const msg = 'Este código aún no se encuentra vigente.';
          return { valid: false, message: msg, error: msg };
        }
        if (parsed.validUntil && new Date(parsed.validUntil).getTime() < Date.now()) {
          const msg = 'Este código se encuentra vencido.';
          return { valid: false, message: msg, error: msg };
        }
        if (parsed.usageMode === 'REUSABLE' && (row.status === 'CONSUMED' || row.status === 'LOCKED')) {
          await db
            .from('benefit_codes')
            .update({
              status: 'ACTIVE',
              locked_at: null,
              locked_expires_at: null,
              locked_attempt_id: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
        }
      }
    }
  } catch {
    // Proceed to RPC validation
  }

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
    usageMode: res.usageMode || resolvedUsageMode,
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
  skipExternalSideEffects?: boolean;
}): Promise<{
  success: boolean;
  appointmentId: string;
  requestNumber: number;
  notificationClaimToken?: string;
  calculation: BenefitCalculation;
  usageMode?: BenefitUsageMode;
}> {
  const db = await createPaymentSupabaseClient();
  const normalizedCode = normalizeBenefitCode(params.benefitCode);
  let codeRow: any = null;
  let parsedCode: BenefitCodeItem | null = null;

  try {
    if (db && typeof db.from === 'function') {
      const { data: fetched } = await db
        .from('benefit_codes')
        .select('*')
        .eq('code', normalizedCode)
        .maybeSingle();

      if (fetched) {
        codeRow = fetched;
        parsedCode = normalizeBenefitCodeRow(fetched);
        if (parsedCode.deletedAt) {
          throw new Error('BENEFIT_CODE_DISABLED: Este código de beneficio ya no está disponible.');
        }
        if (parsedCode.validFrom && new Date(parsedCode.validFrom).getTime() > Date.now()) {
          throw new Error('BENEFIT_CODE_DISABLED: Este código aún no se encuentra vigente.');
        }
        if (parsedCode.validUntil && new Date(parsedCode.validUntil).getTime() < Date.now()) {
          throw new Error('BENEFIT_CODE_DISABLED: Este código se encuentra vencido.');
        }
        if (parsedCode.usageMode === 'REUSABLE' && fetched.status === 'CONSUMED') {
          await db
            .from('benefit_codes')
            .update({ status: 'ACTIVE', updated_at: new Date().toISOString() })
            .eq('id', fetched.id);
        }
      }
    }
  } catch (preErr: any) {
    if (String(preErr?.message || '').startsWith('BENEFIT_CODE_')) {
      throw preErr;
    }
  }

  const callConfirmRpc = async (serviceNameArg: string) =>
    db.rpc('confirm_zero_deposit_appointment', {
      p_barber_name: params.barberName,
      p_service_name: serviceNameArg,
      p_booking_date: params.bookingDate,
      p_start_time: params.startTime,
      p_client_name: params.clientName,
      p_client_phone: params.clientPhone,
      p_client_email: params.clientEmail,
      p_benefit_code: normalizedCode,
      p_notes: params.notes || null,
    });

  let { data, error } = await callConfirmRpc(params.serviceName);
  if (
    error &&
    String(error.message || '').includes('BARBER_OR_SERVICE_NOT_FOUND') &&
    ['Corte', 'Corte de cabello', 'Corte y barba', 'Corte + barba'].includes(params.serviceName)
  ) {
    const altServiceName =
      params.serviceName === 'Corte'
        ? 'Corte de cabello'
        : params.serviceName === 'Corte de cabello'
          ? 'Corte'
          : params.serviceName === 'Corte y barba'
            ? 'Corte + barba'
            : 'Corte y barba';
    const retry = await callConfirmRpc(altServiceName);
    data = retry.data;
    error = retry.error;
  }

  if (error || !data) {
    console.error('[Kani Benefit Codes] Zero-deposit confirmation error:', error);
    throw new Error(error?.message || 'No se pudo confirmar la reserva con beneficio.');
  }

  const res = data as any;

  // If the code is REUSABLE and the legacy RPC marked it CONSUMED, immediately restore ACTIVE status
  if (parsedCode?.usageMode === 'REUSABLE' && codeRow?.id && db && typeof db.from === 'function') {
    try {
      const { meta } = parseInternalNoteMetadata(codeRow.internal_note);
      const nextTimesUsed = (parsedCode.timesUsed || 0) + 1;
      const updatePayload: Record<string, any> = {
        status: 'ACTIVE',
        locked_at: null,
        locked_expires_at: null,
        locked_attempt_id: null,
        updated_at: new Date().toISOString(),
        internal_note: encodeInternalNoteWithMetadata(parsedCode.internalNote, {
          ...(meta || {}),
          usageMode: 'REUSABLE',
          validityType: parsedCode.validityType,
          validFrom: parsedCode.validFrom,
          validUntil: parsedCode.validUntil ?? null,
          validityDurationValue: parsedCode.validityDurationValue ?? null,
          validityDurationUnit: parsedCode.validityDurationUnit ?? null,
          timesUsed: nextTimesUsed,
        }),
      };
      await db.from('benefit_codes').update(updatePayload).eq('id', codeRow.id);
    } catch (healErr) {
      console.warn('[Kani Benefit Codes] Reusable post-confirm heal warning:', healErr);
    }
  }

  const calculation = calculateBenefitAmounts(
    res.originalPriceArs,
    0,
    res.benefitType,
    params.benefitCode
  );

  if (!params.skipExternalSideEffects) {
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
  }

  return {
    success: true,
    appointmentId: res.appointmentId,
    requestNumber: Number(res.requestNumber),
    notificationClaimToken: res.notificationClaimToken,
    calculation,
    usageMode: res.usageMode || parsedCode?.usageMode,
  };
}

/**
 * Prepares/validates a benefit code for a Payway checkout attempt.
 * - SINGLE_USE codes are locked to the attemptId.
 * - REUSABLE codes are validated without locking them globally for other clients.
 */
export async function prepareBenefitCodeForPaywayAttempt(
  db: any,
  code: string,
  attemptId: string,
  ttlSeconds = 600
): Promise<{ codeId?: string; code: string; usageMode: BenefitUsageMode }> {
  const normalized = normalizeBenefitCode(code);
  let usageMode: BenefitUsageMode = 'SINGLE_USE';
  let codeId: string | undefined;

  if (db && typeof db.from === 'function') {
    try {
      const { data: row } = await db
        .from('benefit_codes')
        .select('*')
        .eq('code', normalized)
        .maybeSingle();

      if (row) {
        codeId = row.id;
        const parsed = normalizeBenefitCodeRow(row);
        usageMode = parsed.usageMode;

        if (parsed.deletedAt || row.status === 'DISABLED') {
          throw new Error('BENEFIT_CODE_LOCKED_OR_INVALID');
        }
        if (parsed.validFrom && new Date(parsed.validFrom).getTime() > Date.now()) {
          throw new Error('BENEFIT_CODE_LOCKED_OR_INVALID');
        }
        if (parsed.validUntil && new Date(parsed.validUntil).getTime() < Date.now()) {
          throw new Error('BENEFIT_CODE_LOCKED_OR_INVALID');
        }

        if (usageMode === 'REUSABLE') {
          // Ensure reusable code is ACTIVE and not globally locked
          if (row.status !== 'ACTIVE') {
            await db
              .from('benefit_codes')
              .update({
                status: 'ACTIVE',
                locked_at: null,
                locked_expires_at: null,
                locked_attempt_id: null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', row.id);
          }
          return { codeId, code: normalized, usageMode: 'REUSABLE' };
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'BENEFIT_CODE_LOCKED_OR_INVALID') throw e;
    }
  }

  const { data: locked, error: lockErr } = await db.rpc('lock_benefit_code_attempt', {
    p_code: normalized,
    p_attempt_id: attemptId,
    p_ttl_seconds: ttlSeconds,
  });
  if (lockErr || !locked) {
    throw new Error('BENEFIT_CODE_LOCKED_OR_INVALID');
  }
  return { codeId, code: normalized, usageMode };
}

/**
 * Consumes or records usage of a benefit code upon Payway payment confirmation.
 * Ensures the appointment snapshot is written before confirmation emails are sent,
 * and keeps REUSABLE codes in ACTIVE status.
 */
export async function consumeBenefitCodeForPaywayAttempt(
  db: any,
  appointmentId: string,
  attemptId: string
): Promise<void> {
  try {
    await db.rpc('admin_consume_benefit_code_for_attempt', {
      p_appointment_id: appointmentId,
      p_attempt_id: attemptId,
    });
  } catch {
    // Fallback below handles live DB column mismatch or reusable codes
  }

  if (!db || typeof db.from !== 'function') return;

  try {
    const { data: appt } = await db
      .from('appointments')
      .select('id, client_id, service_price_ars, deposit_amount_ars, benefit_code_id, benefit_code, benefit_type')
      .eq('id', appointmentId)
      .maybeSingle();

    if (!appt) return;

    let codeRow: any = null;
    if (appt.benefit_code_id) {
      const { data } = await db.from('benefit_codes').select('*').eq('id', appt.benefit_code_id).maybeSingle();
      codeRow = data;
    } else if (appt.benefit_code) {
      const { data } = await db.from('benefit_codes').select('*').eq('code', appt.benefit_code).maybeSingle();
      codeRow = data;
    } else {
      const cleanAttempt = attemptId.replaceAll('-', '');
      const { data: lockedRows } = await db
        .from('benefit_codes')
        .select('*')
        .not('locked_attempt_id', 'is', null);
      if (Array.isArray(lockedRows)) {
        codeRow = lockedRows.find(
          (r: any) =>
            r.locked_attempt_id === attemptId ||
            String(r.locked_attempt_id || '').replaceAll('-', '') === cleanAttempt
        );
      }
    }

    if (!codeRow) return;

    const parsedCode = normalizeBenefitCodeRow(codeRow);
    const servicePrice = Number(appt.service_price_ars ?? 25000);
    const depositAmount = Number(appt.deposit_amount_ars ?? 5000);
    const calc = calculateBenefitAmounts(servicePrice, depositAmount, codeRow.type, codeRow.code);

    await db
      .from('appointments')
      .update({
        benefit_code_id: codeRow.id,
        benefit_code: codeRow.code,
        benefit_type: codeRow.type,
        benefit_original_price_ars: calc.originalPriceArs,
        benefit_discount_amount_ars: calc.discountAmountArs,
        benefit_final_price_ars: calc.finalPriceArs,
        benefit_online_deposit_ars: calc.onlineDepositArs,
        benefit_in_person_balance_ars: calc.inPersonBalanceArs,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId);

    const nowIso = new Date().toISOString();
    const isReusable = parsedCode.usageMode === 'REUSABLE';
    const { meta } = parseInternalNoteMetadata(codeRow.internal_note);
    const nextTimesUsed = (parsedCode.timesUsed || 0) + 1;

    const codeUpdate: Record<string, any> = {
      status: isReusable ? 'ACTIVE' : 'CONSUMED',
      consumed_at: nowIso,
      consumed_appointment_id: appointmentId,
      consumed_client_id: appt.client_id ?? null,
      original_price_ars: calc.originalPriceArs,
      discount_amount_ars: calc.discountAmountArs,
      final_price_ars: calc.finalPriceArs,
      online_deposit_ars: calc.onlineDepositArs,
      in_person_balance_ars: calc.inPersonBalanceArs,
      locked_at: null,
      locked_expires_at: null,
      locked_attempt_id: null,
      updated_at: nowIso,
    };

    if (meta) {
      codeUpdate.internal_note = encodeInternalNoteWithMetadata(parsedCode.internalNote, {
        ...meta,
        timesUsed: nextTimesUsed,
      });
    }

    await db.from('benefit_codes').update(codeUpdate).eq('id', codeRow.id);
  } catch (err) {
    console.warn('[Kani Benefit Codes] Fallback consume warning:', err);
  }
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
