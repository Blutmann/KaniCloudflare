import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type AdminActivityEvent = Tables<'admin_activity_notifications'>;

const activityFields = 'id, event_type, actor_user_id, actor_display_name, barber_id, appointment_id, availability_slot_id, barber_name, client_name, event_date, event_time, created_at, read_at';

export async function readAdminActivityNotifications() {
  const { data, error } = await supabase
    .from('admin_activity_notifications')
    .select(activityFields)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) throw error;
  return (data ?? []) as AdminActivityEvent[];
}

export async function setAdminActivityNotificationRead(id: string, readAt: string | null) {
  const { error } = await supabase
    .from('admin_activity_notifications')
    .update({ read_at: readAt })
    .eq('id', id);

  if (error) throw error;
}

export async function markAllAdminActivityNotificationsRead() {
  const { error } = await supabase
    .from('admin_activity_notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);

  if (error) throw error;
}
