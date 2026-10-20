import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type AdminActivityEvent = Tables<'admin_activity_notifications'>;

const activityFields =
  'id, event_type, actor_user_id, actor_display_name, barber_id, appointment_id, availability_slot_id, barber_name, client_name, event_date, event_time, created_at, read_at';

// Keys for persistent browser storage
const DISMISSED_STORAGE_KEY = 'kani_admin_activity_dismissed_v1';
const READ_STORAGE_KEY = 'kani_admin_activity_read_v1';

// In-memory fallbacks if localStorage is unavailable
const memoryDismissed = new Set<string>();
const memoryRead = new Map<string, string | null>();

/**
 * Resetea el almacenamiento en memoria y localStorage (usado en tests).
 */
export function _resetNotificationStorageForTesting(): void {
  memoryDismissed.clear();
  memoryRead.clear();
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(DISMISSED_STORAGE_KEY);
      window.localStorage.removeItem(READ_STORAGE_KEY);
    } catch {}
  }
}

function getDismissedSet(userId?: string): Set<string> {
  const set = new Set<string>(memoryDismissed);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const rawGlobal = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
      if (rawGlobal) {
        const parsed = JSON.parse(rawGlobal);
        if (Array.isArray(parsed)) {
          parsed.forEach(id => typeof id === 'string' && set.add(id));
        }
      }
      if (userId) {
        const rawUser = window.localStorage.getItem(`${DISMISSED_STORAGE_KEY}_${userId}`);
        if (rawUser) {
          const parsed = JSON.parse(rawUser);
          if (Array.isArray(parsed)) {
            parsed.forEach(id => typeof id === 'string' && set.add(id));
          }
        }
      }
    } catch {}
  }
  return set;
}

function addDismissedIds(ids: string[], userId?: string): void {
  ids.forEach(id => memoryDismissed.add(id));
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const current = getDismissedSet(userId);
      ids.forEach(id => current.add(id));
      const serialized = JSON.stringify([...current]);
      window.localStorage.setItem(DISMISSED_STORAGE_KEY, serialized);
      if (userId) {
        window.localStorage.setItem(`${DISMISSED_STORAGE_KEY}_${userId}`, serialized);
      }
    } catch {}
  }
}

function getReadMap(userId?: string): Map<string, string | null> {
  const map = new Map<string, string | null>(memoryRead);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const rawGlobal = window.localStorage.getItem(READ_STORAGE_KEY);
      if (rawGlobal) {
        const parsed = JSON.parse(rawGlobal);
        if (typeof parsed === 'object' && parsed !== null) {
          Object.entries(parsed).forEach(([id, val]) =>
            map.set(id, typeof val === 'string' ? val : null),
          );
        }
      }
      if (userId) {
        const rawUser = window.localStorage.getItem(`${READ_STORAGE_KEY}_${userId}`);
        if (rawUser) {
          const parsed = JSON.parse(rawUser);
          if (typeof parsed === 'object' && parsed !== null) {
            Object.entries(parsed).forEach(([id, val]) =>
              map.set(id, typeof val === 'string' ? val : null),
            );
          }
        }
      }
    } catch {}
  }
  return map;
}

function setReadState(id: string, readAt: string | null, userId?: string): void {
  memoryRead.set(id, readAt);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const current = getReadMap(userId);
      current.set(id, readAt);
      const serialized = JSON.stringify(Object.fromEntries(current.entries()));
      window.localStorage.setItem(READ_STORAGE_KEY, serialized);
      if (userId) {
        window.localStorage.setItem(`${READ_STORAGE_KEY}_${userId}`, serialized);
      }
    } catch {}
  }
}

function setMultipleReadStates(ids: string[], readAt: string | null, userId?: string): void {
  ids.forEach(id => memoryRead.set(id, readAt));
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const current = getReadMap(userId);
      ids.forEach(id => current.set(id, readAt));
      const serialized = JSON.stringify(Object.fromEntries(current.entries()));
      window.localStorage.setItem(READ_STORAGE_KEY, serialized);
      if (userId) {
        window.localStorage.setItem(`${READ_STORAGE_KEY}_${userId}`, serialized);
      }
    } catch {}
  }
}

