import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type { Appointment, Barber, ServiceId, Status } from '@/lib/kani-model';
import { sendAppointmentNotification } from '@/lib/kani-notifications.functions';

export type RealAppointmentStatus = Tables<'appointments'>['status'];
export type RealAppointment = Appointment & {
  notes: string;
  statusCode: RealAppointmentStatus;
  barberId: string;
  serviceId: string;
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
};

type AppointmentRow = Tables<'appointments'>;

export type ManualFrequency =
  | 'ONCE'
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'TRIWEEKLY'
  | 'MONTHLY';

export const MANUAL_FREQUENCY_LABELS: Record<ManualFrequency, string> = {
  ONCE: 'Única vez',
  WEEKLY: 'Una vez a la semana',
  BIWEEKLY: 'Una vez cada dos semanas',
  TRIWEEKLY: 'Una vez cada tres semanas',
  MONTHLY: 'Una vez al mes',
};

export type CreateManualAppointmentInput = {
  barberId: string;
  serviceId: string;
  date: string;
  time: string;
  name: string;
  phone: string;
  email: string;
  notes?: string;
  isRecurring?: boolean;
  frequency?: ManualFrequency;
  durationMinutes?: number;
  depositRequired?: boolean;
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
  COMPLETED: 'Confirmado',
};

export function appointmentErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('correo electrónico') || message.includes('email')) {
    return 'El correo electrónico del cliente es obligatorio y debe tener un formato válido.';
  }
  if (message.includes('SLOT_ALREADY_BOOKED')) return 'Ese horario acaba de dejar de estar disponible o ya tiene un turno reservado.';
  if (message.includes('SLOT_UNAVAILABLE')) return 'Ese horario ya no está disponible. Elegí otro para continuar.';
  if (message.includes('BOOKING_DATE_OUT_OF_RANGE')) return 'La fecha seleccionada ya no está disponible.';
  if (message.includes('SUNDAY_CLOSED')) return 'El estudio permanece cerrado los domingos.';
  if (message.includes('MANUAL_APPOINTMENT_NOT_ALLOWED')) return 'No tenés permisos para agendar en la agenda de otro barbero.';
  if (message.includes('AUTH_REQUIRED')) return 'Tenés que iniciar sesión para realizar esta acción.';
  if (message.includes('create_manual_appointment') || message.includes('PGRST202')) {
    return 'La base de datos aún no tiene aplicada la migración de turnos manuales (create_manual_appointment). Aplicá la migración pendiente en Supabase.';
  }
  return 'No se pudo guardar la solicitud. Revisá los datos e intentá nuevamente.';
}

