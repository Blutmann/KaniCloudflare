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
};

type AppointmentRow = Tables<'appointments'>;

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
  COMPLETED: 'Completado',
};

export function appointmentErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('SLOT_ALREADY_BOOKED')) return 'Ese horario acaba de dejar de estar disponible. Elegí otro para continuar.';
  if (message.includes('SLOT_UNAVAILABLE')) return 'Ese horario ya no está disponible. Elegí otro para continuar.';
  if (message.includes('BOOKING_DATE_OUT_OF_RANGE')) return 'La fecha seleccionada ya no está disponible.';
  if (message.includes('SUNDAY_CLOSED')) return 'El estudio permanece cerrado los domingos.';
  return 'No se pudo guardar la solicitud. Revisá los datos e intentá nuevamente.';
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
    await dispatchAppointmentNotification(row.appointment_id, row.notification_claim_token);
  }
  return row;
}

async function dispatchAppointmentNotification(appointmentId: string, claimToken: string) {
  try {
    const result = await sendAppointmentNotification({
      data: { appointmentId, claimToken },
    });
    if (result.status === 'FAILED') {
      // Fallback for failures before the server function can claim the outbox row.
      const { error } = await supabase.rpc('record_appointment_notification_dispatch_error', {
        p_appointment_id: appointmentId,
        p_claim_token: claimToken,
        p_error: result.errorCode ?? 'SERVER_NOTIFICATION_FAILED',
      });
      if (error) console.error('[KANI notification] fallback diagnostic failed', error.message);
    }
    return result;
  } catch (error) {
    // The server function may fail before its handler runs (module/transport error).
    console.error('[KANI notification] dispatch request failed', error);
    const { error: recordError } = await supabase.rpc('record_appointment_notification_dispatch_error', {
      p_appointment_id: appointmentId,
      p_claim_token: claimToken,
      p_error: 'SERVER_FUNCTION_DISPATCH_FAILED',
    });
    if (recordError) console.error('[KANI notification] fallback diagnostic failed', recordError.message);
    return { sent: false, status: 'FAILED' as const };
  }
}

export async function readRealAppointments() {
  const { data: rows, error } = await supabase
    .from('appointments')
    .select('id, request_number, client_id, barber_id, service_id, booking_date, start_time, end_time, status, notes, created_at, updated_at')
    .order('booking_date', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) throw error;
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
    } satisfies RealAppointment];
  });
}

export async function updateRealAppointmentStatus(id: string, status: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED') {
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