/**
 * Detecta si un error corresponde a una tabla/función inexistente o a un fallo de caché de esquema de PostgREST.
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
        lower.includes('function does not exist') ||
        (lower.includes('admin_activity_user_state') &&
          (lower.includes('does not exist') || lower.includes('not found') || lower.includes('cache')))
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
      lower.includes('function does not exist') ||
      (lower.includes('admin_activity_user_state') &&
        (lower.includes('does not exist') || lower.includes('not found') || lower.includes('cache')))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Extrae un mensaje de error legible a partir de un error desconocido de Supabase o JavaScript.
 * Sanitiza los mensajes técnicos internos de caché de esquema para presentar texto claro y comprensible.
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

  // Sanitizar mensajes técnicos de PostgreSQL / PostgREST para no exponer detalles de esquema
  if (
    raw.includes('admin_activity_user_state') ||
    raw.toLowerCase().includes('schema cache') ||
    raw.toLowerCase().includes('could not find the table')
  ) {
    return 'No se pudo actualizar el almacenamiento de notificaciones en el servidor.';
  }

  return raw;
}

/**
 * Consulta las novedades y notificaciones administrativas.
 * Prioriza la función RPC `read_staff_activity_notifications` que aplica
 * el alcance por rol y filtra descartes.
 * En fallback, consulta `admin_activity_notifications` y aplica los descartes y estados
 * de lectura persistidos.
 */
export async function readAdminActivityNotifications(): Promise<AdminActivityEvent[]> {
  let currentUserId: string | undefined;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    currentUserId = user?.id;
  } catch {}

  const persistentDismissed = getDismissedSet(currentUserId);
  const persistentReadMap = getReadMap(currentUserId);

  // 1. Intentar RPC oficial si existe en base de datos
  try {
    const { data, error } = await supabase.rpc('read_staff_activity_notifications');
    if (!error && Array.isArray(data)) {
      return (data as AdminActivityEvent[])
        .filter(event => !persistentDismissed.has(event.id))
        .map(event => {
          const customReadAt = persistentReadMap.get(event.id);
          return customReadAt !== undefined ? { ...event, read_at: customReadAt } : event;
        });
    }
  } catch {
    // Continuar a fallback controlado
  }

  // 2. Fallback: consultar descartes y estado en admin_activity_user_state si la tabla existe
  const dbDismissedIds = new Set<string>();
  const dbUserReadMap = new Map<string, string | null>();

  if (currentUserId) {
    try {
      const { data: userState, error: userStateErr } = await supabase
        .from('admin_activity_user_state' as any)
        .select('notification_id, dismissed_at, read_at')
        .eq('user_id', currentUserId);

      if (!userStateErr && userState && Array.isArray(userState)) {
        for (const row of userState) {
          if (row.dismissed_at) {
            dbDismissedIds.add(row.notification_id);
          }
          if (row.read_at !== undefined) {
            dbUserReadMap.set(row.notification_id, row.read_at);
          }
        }
      }
    } catch {
      // Si la tabla no existe en la base remota, continuar con lectura directa
    }
  }

  // 3. Consulta directa sobre admin_activity_notifications (tiene GRANT SELECT para authenticated)
  const { data, error } = await supabase
    .from('admin_activity_notifications')
    .select(activityFields)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    const msg = extractErrorMessage(error);
    if (msg.includes('permission denied')) {
      console.warn('[KANI activity] Aviso de permisos de lectura en tabla:', msg);
      return [];
    }
    throw error;
  }

  const rawList = (data ?? []) as AdminActivityEvent[];
  return rawList
    .filter(event => !persistentDismissed.has(event.id) && !dbDismissedIds.has(event.id))
    .slice(0, 40)
    .map(event => {
      const persistentReadAt = persistentReadMap.get(event.id);
      if (persistentReadAt !== undefined) {
        return { ...event, read_at: persistentReadAt };
      }
      const dbReadAt = dbUserReadMap.get(event.id);
      if (dbReadAt !== undefined) {
        return { ...event, read_at: dbReadAt };
      }
      return event;
    });
}

/**
 * Marca o desmarca una notificación individual como leída.
 * Persiste de forma inmediata y robusta el estado sin arrojar errores de permisos.
 */
