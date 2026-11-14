import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type AdminActivityEvent = Tables<'admin_activity_notifications'>;

const activityFields =
  'id, event_type, actor_user_id, actor_display_name, barber_id, appointment_id, availability_slot_id, barber_name, client_name, event_date, event_time, created_at, read_at';

/**
 * Conservado solo por compatibilidad con tests existentes; el estado de notificaciones
 * no utiliza localStorage ni memoria global compartida como fuente de verdad.
 */
export function _resetNotificationStorageForTesting(): void {
  // No-op: la fuente de verdad es exclusivamente la base de datos por usuario autenticado.
}

function dedupeActivityEvents(events: AdminActivityEvent[]): AdminActivityEvent[] {
  const seen = new Set<string>();
  const result: AdminActivityEvent[] = [];
  for (const event of events) {
    if (!event?.id || seen.has(event.id)) continue;
    seen.add(event.id);
    result.push(event);
  }
  return result;
}

async function resolveAuthenticatedUserId(): Promise<string | undefined> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return undefined;
    return data?.user?.id;
  } catch {
    return undefined;
  }
}

async function requireAuthenticatedUserId(): Promise<string> {
  const userId = await resolveAuthenticatedUserId();
  if (!userId) {
    throw new Error('Tu sesión expiró. Volvé a iniciar sesión para actualizar las notificaciones.');
  }
  return userId;
}

/**
 * Detecta si un error corresponde a una función/tabla inexistente o desincronización
 * de schema cache de PostgREST para habilitar fallback controlado sobre `admin_activity_user_state`.
 */
export function isTableMissingOrSchemaCacheError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && error !== null) {
    const code = (error as any).code;
    const msg = (error as any).message || (error as any).error_description || (error as any).details || '';
    if (code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883') return true;
    if (typeof msg === 'string') {
      const lower = msg.toLowerCase();
      if (
        lower.includes('schema cache') ||
        lower.includes('could not find the table') ||
        lower.includes('could not find table') ||
        lower.includes('could not find the function') ||
        lower.includes('could not find function') ||
        lower.includes('function does not exist')
      ) {
        return true;
      }
    }
  }
  if (typeof error === 'string') {
    const lower = error.toLowerCase();
    if (
      lower.includes('schema cache') ||
      lower.includes('could not find the table') ||
      lower.includes('could not find table') ||
      lower.includes('could not find the function') ||
      lower.includes('could not find function') ||
      lower.includes('function does not exist')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Extrae un mensaje de error legible a partir de un error desconocido de Supabase o JavaScript.
 * Sanitiza los mensajes técnicos internos de caché de esquema y nombres de tabla.
 */
export function extractErrorMessage(error: unknown, fallback = 'Ocurrió un error inesperado.'): string {
  if (!error) return fallback;
  let raw = '';
  if (typeof error === 'string') {
    raw = error.trim();
  } else if (error instanceof Error && error.message) {
    raw = error.message.trim();
  } else if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof (error as any).message === 'string' && (error as any).message.trim()) {
      raw = (error as any).message.trim();
    } else if ('error_description' in error && typeof (error as any).error_description === 'string' && (error as any).error_description.trim()) {
      raw = (error as any).error_description.trim();
    } else if ('details' in error && typeof (error as any).details === 'string' && (error as any).details.trim()) {
      raw = (error as any).details.trim();
    } else if ('hint' in error && typeof (error as any).hint === 'string' && (error as any).hint.trim()) {
      raw = (error as any).hint.trim();
    }
  }

  if (!raw) return fallback;

  if (
    raw.includes('admin_activity_user_state') ||
    raw.includes('admin_activity_notifications') ||
    raw.toLowerCase().includes('schema cache') ||
    raw.toLowerCase().includes('could not find the table') ||
    raw.toLowerCase().includes('could not find the function')
  ) {
    return 'No se pudo actualizar el almacenamiento de notificaciones en el servidor.';
  }

  return raw;
}

/**
 * Consulta las novedades y notificaciones del usuario autenticado desde Supabase.
 * Cada usuario recibe únicamente sus eventos autorizados, excluyendo sus descartes
 * individuales y aplicando su propio estado de lectura (`read_at`).
 */
export async function readAdminActivityNotifications(_knownUserId?: string): Promise<AdminActivityEvent[]> {
  // 1. Priorizar RPC oficial `read_staff_activity_notifications` (aplica auth.uid() y admin_activity_user_state)
  const { data: rpcData, error: rpcError } = await supabase.rpc('read_staff_activity_notifications');
  if (!rpcError && Array.isArray(rpcData)) {
    return dedupeActivityEvents(rpcData as AdminActivityEvent[]);
  }

  if (rpcError && !isTableMissingOrSchemaCacheError(rpcError)) {
    throw new Error(extractErrorMessage(rpcError, 'No se pudieron cargar las notificaciones.'));
  }

  // 2. Fallback controlado únicamente si el RPC aún no está disponible en schema cache
  const currentUserId = await resolveAuthenticatedUserId();
  if (!currentUserId) {
    return [];
  }

  const dbDismissedIds = new Set<string>();
  const dbUserReadMap = new Map<string, string | null>();

  const { data: userState, error: userStateErr } = await supabase
    .from('admin_activity_user_state' as any)
    .select('notification_id, dismissed_at, read_at')
    .eq('user_id', currentUserId);

  if (userStateErr) {
    throw new Error(extractErrorMessage(userStateErr, 'No se pudo consultar el estado de tus notificaciones.'));
  }

  if (Array.isArray(userState)) {
    for (const row of userState) {
      if (row.dismissed_at) {
        dbDismissedIds.add(row.notification_id);
      }
      if (row.read_at !== undefined) {
        dbUserReadMap.set(row.notification_id, row.read_at);
      }
    }
  }

  const { data, error } = await supabase
    .from('admin_activity_notifications')
    .select(activityFields)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(extractErrorMessage(error, 'No se pudieron cargar las notificaciones.'));
  }

  const rawList = dedupeActivityEvents((data ?? []) as AdminActivityEvent[]);
  return rawList
    .filter(event => !dbDismissedIds.has(event.id))
    .slice(0, 40)
    .map(event => ({
      ...event,
      read_at: dbUserReadMap.get(event.id) ?? null,
    }));
}

