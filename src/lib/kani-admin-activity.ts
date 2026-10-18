import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type AdminActivityEvent = Tables<'admin_activity_notifications'>;

const activityFields = 'id, event_type, actor_user_id, actor_display_name, barber_id, appointment_id, availability_slot_id, barber_name, client_name, event_date, event_time, created_at, read_at';

/**
 * Extrae un mensaje de error legible a partir de un error desconocido de Supabase o JavaScript.
 */
export function extractErrorMessage(error: unknown, fallback = 'Ocurrió un error inesperado.'): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error.trim() || fallback;
  if (error instanceof Error && error.message) return error.message.trim() || fallback;
  if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof (error as any).message === 'string' && (error as any).message.trim()) {
      return (error as any).message;
    }
    if ('error_description' in error && typeof (error as any).error_description === 'string' && (error as any).error_description.trim()) {
      return (error as any).error_description;
    }
    if ('details' in error && typeof (error as any).details === 'string' && (error as any).details.trim()) {
      return (error as any).details;
    }
    if ('hint' in error && typeof (error as any).hint === 'string' && (error as any).hint.trim()) {
      return (error as any).hint;
    }
  }
  return fallback;
}

/**
 * Consulta las novedades y notificaciones administrativas.
 * Prioriza la función RPC `read_staff_activity_notifications` que aplica
 * el alcance por rol y filtra descartes en `admin_activity_user_state`.
 * En fallback, consulta `admin_activity_notifications` y aplica los descartes de usuario.
 */
export async function readAdminActivityNotifications(): Promise<AdminActivityEvent[]> {
  // 1. Intentar RPC oficial
  try {
    const { data, error } = await supabase.rpc('read_staff_activity_notifications');
    if (!error && Array.isArray(data)) {
      return data as AdminActivityEvent[];
    }
  } catch {
    // Continuar a fallback controlado
  }

  // 2. Fallback: consultar descartes y estado por usuario actual
  const dismissedIds = new Set<string>();
  const userReadMap = new Map<string, string | null>();

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: userState } = await supabase
        .from('admin_activity_user_state' as any)
        .select('notification_id, dismissed_at, read_at')
        .eq('user_id', user.id);

      if (userState && Array.isArray(userState)) {
        for (const row of userState) {
          if (row.dismissed_at) {
            dismissedIds.add(row.notification_id);
          }
          if (row.read_at !== undefined) {
            userReadMap.set(row.notification_id, row.read_at);
          }
        }
      }
    }
  } catch {
    // Si la tabla no existe aún, continuar con lectura directa
  }

  const { data, error } = await supabase
    .from('admin_activity_notifications')
    .select(activityFields)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;

  const rawList = (data ?? []) as AdminActivityEvent[];
  return rawList
    .filter(event => !dismissedIds.has(event.id))
    .slice(0, 40)
    .map(event => {
      const userReadAt = userReadMap.get(event.id);
      return userReadAt !== undefined ? { ...event, read_at: userReadAt } : event;
    });
}

/**
 * Marca o desmarca una notificación individual como leída.
 */
export async function setAdminActivityNotificationRead(id: string, readAt: string | null): Promise<void> {
  try {
    const { error } = await supabase.rpc('set_staff_activity_notification_read', {
      p_notification_id: id,
      p_read_at: readAt,
    });
    if (!error) return;
    console.warn('[KANI activity] RPC set_staff_activity_notification_read warning, intentando fallback:', error);
  } catch (err) {
    console.warn('[KANI activity] Error llamando a RPC set_staff_activity_notification_read, intentando fallback:', err);
  }

  // Fallback 1: Actualizar tabla admin_activity_notifications
  let tableUpdated = false;
  try {
    const { error } = await supabase
      .from('admin_activity_notifications')
      .update({ read_at: readAt })
      .eq('id', id);
    if (!error) tableUpdated = true;
  } catch (err) {
    console.warn('[KANI activity] Fallback update read_at directo falló:', err);
  }

  // Fallback 2: Persistir en admin_activity_user_state
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from('admin_activity_user_state' as any)
        .upsert({
          notification_id: id,
          user_id: user.id,
          read_at: readAt,
          updated_at: new Date().toISOString(),
        });
      tableUpdated = true;
    }
  } catch {
    // Ignorar si la tabla no existe
  }

  if (!tableUpdated) {
    throw new Error('No se pudo actualizar el estado de lectura de la notificación.');
  }
}

/**
 * Marca todas las notificaciones como leídas.
 */
export async function markAllAdminActivityNotificationsRead(): Promise<void> {
  const now = new Date().toISOString();
  try {
    const { error } = await supabase.rpc('mark_all_staff_activity_notifications_read');
    if (!error) return;
    console.warn('[KANI activity] RPC mark_all_staff_activity_notifications_read warning, intentando fallback:', error);
  } catch (err) {
    console.warn('[KANI activity] Error llamando a RPC mark_all_staff_activity_notifications_read, intentando fallback:', err);
  }

  let success = false;

  // Fallback 1: Update masivo en admin_activity_notifications
  try {
    const { error } = await supabase
      .from('admin_activity_notifications')
      .update({ read_at: now })
      .is('read_at', null);
    if (!error) success = true;
  } catch (err) {
    console.warn('[KANI activity] Fallback update mark_all read falló:', err);
  }

  // Fallback 2: Upsert masivo en admin_activity_user_state para el usuario actual
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: notifs } = await supabase
        .from('admin_activity_notifications')
        .select('id')
        .limit(50);

      if (notifs && notifs.length > 0) {
        const rows = notifs.map(n => ({
          notification_id: n.id,
          user_id: user.id,
          read_at: now,
          updated_at: now,
        }));
        const { error } = await supabase
          .from('admin_activity_user_state' as any)
          .upsert(rows);
        if (!error) success = true;
      }
    }
  } catch {
    // Ignorar si la tabla no existe
  }

  if (!success) {
    throw new Error('No se pudieron marcar las notificaciones como leídas.');
  }
}