export async function createManualAppointment(input: CreateManualAppointmentInput) {
  const email = input.email?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('El correo electrónico del cliente es obligatorio y debe tener un formato válido.');
  }

  const { data, error } = await supabase.rpc('create_manual_appointment', {
    p_barber_id: input.barberId,
    p_service_id: input.serviceId,
    p_booking_date: input.date,
    p_start_time: input.time.length === 5 ? `${input.time}:00` : input.time,
    p_client_name: input.name.trim(),
    p_client_phone: input.phone.trim(),
    p_client_email: email,
    p_notes: input.notes?.trim() || null,
    p_is_recurring: Boolean(input.isRecurring),
    p_duration_minutes: input.durationMinutes ?? null,
    p_deposit_required: Boolean(input.depositRequired),
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error('No se pudo crear el turno manual.');
  return row;
}

export async function createRealAppointment(input: CreateAppointmentInput) {
  const { data, error } = await supabase.rpc('request_appointment', {
    p_barber_name: input.barber,
    p_service_name: input.serviceName,
    p_booking_date: input.date,
    p_start_time: input.time,
    p_client_name: input.name,
    p_client_phone: input.phone,
    p_client_email: input.email,
    p_notes: input.notes?.trim() || null,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error('La reserva no devolvió un resultado válido.');
  if (row.notification_claim_token) {
    // Await dispatch so the browser keeps the server-function request alive.
    // A notification failure must never invalidate the appointment request.
    await dispatchAppointmentNotification(row.appointment_id, row.notification_claim_token, input.phone);
  }
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
    // Diagnostics must never turn a saved appointment into a failed booking flow.
    console.error('[KANI notification] fallback diagnostic failed', error);
  }
}

async function dispatchAppointmentNotification(appointmentId: string, claimToken: string, clientPhone?: string) {
  try {
    const result = await sendAppointmentNotification({
      data: { appointmentId, claimToken, clientPhone },
    });
    if (result.status === 'FAILED' || result.status === 'SKIPPED') {
      // A skipped claim can leave the outbox row PENDING with attempts=0.
      // Record it so token/claim mismatches are visible instead of silently pending.
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
    // The server function may fail before its handler runs (module/transport error).
    console.error('[KANI notification] dispatch request failed', error);
    await recordNotificationDispatchError(
      appointmentId,
      claimToken,
      'SERVER_FUNCTION_DISPATCH_FAILED',
    );
    return { sent: false, status: 'FAILED' as const };
  }
}

export async function readRealAppointments(): Promise<RealAppointment[]> {
  const fullColumns = 'id, request_number, client_id, barber_id, service_id, booking_date, start_time, end_time, status, notes, created_at, updated_at, is_manual, origin, created_by_user_id, created_by_display_name, recurring_rule_id, deposit_required, deposit_paid';
  const baseColumns = 'id, request_number, client_id, barber_id, service_id, booking_date, start_time, end_time, status, notes, created_at, updated_at';

  let rows: AppointmentRow[] | null = null;
  const { data: fullRows, error: fullError } = await supabase
    .from('appointments')
    .select(fullColumns)
    .order('booking_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (!fullError && fullRows) {
    rows = fullRows as AppointmentRow[];
  } else if (fullError && fullError.message && (fullError.message.includes('is_manual') || fullError.code === '42703')) {
    // Schema fallback if migrations have not yet been applied to the target database
    console.warn('[KANI appointments] Columnas manuales no detectadas en appointments, ejecutando consulta base:', fullError.message);
    const { data: fallbackRows, error: fallbackError } = await supabase
      .from('appointments')
      .select(baseColumns)
      .order('booking_date', { ascending: true })
      .order('start_time', { ascending: true });

    if (fallbackError) throw fallbackError;
    rows = (fallbackRows ?? []) as AppointmentRow[];
  } else if (fullError) {
    throw fullError;
  }

  const appointments = (rows ?? []) as AppointmentRow[];
  const clientIds = [...new Set(appointments.map(row => row.client_id))];
  const barberIds = [...new Set(appointments.map(row => row.barber_id))];
  const serviceIds = [...new Set(appointments.map(row => row.service_id))];
  const [{ data: clients, error: clientsError }, { data: barbers, error: barbersError }, { data: services, error: servicesError }] = await Promise.all([
    clientIds.length ? supabase.from('clients').select('id, name, phone, email').in('id', clientIds) : Promise.resolve({ data: [], error: null }),
    barberIds.length ? supabase.from('barbers').select('id, name').in('id', barberIds) : Promise.resolve({ data: [], error: null }),
    serviceIds.length ? supabase.from('services').select('id, name, duration_minutes, price_ars').in('id', serviceIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (clientsError || barbersError || servicesError) throw clientsError ?? barbersError ?? servicesError;
  const clientById = new Map((clients ?? []).map(client => [client.id, client]));
  const barberById = new Map((barbers ?? []).map(barber => [barber.id, barber]));
  const serviceById = new Map((services ?? []).map(service => [service.id, service]));
  return appointments.flatMap(row => {
    const client = clientById.get(row.client_id);
    const barber = barberById.get(row.barber_id);
    const service = serviceById.get(row.service_id);
    if (!client || !barber || !service) return [];
    return [{
      id: row.id,
      requestNumber: row.request_number,
      service: serviceIdForName(service.name),
      barber: barber.name as Barber,
      date: row.booking_date,
      time: row.start_time.slice(0, 5),
      endTime: row.end_time.slice(0, 5),
      name: client.name,
      email: client.email,
      phone: client.phone,
      status: statusToUi[row.status],
      notes: row.notes ?? '',
      statusCode: row.status,
      barberId: row.barber_id,
      serviceId: row.service_id,
      serviceName: service.name,
      serviceDuration: service.duration_minutes,
      servicePrice: service.price_ars,
      clientId: row.client_id,
      createdAt: row.created_at,
      isManual: Boolean((row as any).is_manual),
      origin: ((row as any).origin ?? 'PUBLIC_WEB') as 'PUBLIC_WEB' | 'MANUAL',
      createdByUserId: (row as any).created_by_user_id ?? null,
      createdByDisplayName: (row as any).created_by_display_name ?? null,
      recurringRuleId: (row as any).recurring_rule_id ?? null,
      depositRequired: (row as any).deposit_required ?? true,
      depositPaid: (row as any).deposit_paid ?? false,
    } satisfies RealAppointment];
  });
}

export async function updateRealAppointmentStatus(id: string, status: 'CONFIRMED' | 'CANCELLED') {
  const { data, error } = await supabase.rpc('update_appointment_status', {
    p_appointment_id: id,
    p_status: status,
  });
  if (error) throw error;
  const row = data?.[0];
  if (row?.notification_claim_token) {
    // Await dispatch so the request isn't abandoned during client navigation.
    await dispatchAppointmentNotification(id, row.notification_claim_token);
  }
  return row?.appointment_status;
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
  if (name === 'Corte + barba') return 'corte-barba';
  if (name === 'Barba') return 'barba';
  return 'corte';
}