/**
 * Marca o desmarca una notificación individual como leída/no leída exclusivamente
 * para el usuario autenticado actual. Nunca altera los estados de otros usuarios.
 */
export async function setAdminActivityNotificationRead(id: string, readAt: string | null): Promise<void> {
  const { error: rpcError } = await supabase.rpc('set_staff_activity_notification_read', {
    p_notification_id: id,
    p_read_at: readAt,
  });

  if (!rpcError) return;

  if (!isTableMissingOrSchemaCacheError(rpcError)) {
    throw new Error(extractErrorMessage(rpcError, 'No se pudo actualizar el estado de lectura.'));
  }

  const currentUserId = await requireAuthenticatedUserId();
  const now = new Date().toISOString();
  const { error: upsertErr } = await supabase
    .from('admin_activity_user_state' as any)
    .upsert(
      {
        notification_id: id,
        user_id: currentUserId,
        read_at: readAt,
        updated_at: now,
      },
      { onConflict: 'notification_id,user_id' },
    );

  if (upsertErr) {
    throw new Error(extractErrorMessage(upsertErr, 'No se pudo guardar el estado de lectura.'));
  }
}

/**
 * Marca como leídas todas las notificaciones visibles del usuario autenticado actual.
 * Nunca modifica el estado de lectura de otros usuarios.
 */
export async function markAllAdminActivityNotificationsRead(ids?: string[]): Promise<void> {
  const { error: rpcError } = await supabase.rpc('mark_all_staff_activity_notifications_read');

  if (!rpcError) return;

  if (!isTableMissingOrSchemaCacheError(rpcError)) {
    throw new Error(extractErrorMessage(rpcError, 'No se pudieron marcar todas las notificaciones como leídas.'));
  }

  const currentUserId = await requireAuthenticatedUserId();
  const now = new Date().toISOString();
  let targetIds = ids && ids.length > 0 ? [...ids] : [];

  if (targetIds.length === 0) {
    const { data: notifs, error: listErr } = await supabase
      .from('admin_activity_notifications')
      .select('id')
      .limit(50);
    if (listErr) {
      throw new Error(extractErrorMessage(listErr, 'No se pudieron obtener las notificaciones para marcar como leídas.'));
    }
    if (notifs && notifs.length > 0) {
      targetIds = notifs.map(n => n.id);
    }
  }

  if (targetIds.length === 0) return;

  const rows = targetIds.map(id => ({
    notification_id: id,
    user_id: currentUserId,
    read_at: now,
    updated_at: now,
  }));

  const { error: upsertErr } = await supabase
    .from('admin_activity_user_state' as any)
    .upsert(rows, { onConflict: 'notification_id,user_id' });

  if (upsertErr) {
    throw new Error(extractErrorMessage(upsertErr, 'No se pudieron marcar las notificaciones como leídas.'));
  }
}

/**
 * Marca como no leídas todas las notificaciones visibles del usuario autenticado actual.
 * Nunca modifica el estado de lectura de otros usuarios.
 */
