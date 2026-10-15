import { supabase } from '@/integrations/supabase/client';
import type { Database, Tables } from '@/integrations/supabase/types';

export type CleanupStatus = Database['public']['Enums']['appointment_status'];
export type MaintenanceOperation = Tables<'maintenance_operations'>;
export type AvailabilityMaintenanceOperation = Tables<'maintenance_availability_operations'>;
export type MaintenanceResult = {
  operation_id: string;
  operation_status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  selected_statuses: CleanupStatus[];
  appointments_deleted: number;
  notification_events_deleted: number;
  admin_notifications_deleted: number;
  error_code: string | null;
};
export type AvailabilityMaintenanceResult = {
  operation_id: string;
  operation_status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  notifications_deleted: number;
  error_code: string | null;
};

export const cleanupStatusOptions: Array<{ value: CleanupStatus; label: string; description: string }> = [
  { value: 'PENDING', label: 'Pendientes', description: 'Solicitudes que todavía no fueron confirmadas.' },
  { value: 'CONFIRMED', label: 'Confirmados', description: 'Turnos confirmados por el equipo.' },
  { value: 'COMPLETED', label: 'Completados', description: 'Turnos marcados como realizados.' },
  { value: 'CANCELLED', label: 'Cancelados', description: 'Turnos rechazados o cancelados.' },
];

export async function reauthenticateAdmin(password: string) {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user?.email) throw new Error('No se pudo verificar la sesión actual.');

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (signInError) throw new Error('La contraseña no es correcta. No se realizó ningún cambio.');

  const { data: { user: verifiedUser }, error: verifiedUserError } = await supabase.auth.getUser();
  if (verifiedUserError || verifiedUser?.id !== user.id) throw new Error('No se pudo verificar nuevamente la identidad.');

  const { data: profile, error: profileError } = await supabase
    .from('staff_profiles')
    .select('role, active')
    .eq('user_id', verifiedUser.id)
    .maybeSingle();
  if (profileError || !profile?.active || profile.role !== 'ADMIN') {
    throw new Error('La cuenta ya no tiene permisos ADMIN activos.');
  }
}

export async function cleanupAppointmentRecords(statuses: CleanupStatus[]) {
  const { data, error } = await supabase.rpc('admin_cleanup_appointment_records', {
    p_statuses: statuses,
  });
  if (error) {
    if (error.message.includes('MAINTENANCE_ALREADY_RUNNING')) throw new Error('Ya hay una operación de mantenimiento en curso.');
    if (error.message.includes('MAINTENANCE_ADMIN_REQUIRED')) throw new Error('La sesión ya no tiene permisos ADMIN.');
    throw new Error('No se pudo ejecutar el mantenimiento. No se aplicaron cambios.');
  }

  const result = data?.[0] as MaintenanceResult | undefined;
  if (!result) throw new Error('La operación no devolvió un resultado válido.');
  if (result.operation_status !== 'SUCCEEDED') throw new Error('La operación falló y se revirtió por completo. No se aplicaron cambios.');
  return result;
}

export async function countAvailabilityNotifications() {
  const { data, error } = await supabase.rpc('admin_count_availability_notifications');
  if (error) {
    if (error.message.includes('MAINTENANCE_ADMIN_REQUIRED')) throw new Error('La sesión ya no tiene permisos ADMIN.');
    throw new Error('No se pudo consultar el historial de disponibilidad.');
  }
  return Number(data ?? 0);
}

export async function cleanupAvailabilityNotifications() {
  const { data, error } = await supabase.rpc('admin_cleanup_availability_notifications');
  if (error) {
    if (error.message.includes('MAINTENANCE_AVAILABILITY_ALREADY_RUNNING')) throw new Error('Ya hay una limpieza del historial de disponibilidad en curso.');
    if (error.message.includes('MAINTENANCE_ADMIN_REQUIRED')) throw new Error('La sesión ya no tiene permisos ADMIN.');
    throw new Error('No se pudo eliminar el historial de disponibilidad. No se aplicaron cambios.');
  }

  const result = data?.[0] as AvailabilityMaintenanceResult | undefined;
  if (!result) throw new Error('La operación no devolvió un resultado válido.');
  if (result.operation_status !== 'SUCCEEDED') throw new Error('La operación falló y se revirtió por completo. No se aplicaron cambios.');
  return result;
}
