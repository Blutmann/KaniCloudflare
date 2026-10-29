import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type { AuthenticatedStaff } from '@/lib/kani-auth';
import type { Appointment, Barber, ServiceId, Status } from '@/lib/kani-model';
import { sendAppointmentNotification } from '@/lib/kani-notifications.functions';
import { timeToMinutes } from './kani-manual-intervals';

export {
  computeAvailableManualSlots,
  filterSlotsByPeriod,
  formatDuration,
  isIntervalOverlapping,
  minutesToTime,
  timeToMinutes,
  PERIOD_LABELS,
  type ComputeSlotsInput,
  type PeriodFilter,
  type TimeCapsule,
} from './kani-manual-intervals';

export type RealAppointmentStatus = Tables<'appointments'>['status'];
export type NoShowDecision = 'RETAIN' | 'WAIVE' | 'REFUND';

export type RealAppointment = Appointment & {
  notes: string;
  statusCode: RealAppointmentStatus;
  barberId: string;
  serviceId?: string | null;
  customServiceName?: string | null;
  requestNumber: number;
  endTime?: string;
  serviceName?: string;
  serviceDuration?: number;
  servicePrice?: number;
  clientId?: string;
  createdAt?: string;
  isManual?: boolean;
  origin?: 'PUBLIC_WEB' | 'MANUAL';
  createdByUserId?: string | null;
  createdByDisplayName?: string | null;
  recurringRuleId?: string | null;
  depositRequired?: boolean;
  depositPaid?: boolean;
  depositAmountArs?: number;
  balancePaid?: boolean;
  noShowDecision?: NoShowDecision | null;
  noShowRefundAmountArs?: number;
  noShowReason?: string | null;
};

type AppointmentRow = Tables<'appointments'>;

export type ManualFrequency =
  | 'ONCE'
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'TRIWEEKLY'
  | 'MONTHLY';

export const MANUAL_FREQUENCY_LABELS: Record<ManualFrequency, string> = {
  ONCE: '1 vez',
  WEEKLY: '1 vez a la semana',
  BIWEEKLY: '1 vez cada 2 semanas',
  TRIWEEKLY: '1 vez cada 3 semanas',
  MONTHLY: '1 vez al mes',
};

/**
 * Convierte palabras numéricas de frecuencias e intervalos en cifras:
 * - «Una vez» -> «1 vez»
 * - «Dos semanas» -> «2 semanas»
 * - «Una vez cada dos semanas» -> «1 vez cada 2 semanas»
 * - «Una vez cada tres semanas» -> «1 vez cada 3 semanas»
 * - «Dos veces por semana» -> «2 veces por semana»
 */
export function shortenFrequencyText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\bUna vez cada tres semanas\b/gi, '1 vez cada 3 semanas')
    .replace(/\bUna vez cada dos semanas\b/gi, '1 vez cada 2 semanas')
    .replace(/\bDos veces por semana\b/gi, '2 veces por semana')
    .replace(/\bUna vez a la semana\b/gi, '1 vez a la semana')
    .replace(/\bUna vez al mes\b/gi, '1 vez al mes')
    .replace(/\bDos semanas\b/gi, '2 semanas')
    .replace(/\bTres semanas\b/gi, '3 semanas')
    .replace(/\bUna vez\b/gi, '1 vez')
    .replace(/\bÚnica vez\b/gi, '1 vez')
    .replace(/\bDos veces\b/gi, '2 veces')
    .replace(/\bTres veces\b/gi, '3 veces')
    .replace(/\bCuatro veces\b/gi, '4 veces');
}

export type CreateManualAppointmentInput = {
  barberId: string;
  serviceId?: string | null;
  customServiceName?: string | null;
  servicePriceArs?: number | null;
  date: string;
  time: string;
  endTime?: string | null;
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  isRecurring?: boolean;
  frequency?: ManualFrequency;
  durationMinutes?: number | null;
  depositRequired?: boolean;
  clientId?: string | null;
};

export type UpdateManualAppointmentInput = {
  appointmentId: string;
  barberId: string;
  serviceId?: string | null;
  customServiceName?: string | null;
  servicePriceArs?: number | null;
  date: string;
  time: string;
  endTime?: string | null;
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  durationMinutes?: number | null;
};

type CreateAppointmentInput = {
  barber: Barber;
  serviceName: string;
  date: string;
  time: string;
  name: string;
  phone: string;
  email: string;
  notes?: string;
};