export async function markAllAdminActivityNotificationsUnread(ids?: string[]): Promise<void> {
  const { error: rpcError } = await supabase.rpc('mark_all_staff_activity_notifications_unread');

  if (!rpcError) return;

  if (!isTableMissingOrSchemaCacheError(rpcError)) {
    throw new Error(extractErrorMessage(rpcError, 'No se pudieron marcar todas las notificaciones como no leídas.'));
  }

  const currentUserId = await requireAuthenticatedUserId();
  const now = new Date().toISOString();

  let query = supabase
    .from('admin_activity_user_state' as any)
    .update({ read_at: null, updated_at: now })
    .eq('user_id', currentUserId);

  if (ids && ids.length > 0) {
    query = query.in('notification_id', ids);
  }

  const { error: updateErr } = await query;
  if (updateErr) {
    throw new Error(extractErrorMessage(updateErr, 'No se pudieron marcar las notificaciones como no leídas.'));
  }
}

/**
 * Elimina (descarta) una notificación individual exclusivamente de la vista del usuario
 * autenticado actual en Supabase (`admin_activity_user_state`). Nunca elimina para otros usuarios.
 */
export async function dismissAdminActivityNotificationPersonal(id: string): Promise<void> {
  const { error: rpcError } = await supabase.rpc('dismiss_staff_activity_notification_personal', {
    p_notification_id: id,
  });

  if (!rpcError) return;

  if (!isTableMissingOrSchemaCacheError(rpcError)) {
    throw new Error(extractErrorMessage(rpcError, 'No se pudo eliminar la notificación de tu cuenta.'));
  }

  const currentUserId = await requireAuthenticatedUserId();
  const now = new Date().toISOString();
  const { error: upsertErr } = await supabase
    .from('admin_activity_user_state' as any)
    .upsert(
      {
        notification_id: id,
        user_id: currentUserId,
        dismissed_at: now,
        updated_at: now,
      },
      { onConflict: 'notification_id,user_id' },
    );

  if (upsertErr) {
    throw new Error(extractErrorMessage(upsertErr, 'No se pudo eliminar la notificación de tu cuenta.'));
  }
}

/**
 * Elimina (descarta) todas las notificaciones del usuario autenticado actual en Supabase
 * (`admin_activity_user_state`). Nunca borra notificaciones de otros usuarios.
 */
export async function dismissAllAdminActivityNotificationsPersonal(ids: string[] = []): Promise<number> {
  const { data, error: rpcError } = await supabase.rpc('dismiss_all_staff_activity_notifications_personal');

  if (!rpcError) {
    return typeof data === 'number' ? data : ids.length;
  }

  if (!isTableMissingOrSchemaCacheError(rpcError)) {
    throw new Error(extractErrorMessage(rpcError, 'No se pudieron eliminar tus notificaciones.'));
  }

  const currentUserId = await requireAuthenticatedUserId();
  let targetIds = [...ids];

  if (targetIds.length === 0) {
    const { data: notifs, error: listErr } = await supabase
      .from('admin_activity_notifications')
      .select('id')
      .limit(100);
    if (listErr) {
      throw new Error(extractErrorMessage(listErr, 'No se pudieron listar las notificaciones a eliminar.'));
    }
    if (notifs && notifs.length > 0) {
      targetIds = notifs.map(n => n.id);
    }
  }

  if (targetIds.length === 0) return 0;

  const now = new Date().toISOString();
  const rows = targetIds.map(id => ({
    notification_id: id,
    user_id: currentUserId,
    dismissed_at: now,
    updated_at: now,
  }));

  const { error: upsertErr } = await supabase
    .from('admin_activity_user_state' as any)
    .upsert(rows, { onConflict: 'notification_id,user_id' });

  if (upsertErr) {
    throw new Error(extractErrorMessage(upsertErr, 'No se pudieron eliminar tus notificaciones.'));
  }

  return targetIds.length;
}

/**
 * Wrapper seguro de compatibilidad: redirige cualquier invocación heredada hacia el descarte
 * personal por usuario autenticado para garantizar aislamiento entre cuentas.
 */
export async function deleteAdminActivityNotificationGlobal(id: string): Promise<void> {
  await dismissAdminActivityNotificationPersonal(id);
}

/**
 * Wrapper seguro de compatibilidad: redirige cualquier invocación heredada hacia el descarte
 * masivo personal por usuario autenticado para garantizar aislamiento entre cuentas.
 */
export async function deleteAllAdminActivityNotificationsGlobal(knownIds: string[] = []): Promise<number> {
  return dismissAllAdminActivityNotificationsPersonal(knownIds);
}

export function notifyActivityChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('kani-activity-changed'));
}