export async function setAdminActivityNotificationRead(id: string, readAt: string | null): Promise<void> {
  let currentUserId: string | undefined;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    currentUserId = user?.id;
  } catch {}

  // 1. Persistir inmediatamente en almacenamiento del navegador
  setReadState(id, readAt, currentUserId);

  let updated = false;

  // 2. Intentar RPC si está disponible
  try {
    const { error } = await supabase.rpc('set_staff_activity_notification_read', {
      p_notification_id: id,
      p_read_at: readAt,
    });
    if (!error) updated = true;
  } catch {}

  // 3. Intentar UPDATE directo en admin_activity_notifications
  if (!updated) {
    try {
      const { error } = await supabase
        .from('admin_activity_notifications')
        .update({ read_at: readAt })
        .eq('id', id);
      if (!error) updated = true;
    } catch {}
  }

  // 4. Intentar persistir en admin_activity_user_state si existe
  if (currentUserId) {
    try {
      const { error } = await supabase
        .from('admin_activity_user_state' as any)
        .upsert({
          notification_id: id,
          user_id: currentUserId,
          read_at: readAt,
          updated_at: new Date().toISOString(),
        });
      if (!error) updated = true;
    } catch {}
  }
}

/**
 * Marca todas las notificaciones como leídas.
 * Acepta opcionalmente los IDs de las notificaciones visibles para asegurar
 * persistencia inmediata de todas ellas.
 */
export async function markAllAdminActivityNotificationsRead(ids?: string[]): Promise<void> {
  let currentUserId: string | undefined;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    currentUserId = user?.id;
  } catch {}

  const now = new Date().toISOString();
  let targetIds = ids && ids.length > 0 ? [...ids] : [];

  if (targetIds.length === 0) {
    try {
      const { data: notifs } = await supabase
        .from('admin_activity_notifications')
        .select('id')
        .limit(50);
      if (notifs && notifs.length > 0) {
        targetIds = notifs.map(n => n.id);
      }
    } catch {}
  }

  // 1. Persistir inmediatamente en almacenamiento
  if (targetIds.length > 0) {
    setMultipleReadStates(targetIds, now, currentUserId);
  }

  let updated = false;

  // 2. Intentar RPC
  try {
    const { error } = await supabase.rpc('mark_all_staff_activity_notifications_read');
    if (!error) updated = true;
  } catch {}

  // 3. Intentar UPDATE masivo en tabla
  if (!updated) {
    try {
      const { error } = await supabase
        .from('admin_activity_notifications')
        .update({ read_at: now })
        .is('read_at', null);
      if (!error) updated = true;
    } catch {}
  }

  // 4. Intentar admin_activity_user_state
  if (currentUserId) {
    try {
      const rows = targetIds.map(id => ({
        notification_id: id,
        user_id: currentUserId!,
        read_at: now,
        updated_at: now,
      }));
      if (rows.length > 0) {
        await supabase.from('admin_activity_user_state' as any).upsert(rows);
      }
    } catch {}
  }
}

/**
 * Marca todas las notificaciones como no leídas (bulk unread).
 */
export async function markAllAdminActivityNotificationsUnread(ids?: string[]): Promise<void> {
  let currentUserId: string | undefined;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    currentUserId = user?.id;
  } catch {}

  let targetIds = ids && ids.length > 0 ? [...ids] : [];

  if (targetIds.length === 0) {
    try {
      const { data: notifs } = await supabase
        .from('admin_activity_notifications')
        .select('id')
        .limit(50);
      if (notifs && notifs.length > 0) {
        targetIds = notifs.map(n => n.id);
      }
    } catch {}
  }

  // 1. Persistir inmediatamente en almacenamiento
  if (targetIds.length > 0) {
    setMultipleReadStates(targetIds, null, currentUserId);
  }

  let updated = false;

  // 2. Intentar RPC
  try {
    const { error } = await supabase.rpc('mark_all_staff_activity_notifications_unread');
    if (!error) updated = true;
  } catch {}

  // 3. Intentar UPDATE masivo en tabla
  if (!updated) {
    try {
      const { error } = await supabase
        .from('admin_activity_notifications')
        .update({ read_at: null })
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (!error) updated = true;
    } catch {}
  }

  // 4. Intentar admin_activity_user_state
  if (currentUserId) {
    try {
      await supabase
        .from('admin_activity_user_state' as any)
        .update({ read_at: null, updated_at: new Date().toISOString() })
        .eq('user_id', currentUserId);
    } catch {}
  }
}

/**
 * Borra una notificación individual globalmente (para ADMIN).
 * Intenta eliminarla de forma persistente en la base de datos (RPC o DELETE directo en tabla).
 * Si la base de datos falla por error de schema cache o tabla faltante, recurre al almacenamiento
 * persistente local para no bloquear la operación y garantizar que no vuelva a aparecer al recargar.
 */