const statusToUi: Record<RealAppointmentStatus, Status> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Cancelado',
  COMPLETED: 'Ejecutado',
  NO_SHOW: 'Inasistencia',
};

export function appointmentErrorMessage(error: unknown) {
  let message = '';
  if (typeof error === 'string') {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'object' && error !== null) {
    message = (error as any).message || (error as any).error || (error as any).details || '';
  }
  if (!message) {
    return 'No se pudo guardar la solicitud. Revisá los datos e intentá nuevamente.';
  }
  if (message.includes('OVERLAP_CONFLICT')) {
    const match = message.match(/OVERLAP_CONFLICT:(\d{2}:\d{2}):(\d{2}:\d{2})/);
    if (match) {
      return `El barbero ya tiene un turno reservado entre las ${match[1]} y las ${match[2]}.`;
    }
    return 'El barbero ya tiene un turno reservado en ese horario.';
  }
  if (message.includes('SLOT_ALREADY_BOOKED')) return 'El barbero ya tiene un turno reservado en ese horario.';
  if (message.includes('CLIENT_NAME_INVALID')) return 'El nombre del cliente debe tener al menos 2 caracteres.';
  if (message.includes('CLIENT_PHONE_INVALID')) return 'El celular del cliente debe tener al menos 6 dígitos.';
  if (message.includes('CLIENT_EMAIL_INVALID') || message.includes('correo electrónico') || message.includes('email')) {
    return 'El correo electrónico del cliente debe tener un formato válido.';
  }
  if (message.includes('BARBER_REQUIRED')) return 'Tenés que seleccionar un barbero.';
  if (message.includes('DATE_REQUIRED')) return 'Tenés que indicar una fecha.';
  if (message.includes('START_TIME_REQUIRED')) return 'Tenés que seleccionar un horario para el turno.';
  if (message.includes('CUSTOM_SERVICE_NAME_REQUIRED')) return 'El nombre del servicio personalizado es obligatorio.';
  if (message.includes('CUSTOM_SERVICE_PRICE_REQUIRED')) return 'El importe del servicio es obligatorio.';
  if (message.includes('SLOT_UNAVAILABLE')) return 'Ese horario ya no está disponible. Elegí otro para continuar.';
  if (message.includes('BOOKING_DATE_OUT_OF_RANGE')) return 'La fecha seleccionada ya no está disponible.';
  if (message.includes('SUNDAY_CLOSED')) return 'El estudio permanece cerrado los domingos.';
  if (message.includes('BARBER_CANNOT_CANCEL_MANUAL_APPOINTMENT')) return 'No tenés permisos para cancelar turnos manuales.';
  if (message.includes('BARBER_CANNOT_REASSIGN_APPOINTMENT')) return 'No podés reasignar un turno a otro barbero.';
  if (message.includes('MANUAL_APPOINTMENT_NOT_ALLOWED')) return 'No tenés permisos para agendar en la agenda de otro barbero.';
  if (message.includes('AUTH_REQUIRED')) return 'Tenés que iniciar sesión para realizar esta acción.';
  if (message.includes('create_manual_appointment') || message.includes('PGRST202')) {
    return 'La base de datos aún no tiene aplicada la migración de turnos manuales (create_manual_appointment). Aplicá la migración pendiente en Supabase.';
  }
  return message || 'No se pudo guardar la solicitud. Revisá los datos e intentá nuevamente.';
}

export const KANI_DEPOSIT_ARS = 5000;
export const KANI_MANUAL_DEPOSIT_ARS = KANI_DEPOSIT_ARS;

export function calculateAppointmentBalance(totalPriceArs: number, depositPaid: boolean) {
  const deposit = depositPaid ? KANI_MANUAL_DEPOSIT_ARS : 0;
  const remaining = Math.max(0, totalPriceArs - deposit);
  return {
    totalPrice: totalPriceArs,
    depositAmount: deposit,
    remainingBalance: remaining,
  };
}