/**
 * Marca todas las notificaciones como no leídas (bulk unread).
 * Revierte el estado de lectura de forma atómica y persistente.
 */
export async function markAllAdminActivityNotificationsUnread(): Promise<void> {
  try {
    const { error } = await supabase.rpc('mark_all_staff_activity_notifications_unread');
    if (!error) return;
    console.warn('[KANI activity] RPC mark_all_staff_activity_notifications_unread warning, intentando fallback:', error);
  } catch (err) {
    console.warn('[KANI activity] Error llamando a RPC mark_all_staff_activity_notifications_unread, intentando fallback:', err);
  }

  let success = false;

  // Fallback 1: Actualizar read_at a null en admin_activity_notifications
  try {
    const { error } = await supabase
      .from('admin_activity_notifications')
      .update({ read_at: null })
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (!error) success = true;
  } catch (err) {
    console.warn('[KANI activity] Fallback update mark_all unread falló:', err);
  }

  // Fallback 2: Resetear read_at en admin_activity_user_state
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase
        .from('admin_activity_user_state' as any)
        .update({ read_at: null, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
      if (!error) success = true;
    }
  } catch {
    // Ignorar si la tabla no existe
  }

  if (!success) {
    throw new Error('No se pudieron desmarcar las notificaciones.');
  }
}

/**
 * Borra una notificación individual globalmente (para ADMIN).
 * Con fallback a DELETE directo en tabla o descarte personal si las políticas de tabla están bloqueadas.
 */
export async function deleteAdminActivityNotificationGlobal(id: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('delete_staff_activity_notification_global', {
      p_notification_id: id,
    });
    if (!error) return;
    console.warn('[KANI activity] RPC delete_staff_activity_notification_global warning, intentando fallback:', error);
  } catch (err) {
    console.warn('[KANI activity] Error llamando a RPC delete_staff_activity_notification_global, intentando fallback:', err);
  }

  // Fallback 1: Direct table delete
  const { error } = await supabase
    .from('admin_activity_notifications')
    .delete()
    .eq('id', id);

  if (!error) return;

  console.warn('[KANI activity] Direct table delete falló, aplicando descarte personal como fallback:', error);

  // Fallback 2: Descarte personal para que no quede bloqueado
  await dismissAdminActivityNotificationPersonal(id);
}

/**
 * Elimina una notificación individual de la vista del usuario (BARBER o personal).
 */
export async function dismissAdminActivityNotificationPersonal(id: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('dismiss_staff_activity_notification_personal', {
      p_notification_id: id,
    });
    if (!error) return;
    throw error;
  } catch (err) {
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

/**
 * Borra todas las notificaciones globalmente (para ADMIN).
 * Utiliza el RPC seguro `delete_all_staff_activity_notifications_global`
 * con fallback a DELETE directo en `admin_activity_notifications` y descarte personal en caso de restricción RLS.
 */
export async function deleteAllAdminActivityNotificationsGlobal(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('delete_all_staff_activity_notifications_global');
    if (!error) {
      return typeof data === 'number' ? data : 0;
    }
    console.warn('[KANI activity] RPC delete_all_staff_activity_notifications_global warning, intentando fallback directo:', error);
  } catch (err) {
    console.warn('[KANI activity] Error llamando a RPC delete_all_staff_activity_notifications_global, intentando fallback directo:', err);
  }

  // Fallback 1: DELETE directo en tabla
  const { error } = await supabase
    .from('admin_activity_notifications')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (!error) {
    return 0;
  }

  console.warn('[KANI activity] Error en deleteAllAdminActivityNotificationsGlobal fallback directo, intentando descarte masivo:', error);

  // Fallback 2: Si RLS bloquea el DELETE directo, descartar masivamente para el usuario actual
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: notifs } = await supabase
        .from('admin_activity_notifications')
        .select('id')
        .limit(100);

      if (notifs && notifs.length > 0) {
        const rows = notifs.map(n => ({
          notification_id: n.id,
          user_id: user.id,
          dismissed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
        const { error: upsertErr } = await supabase
          .from('admin_activity_user_state' as any)
          .upsert(rows);

        if (!upsertErr) {
          return rows.length;
        }
      }
    }
  } catch {
    // Continuar para lanzar el error original
  }

  throw error;
}

/**
 * Descarta todas las notificaciones de la vista del usuario (BARBER).
 * Utiliza el RPC seguro `dismiss_all_staff_activity_notifications_personal`
 * con fallback a upsert en `admin_activity_user_state`.
 */
export async function dismissAllAdminActivityNotificationsPersonal(ids: string[]): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('dismiss_all_staff_activity_notifications_personal');
    if (!error) {
      return typeof data === 'number' ? data : 0;
    }
    console.warn('[KANI activity] RPC dismiss_all_staff_activity_notifications_personal warning, intentando fallback:', error);
  } catch (err) {
    console.warn('[KANI activity] Error llamando a RPC dismiss_all_staff_activity_notifications_personal, intentando fallback:', err);
  }

  if (ids.length === 0) return 0;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const rows = ids.map((id) => ({
    notification_id: id,
    user_id: user.id,
    dismissed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('admin_activity_user_state' as any)
    .upsert(rows);

  if (error) {
    console.error('[KANI activity] Error en dismissAllAdminActivityNotificationsPersonal fallback:', error);
    throw error;
  }
  return rows.length;
}
