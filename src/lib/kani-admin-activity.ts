import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type AdminActivityEvent = Tables<'admin_activity_notifications'>;

const activityFields = 'id, event_type, actor_user_id, actor_display_name, barber_id, appointment_id, availability_slot_id, barber_name, client_name, event_date, event_time, created_at, read_at';

export async function readAdminActivityNotifications() {
  // First try the RPC if available (which supports per-user dismissal and barber scoping)
  try {
    const { data, error } = await supabase.rpc('read_staff_activity_notifications');
    if (!error && Array.isArray(data)) {
      return data as AdminActivityEvent[];
    }
  } catch {
    // Fallback to direct table select
  }

  const { data, error } = await supabase
    .from('admin_activity_notifications')
    .select(activityFields)
    .order('created_at', { ascending: false })
    .limit(40);

  if (error) throw error;
  return (data ?? []) as AdminActivityEvent[];
}

export async function setAdminActivityNotificationRead(id: string, readAt: string | null) {
  try {
    const { error } = await supabase.rpc('set_staff_activity_notification_read', {
      p_notification_id: id,
      p_read_at: readAt,
    });
    if (!error) return;
  } catch {
    // Fallback to table update
  }

  const { error } = await supabase
    .from('admin_activity_notifications')
    .update({ read_at: readAt })
    .eq('id', id);

  if (error) throw error;
}

export async function markAllAdminActivityNotificationsRead() {
  try {
    const { error } = await supabase.rpc('mark_all_staff_activity_notifications_read');
    if (!error) return;
  } catch {
    // Fallback to table update
  }

  const { error } = await supabase
    .from('admin_activity_notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);

  if (error) throw error;
}

/**
 * Borra una notificación globalmente (solo permitido para ADMIN).
 */
export async function deleteAdminActivityNotificationGlobal(id: string) {
  try {
    const { error } = await supabase.rpc('delete_staff_activity_notification_global', {
      p_notification_id: id,
    });
    if (!error) return;
  } catch {
    // Fallback to direct table delete
  }

  const { error } = await supabase
    .from('admin_activity_notifications')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/**
 * Elimina la notificación de la vista del usuario (BARBER o personal).
 */
export async function dismissAdminActivityNotificationPersonal(id: string) {
  try {
    const { error } = await supabase.rpc('dismiss_staff_activity_notification_personal', {
      p_notification_id: id,
    });
    if (!error) return;
    throw error;
  } catch (err) {
    // If table admin_activity_user_state exists, try insert/upsert directly
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw err;

    const { error } = await supabase
      .from('admin_activity_user_state' as any)
      .upsert({
        notification_id: id,
        user_id: user.id,
        dismissed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;
  }
}