export async function createManualAppointment(input: CreateManualAppointmentInput) {
  if (!input.barberId) {
    throw new Error('El barbero es obligatorio.');
  }
  if (!input.serviceId && !input.customServiceName?.trim()) {
    throw new Error('El servicio es obligatorio.');
  }
  if (!input.date) {
    throw new Error('La fecha es obligatoria.');
  }
  if (!input.time) {
    throw new Error('El horario es obligatorio.');
  }
  const name = input.name?.trim();
  if (!name || name.length < 2) {
    throw new Error('El nombre del cliente es obligatorio y debe tener al menos 2 caracteres.');
  }
  const phone = input.phone?.trim();
  if (!phone || phone.replace(/\D/g, '').length < 6) {
    throw new Error('El celular del cliente es obligatorio y debe ser válido.');
  }

  let email: string | null = null;
  if (input.email !== undefined && input.email !== null) {
    const trimmed = input.email.trim();
    if (trimmed.length > 0) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        throw new Error('El correo electrónico del cliente es obligatorio y debe tener un formato válido.');
      }
      email = trimmed;
    }
  }

  const payload: any = {
    p_barber_id: input.barberId,
    p_service_id: input.serviceId || null,
    p_custom_service_name: input.customServiceName?.trim() || null,
    p_service_price_ars: input.servicePriceArs ?? null,
    p_booking_date: input.date,
    p_start_time: input.time.length === 5 ? `${input.time}:00` : input.time,
    p_end_time: input.endTime ? (input.endTime.length === 5 ? `${input.endTime}:00` : input.endTime) : null,
    p_client_name: name,
    p_client_phone: phone,
    p_client_email: email,
    p_notes: input.notes?.trim() || null,
    p_is_recurring: Boolean(input.isRecurring),
    p_duration_minutes: input.durationMinutes ?? null,
    p_deposit_required: Boolean(input.depositRequired),
  };

  if (input.clientId) {
    payload.p_client_id = input.clientId;
  }

  const { data, error } = await supabase.rpc('create_manual_appointment', payload);
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error('No se pudo crear el turno manual.');

  if (row.appointment_id && phone) {
    try {
      const { data: claimToken } = await supabase.rpc('create_appointment_notification_event', {
        p_appointment_id: row.appointment_id,
        p_notification_type: 'CONFIRMED',
      });
      if (claimToken) {
        await dispatchAppointmentNotification(row.appointment_id, claimToken, phone);
      }
    } catch (notifError) {
      console.warn('[KANI appointments] No se pudo despachar notificación para turno manual:', notifError);
    }
  }

  return row;
}