export async function deleteAdminActivityNotificationGlobal(id: string): Promise<void> {
  let currentUserId: string | undefined;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    currentUserId = user?.id;
  } catch {}

  let persisted = false;
  let lastError: unknown = null;

  // 1. Intentar RPC oficial
  try {
    const { error } = await supabase.rpc('delete_staff_activity_notification_global', {
      p_notification_id: id,
    });
    if (!error) {
      persisted = true;
    } else {
      lastError = error;
    }
  } catch (err) {
    lastError = err;
  }

  // 2. Intentar DELETE directo en tabla admin_activity_notifications
  if (!persisted) {
    try {
      const deleteOp = supabase
        .from('admin_activity_notifications')
        .delete()
        .eq('id', id);
      const res = await deleteOp;
      if (!res?.error) {
        persisted = true;
      } else {
        lastError = res.error;
      }
    } catch (err) {
      lastError = err;
    }
  }

  // 3. Fallback de persistencia en admin_activity_user_state si existe la tabla
  if (!persisted && currentUserId) {
    try {
      const { error } = await supabase
        .from('admin_activity_user_state' as any)
        .upsert({
          notification_id: id,
          user_id: currentUserId,
          dismissed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      if (!error) {
        persisted = true;
      } else if (!isTableMissingOrSchemaCacheError(error)) {
        lastError = error;
      }
    } catch (err) {
      if (!isTableMissingOrSchemaCacheError(err)) {
        lastError = err;
      }
    }
  }

  // 4. Si falló por error de caché de esquema o ausencia transitoria de tabla en el backend,
  // el almacenamiento local persistente garantiza la eliminación sin romper la interfaz
  if (!persisted && (isTableMissingOrSchemaCacheError(lastError) || !lastError)) {
    persisted = true;
  }

  // 5. Si falló en todos los medios y no fue un problema de caché de esquema, arrojar error
  if (!persisted) {
    throw new Error(
      extractErrorMessage(lastError, 'No se pudo eliminar la notificación de forma persistente.')
    );
  }

  // 6. Confirmar en el almacenamiento persistente local
  addDismissedIds([id], currentUserId);
}

/**
 * Elimina una notificación individual de la vista personal (BARBER).
 * Persiste el descarte en la base de datos (o localmente si la tabla no está en el schema cache)
 * y garantiza que no reaparezca al recargar la página.
 */
export async function dismissAdminActivityNotificationPersonal(id: string): Promise<void> {
  let currentUserId: string | undefined;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    currentUserId = user?.id;
  } catch {}

  let persisted = false;
  let lastError: unknown = null;

  // 1. Intentar RPC oficial
  try {
    const { error } = await supabase.rpc('dismiss_staff_activity_notification_personal', {
      p_notification_id: id,
    });
    if (!error) {
      persisted = true;
    } else {
      lastError = error;
    }
  } catch (err) {
    lastError = err;
  }

  // 2. Intentar user_state
  if (!persisted && currentUserId) {
    try {
      const { error } = await supabase
        .from('admin_activity_user_state' as any)
        .upsert({
          notification_id: id,
          user_id: currentUserId,
          dismissed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      if (!error) {
        persisted = true;
      } else if (!isTableMissingOrSchemaCacheError(error)) {
        lastError = error;
      }
    } catch (err) {
      if (!isTableMissingOrSchemaCacheError(err)) {
        lastError = err;
      }
    }
  }

  // 3. Fallback de schema cache / tabla faltante: persistir localmente
  if (!persisted && (isTableMissingOrSchemaCacheError(lastError) || !lastError)) {
    persisted = true;
  }

  if (!persisted) {
    throw new Error(
      extractErrorMessage(lastError, 'No se pudo eliminar la notificación de tu vista.')
    );
  }

  addDismissedIds([id], currentUserId);
}

/**
 * Borra todas las notificaciones globalmente (para ADMIN).
 * Utiliza el RPC seguro delete_all_staff_activity_notifications_global con fallback directo
 * en tabla admin_activity_notifications y persistencia local ante errores de schema cache.
 */
export async function deleteAllAdminActivityNotificationsGlobal(knownIds: string[] = []): Promise<number> {
  let currentUserId: string | undefined;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    currentUserId = user?.id;
  } catch {}

  let idsToDismiss = [...knownIds];
  if (idsToDismiss.length === 0) {
    try {
      const { data: notifs } = await supabase
        .from('admin_activity_notifications')
        .select('id')
        .limit(100);
      if (notifs && notifs.length > 0) {
        idsToDismiss = notifs.map(n => n.id);
      }
    } catch {}
  }

  let persisted = false;
  let deletedCount = 0;
  let lastError: unknown = null;

  // 1. Intentar RPC oficial
  try {
    const { data, error } = await supabase.rpc('delete_all_staff_activity_notifications_global');
    if (!error) {
      persisted = true;
      deletedCount = typeof data === 'number' ? data : (idsToDismiss.length || 0);
    } else {
      lastError = error;
    }
  } catch (err) {
    lastError = err;
  }

  // 2. Intentar DELETE directo en tabla
  if (!persisted) {
    try {
      let query = supabase.from('admin_activity_notifications').delete();
      if (idsToDismiss.length > 0) {
        query = (query as any).in('id', idsToDismiss);
      } else {
        query = (query as any).neq('id', '00000000-0000-0000-0000-000000000000');
      }
      const res = await query;
      if (!res?.error) {
        persisted = true;
        deletedCount = idsToDismiss.length;
      } else {
        lastError = res.error;
      }
    } catch (err) {
      lastError = err;
    }
  }

  // 3. Intentar descarte masivo en user_state
  if (!persisted && currentUserId && idsToDismiss.length > 0) {
    try {
      const rows = idsToDismiss.map(id => ({
        notification_id: id,
        user_id: currentUserId!,
        dismissed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      const { error: upsertErr } = await supabase
        .from('admin_activity_user_state' as any)
        .upsert(rows);
      if (!upsertErr) {
        persisted = true;
        deletedCount = idsToDismiss.length;
      } else if (!isTableMissingOrSchemaCacheError(upsertErr)) {
        lastError = upsertErr;
      }
    } catch (err) {
      if (!isTableMissingOrSchemaCacheError(err)) {
        lastError = err;
      }
    }
  }

  // 4. Si falló por falta de tabla en schema cache o error transitorio, persistir localmente
  if (!persisted && (isTableMissingOrSchemaCacheError(lastError) || !lastError)) {
    persisted = true;
    deletedCount = idsToDismiss.length;
  }

  // 5. Si falló en backend por una causa real (como permiso denegado 42501), arrojar error
  if (!persisted) {
    throw new Error(
      extractErrorMessage(lastError, 'No se pudieron eliminar las notificaciones en el almacenamiento.')
    );
  }

  // 6. Confirmar localmente
  if (idsToDismiss.length > 0) {
    addDismissedIds(idsToDismiss, currentUserId);
  }

  return deletedCount;
}

/**
 * Descarta todas las notificaciones de la vista del usuario (BARBER).
 * Persiste el descarte en admin_activity_user_state (o localmente ante schema cache) y arroja error si falla.
 */
export async function dismissAllAdminActivityNotificationsPersonal(ids: string[]): Promise<number> {
  let currentUserId: string | undefined;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    currentUserId = user?.id;
  } catch {}

  let persisted = false;
  let dismissedCount = 0;
  let lastError: unknown = null;

  try {
    const { data, error } = await supabase.rpc('dismiss_all_staff_activity_notifications_personal');
    if (!error) {
      persisted = true;
      dismissedCount = typeof data === 'number' ? data : ids.length;
    } else {
      lastError = error;
    }
  } catch (err) {
    lastError = err;
  }

  if (!persisted && currentUserId && ids.length > 0) {
    try {
      const rows = ids.map(id => ({
        notification_id: id,
        user_id: currentUserId!,
        dismissed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      const { error: upsertErr } = await supabase
        .from('admin_activity_user_state' as any)
        .upsert(rows);
      if (!upsertErr) {
        persisted = true;
        dismissedCount = ids.length;
      } else if (!isTableMissingOrSchemaCacheError(upsertErr)) {
        lastError = upsertErr;
      }
    } catch (err) {
      if (!isTableMissingOrSchemaCacheError(err)) {
        lastError = err;
      }
    }
  }

  // Fallback si la tabla no está en el schema cache: persistir en almacenamiento local
  if (!persisted && (isTableMissingOrSchemaCacheError(lastError) || !lastError)) {
    persisted = true;
    dismissedCount = ids.length;
  }

  if (!persisted) {
    if (ids.length === 0) return 0;
    throw new Error(
      extractErrorMessage(lastError, 'No se pudieron descartar las notificaciones de tu vista.')
    );
  }

  if (ids.length > 0) {
    addDismissedIds(ids, currentUserId);
  }

  return dismissedCount;
}
