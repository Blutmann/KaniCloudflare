import { supabase } from "@/integrations/supabase/client";

export type AdminActivityEvent = {
  id: string;
  event_type: "APPOINTMENT_CONFIRMED" | "APPOINTMENT_CANCELLED";
  appointment_id: string;
  client_name: string;
  barber_name: string;
  event_date: string;
  event_time: string;
  created_at: string;
  feed_sequence: number;
  read_at: string | null;
};
export type NotificationInbox = {
  items: AdminActivityEvent[];
  unread_count: number;
  through: number;
  next_before: number | null;
};
export type NotificationAppointment = {
  appointment_id: string;
  status: string;
  client_name: string;
  phone: string | null;
  email: string | null;
  service: string;
  barber: string;
  barber_id: string;
  date: string;
  time: string;
  end_time: string;
  final_price: number;
  deposit_paid: number;
  deposit_verifiable: boolean;
  collected: number;
  balance: number;
  benefit: string | null;
  benefit_type: string | null;
  has_payment: boolean;
};

async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as any)(name, args);
  if (error) throw error;
  return data as T;
}
// Never fall back to browser storage or shared read_at: failures remain visible.
export function readNotificationInbox(before: number | null = null) {
  return call<NotificationInbox>("staff_notification_inbox", { p_before: before });
}
export async function readAdminActivityNotifications() {
  return (await readNotificationInbox()).items;
}
export function readNotificationAppointment(id: string) {
  return call<NotificationAppointment>("staff_notification_detail", { p_notification_id: id });
}
export function setAdminActivityNotificationRead(id: string, readAt: string | null) {
  return call<void>("staff_set_notification_reads", { p_read: readAt !== null, p_ids: [id] });
}
export function markAllAdminActivityNotificationsRead(through: number) {
  return call<void>("staff_set_notification_reads", { p_read: true, p_through: through });
}
export function deleteAllAdminActivityNotificationsGlobal(ids: string[]) {
  return call<void>("staff_delete_notifications", { p_ids: ids });
}
export function deleteAdminActivityNotificationGlobal(id: string) {
  return deleteAllAdminActivityNotificationsGlobal([id]);
}
export function extractErrorMessage(
  error: unknown,
  fallback = "No pudimos actualizar las notificaciones. Reintentá.",
): string {
  const raw = error instanceof Error ? error.message : (error as { message?: string })?.message;
  if (raw?.includes("NOTIFICATION_NOT_ALLOWED"))
    return "La notificación ya no está disponible o no tenés permiso para verla.";
  if (raw?.includes("ADMIN_REQUIRED")) return "Solo ADMIN puede eliminar notificaciones.";
  return fallback;
}
export function notifyActivityChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("kani-activity-changed"));
}