export async function updateManualAppointment(input: UpdateManualAppointmentInput) {
  if (!input.appointmentId) {
    throw new Error('El identificador del turno es obligatorio.');
  }
  if (!input.barberId) {
    throw new Error('El barbero es obligatorio.');
  }
  if (!input.serviceId && !input.customServiceName?.trim()) {
    throw new Error('El servicio es obligatorio.');
  }
  if (!input.date) {
    throw new Error('La fecha es obligatoria.');
  }
  if (!input.time) {
    throw new Error('El horario es obligatorio.');
  }
  const name = input.name?.trim();
  if (!name || name.length < 2) {
    throw new Error('El nombre del cliente es obligatorio y debe tener al menos 2 caracteres.');
  }
  const phone = input.phone?.trim();
  if (!phone || phone.replace(/\D/g, '').length < 6) {
    throw new Error('El celular del cliente es obligatorio y debe ser válido.');
  }

  let email: string | null = null;
  if (input.email !== undefined && input.email !== null) {
    const trimmed = input.email.trim();
    if (trimmed.length > 0) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        throw new Error('El correo electrónico del cliente debe tener un formato válido.');
      }
      email = trimmed;
    }
  }

  const { data, error } = await supabase.rpc('update_manual_appointment', {
    p_appointment_id: input.appointmentId,
    p_barber_id: input.barberId,
    p_service_id: input.serviceId || null,
    p_custom_service_name: input.customServiceName?.trim() || null,
    p_service_price_ars: input.servicePriceArs ?? null,
    p_booking_date: input.date,
    p_start_time: input.time.length === 5 ? `${input.time}:00` : input.time,
    p_end_time: input.endTime ? (input.endTime.length === 5 ? `${input.endTime}:00` : input.endTime) : null,
    p_client_name: name,
    p_client_phone: phone,
    p_client_email: email,
    p_notes: input.notes?.trim() || null,
    p_duration_minutes: input.durationMinutes ?? null,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error('No se pudo actualizar el turno manual.');
  return row;
}

export async function createRealAppointment(input: CreateAppointmentInput) {
  let targetServiceName = input.serviceName;
  let { data, error } = await supabase.rpc('request_appointment', {
    p_barber_name: input.barber,
    p_service_name: targetServiceName,
    p_booking_date: input.date,
    p_start_time: input.time,
    p_client_name: input.name,
    p_client_phone: input.phone,
    p_client_email: input.email,
    p_notes: input.notes?.trim() || null,
  });

  // Si falló por discrepancia de nombre ('Corte y barba' vs 'Corte + barba'), intentar alternativo
  if (error && (targetServiceName === 'Corte y barba' || targetServiceName === 'Corte + barba')) {
    const alternativeName = targetServiceName === 'Corte y barba' ? 'Corte + barba' : 'Corte y barba';
    const retry = await supabase.rpc('request_appointment', {
      p_barber_name: input.barber,
      p_service_name: alternativeName,
      p_booking_date: input.date,
      p_start_time: input.time,
      p_client_name: input.name,
      p_client_phone: input.phone,
      p_client_email: input.email,
      p_notes: input.notes?.trim() || null,
    });
    if (!retry.error && retry.data) {
      data = retry.data;
      error = null;
    }
  }

  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error('La reserva no devolvió un resultado válido.');
  return row;
}

async function recordNotificationDispatchError(appointmentId: string, claimToken: string, errorCode: string) {
  try {
    const { error } = await supabase.rpc('record_appointment_notification_dispatch_error', {
      p_appointment_id: appointmentId,
      p_claim_token: claimToken,
      p_error: errorCode,
    });
    if (error) console.error('[KANI notification] fallback diagnostic failed', error.message);
  } catch (error) {
    console.error('[KANI notification] fallback diagnostic failed', error);
  }
}

async function dispatchAppointmentNotification(appointmentId: string, claimToken: string, clientPhone?: string) {
  try {
    const result = await sendAppointmentNotification({
      data: { appointmentId, claimToken, clientPhone },
    });
    if (result.status === 'FAILED' || result.status === 'SKIPPED') {
      await recordNotificationDispatchError(
        appointmentId,
        claimToken,
        result.errorCode ??
          (result.status === 'SKIPPED'
            ? 'SERVER_NOTIFICATION_SKIPPED'
            : 'SERVER_NOTIFICATION_FAILED'),
      );
    }
    return result;
  } catch (error) {
    console.error('[KANI notification] dispatch request failed', error);
    await recordNotificationDispatchError(
      appointmentId,
      claimToken,
      'SERVER_FUNCTION_DISPATCH_FAILED',
    );
    return { sent: false, status: 'FAILED' as const };
  }
}

let cachedBarbersMap: { data: Map<string, { id: string; name: string }>; timestamp: number } | null = null;
let cachedServicesMap: { data: Map<string, { id: string; name: string; duration_minutes: number; price_ars: number }>; timestamp: number } | null = null;
let inFlightAppointments: Promise<RealAppointment[]> | null = null;

export function clearAppointmentsReferenceCache() {
  cachedBarbersMap = null;
  cachedServicesMap = null;
  inFlightAppointments = null;
}

async function executeReadRealAppointments(options?: { bypassCache?: boolean; barberId?: string }): Promise<RealAppointment[]> {
  const fullColumns = 'id, request_number, client_id, barber_id, service_id, custom_service_name, service_price_ars, booking_date, start_time, end_time, status, notes, created_at, updated_at, is_manual, origin, created_by_user_id, created_by_display_name, recurring_rule_id, deposit_required, deposit_paid, deposit_amount_ars, balance_paid, no_show_decision, no_show_refund_amount_ars, booking_client_name';
  const baseColumns = 'id, request_number, client_id, barber_id, service_id, booking_date, start_time, end_time, status, notes, created_at, updated_at';

  let rows: AppointmentRow[] | null = null;
  let fullQuery = supabase
    .from('appointments')
    .select(fullColumns)
    .order('booking_date', { ascending: true })
    .order('start_time', { ascending: true });
  if (options?.barberId) fullQuery = fullQuery.eq('barber_id', options.barberId);
  const { data: fullRows, error: fullError } = await fullQuery;

  if (!fullError && fullRows) {
    rows = fullRows as AppointmentRow[];
  } else if (fullError && fullError.message && (fullError.message.includes('deposit_amount_ars') || fullError.message.includes('is_manual') || fullError.message.includes('booking_client_name') || fullError.code === '42703')) {
    console.warn('[KANI appointments] Columnas extendidas no detectadas en appointments, ejecutando consulta base:', fullError.message);
    let fallbackQuery = supabase
      .from('appointments')
      .select(baseColumns)
      .order('booking_date', { ascending: true })
      .order('start_time', { ascending: true });
    if (options?.barberId) fallbackQuery = fallbackQuery.eq('barber_id', options.barberId);
    const { data: fallbackRows, error: fallbackError } = await fallbackQuery;

    if (fallbackError) throw fallbackError;
    rows = (fallbackRows ?? []) as AppointmentRow[];
  } else if (fullError) {
    throw fullError;
  }

  const appointments = (rows ?? []) as AppointmentRow[];
  const clientIds = [...new Set(appointments.map(row => row.client_id))];
  const barberIds = [...new Set(appointments.map(row => row.barber_id))];
  const serviceIds = [...new Set(appointments.map(row => row.service_id).filter(Boolean))] as string[];

  const [clientsResult, barbersResult, servicesResult, exceptionsResult, ordersResult] = await Promise.all([
    clientIds.length ? supabase.from('clients').select('id, name, email, phone').in('id', clientIds) : { data: [] },
    cachedBarbersMap ? { data: Array.from(cachedBarbersMap.data.values()) } : (barberIds.length ? supabase.from('barbers').select('id, name').in('id', barberIds) : { data: [] }),
    cachedServicesMap ? { data: Array.from(cachedServicesMap.data.values()) } : (serviceIds.length ? supabase.from('services').select('id, name, duration_minutes, price_ars').in('id', serviceIds) : { data: [] }),
    appointments.length ? (supabase as any).from('appointment_no_show_exceptions').select('appointment_id, decision, refund_amount_ars, reason').in('appointment_id', appointments.map(a => a.id)) : { data: [] },
    appointments.length ? (supabase as any).from('mercadopago_orders').select('appointment_id, paid_amount_ars').in('appointment_id', appointments.map(a => a.id)).eq('status', 'CONFIRMED') : { data: [] },
  ]);

  const clients = clientsResult.data;
  const now = Date.now();
  if (!cachedBarbersMap && barbersResult.data) {
    const map = new Map();
    barbersResult.data.forEach(b => map.set(b.id, b));
    cachedBarbersMap = { data: map, timestamp: now };
  }
  if (!cachedServicesMap && servicesResult.data) {
    const existing = cachedServicesMap?.data ?? new Map();
    servicesResult.data.forEach(s => existing.set(s.id, s));
    cachedServicesMap = { data: existing, timestamp: now };
  }

  const barbers = barbersResult.data;
  const services = servicesResult.data;
  const clientById = new Map((clients ?? []).map(client => [client.id, client]));
  const barberById = new Map((barbers ?? []).map(barber => [barber.id, barber]));
  const serviceById = new Map((services ?? []).map(service => [service.id, service]));
  const exceptionByApt = new Map((((exceptionsResult as any)?.data as any[]) ?? []).map((e: any) => [e.appointment_id, e]));
  const orderByApt = new Map((((ordersResult as any)?.data as any[]) ?? []).map((o: any) => [o.appointment_id, o]));

  return appointments.flatMap(row => {
    const client = clientById.get(row.client_id);
    const barber = barberById.get(row.barber_id);
    const barberName = (barber?.name || 'Barbero') as Barber;
    const service = row.service_id ? serviceById.get(row.service_id) : undefined;
    const customName = (row as any).custom_service_name;
    const customPrice = (row as any).service_price_ars;
    const snapshotName = (row as any).booking_client_name;
    const clientName = snapshotName || client?.name || 'Cliente';

    const exc = exceptionByApt.get(row.id);
    const startM = timeToMinutes(row.start_time.slice(0, 5));
    const endM = timeToMinutes(row.end_time.slice(0, 5));
    const derivedDuration = Math.max(15, endM <= startM ? (endM + 1440) - startM : endM - startM);

    const displayName = customName
      ? customName
      : (service?.name === 'Corte + barba' || service?.name === 'Corte + Barba')
      ? 'Corte y barba'
      : service?.name || 'Otro';

    const displayPrice = customPrice ?? service?.price_ars ?? 0;
    const displayDuration = service?.duration_minutes ?? derivedDuration;

    return [{
      id: row.id,
      requestNumber: row.request_number,
      service: service ? serviceIdForName(service.name) : 'corte',
      barber: barberName,
      date: row.booking_date,
      time: row.start_time.slice(0, 5),
      endTime: row.end_time.slice(0, 5),
      name: clientName,
      bookingClientName: snapshotName || client?.name || null,
      email: client?.email || '',
      phone: client?.phone || '',
      status: statusToUi[row.status] || 'Confirmado',
      notes: row.notes ?? '',
      statusCode: row.status,
      barberId: row.barber_id,
      serviceId: row.service_id,
      customServiceName: customName || null,
      serviceName: displayName,
      serviceDuration: displayDuration,
      servicePrice: displayPrice,
      clientId: row.client_id,
      createdAt: row.created_at,
      isManual: Boolean((row as any).is_manual),
      origin: ((row as any).origin ?? 'PUBLIC_WEB') as 'PUBLIC_WEB' | 'MANUAL',
      createdByUserId: (row as any).created_by_user_id ?? null,
      createdByDisplayName: (row as any).created_by_display_name ?? null,
      recurringRuleId: (row as any).recurring_rule_id ?? null,
      depositRequired: (row as any).deposit_required ?? true,
      depositPaid: Boolean(orderByApt.get(row.id) || (row as any).deposit_paid),
      depositAmountArs: orderByApt.get(row.id)?.paid_amount_ars ?? (row as any).deposit_amount_ars ?? (orderByApt.has(row.id) || (row as any).deposit_paid ? 5000 : undefined),
      balancePaid: (row as any).balance_paid ?? false,
      noShowDecision: (exc?.decision ?? (row as any).no_show_decision ?? null) as NoShowDecision | null,
      noShowRefundAmountArs: exc?.refund_amount_ars ?? (row as any).no_show_refund_amount_ars ?? 0,
      noShowReason: exc?.reason ?? null,
    } satisfies RealAppointment];
  });
}

/** V2 staff reads use verified identity and never reuse another session's in-flight read. */
export async function readStaffAppointments(staff: AuthenticatedStaff): Promise<RealAppointment[]> {
  if (staff.profile.role === 'ADMIN') {
    return executeReadRealAppointments({ bypassCache: true });
  }
  if (staff.profile.role !== 'BARBER' || !staff.profile.barber_id) {
    throw new Error('No pudimos determinar el barbero asociado a tu usuario.');
  }
  return executeReadRealAppointments({ bypassCache: true, barberId: staff.profile.barber_id });
}

export async function updateRealAppointmentStatus(id: string, status: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW') {
  const { data, error } = await supabase.rpc('update_appointment_status', {
    p_appointment_id: id,
    p_status: status,
  });
  if (error) throw error;
  const row = data?.[0];
  if (row?.notification_claim_token) {
    await dispatchAppointmentNotification(id, row.notification_claim_token);
  }
  return row?.appointment_status;
}

export async function completeRealAppointment(id: string, balancePaid = true) {
  const { data, error } = await supabase.rpc('complete_appointment', {
    p_appointment_id: id,
    p_balance_paid: balancePaid,
  });
  if (error) throw error;
  return data?.[0];
}

export async function recordNoShowException(input: {
  appointmentId: string;
  decision: NoShowDecision;
  reason: string;
  refundAmountArs?: number;
}) {
  const { data, error } = await supabase.rpc('record_appointment_no_show_exception', {
    p_appointment_id: input.appointmentId,
    p_decision: input.decision,
    p_reason: input.reason.trim(),
    p_refund_amount_ars: input.refundAmountArs ?? null,
  });
  if (error) throw error;
  return data?.[0];
}

export async function retryRealAppointmentNotification(id: string) {
  const { data: claimToken, error } = await supabase.rpc('retry_appointment_notification', {
    p_appointment_id: id,
  });
  if (error) throw error;
  if (!claimToken) return 'ALREADY_SENT' as const;
  return (await dispatchAppointmentNotification(id, claimToken)).status;
}

function serviceIdForName(name: string): ServiceId {
  const normalized = (name || '').trim().toLowerCase();
  if (normalized === 'corte + barba' || normalized === 'corte y barba') return 'corte-barba';
  if (normalized === 'barba') return 'barba';
  return 'corte';
}

export async function readRealAppointments(options?: { bypassCache?: boolean }): Promise<RealAppointment[]> {
  if (!options?.bypassCache && inFlightAppointments) {
    return inFlightAppointments;
  }

  const promise = (async () => {
    try {
      return await executeReadRealAppointments(options);
    } finally {
      inFlightAppointments = null;
    }
  })();

  inFlightAppointments = promise;
  return promise;
}
