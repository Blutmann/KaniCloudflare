/**
 * KANI BARBER STUDIO — Sincronización Automática con Google Calendar
 * 
 * Sincronización estrictamente unidireccional: Kani -> Google Calendar.
 * Supabase es la fuente de verdad definitiva.
 * 
 * Resuelve:
 * 1. Formateo exacto de eventos según especificación oficial (Sección 5).
 * 2. Manejo de cambios de barbero (eliminación en calendario anterior y creación en nuevo).
 * 3. Cancelaciones automáticas (eliminación de evento en Google sin borrar registro en Supabase).
 * 4. Detección de cancelaciones tempranas (evita crear eventos si el turno se canceló antes de sincronizar).
 * 5. Reintentos exponenciales con registro de fallas y estado idempotente.
 * 6. Auditoría controlada de 5 pasos (Sección 3) para validar permisos de Service Account/OAuth.
 */

import { GoogleCalendarClient, type GoogleCalendarEventPayload } from './kani-google-calendar-client';
import { getGoogleCalendarAuthConfig } from './kani-google-calendar-auth';
import { supabase as defaultSupabase } from '@/integrations/supabase/client';

export type CalendarSyncQueueItem = {
  sync_id: string;
  appointment_id: string;
  barber_id: string;
  barber_name: string;
  calendar_id: string | null;
  google_event_id: string | null;
  previous_calendar_id: string | null;
  previous_google_event_id: string | null;
  sync_action: 'UPSERT' | 'DELETE';
  attempts: number;
  payload_checksum: string | null;
  booking_date: string;
  start_time: string;
  end_time: string;
  request_number: number | string | null;
  client_name: string;
  service_name: string;
  custom_service_name: string | null;
  service_price_ars: number | null;
  deposit_paid: boolean;
  deposit_amount_ars: number | null;
  sync_version?: number;
  claimed_by?: string | null;
};

/**
 * Genera un identificador de evento determinista para Google Calendar.
 * Especificación de Google Calendar API v3:
 * - Longitud: 5 a 1024 caracteres.
 * - Caracteres permitidos: base32hex en minúsculas (dígitos 0-9 y letras a-v).
 * 
 * Usar un ID determinista derivado del ID de reserva de Kani garantiza idempotencia
 * estricta ante caídas de red o reintentos distribuidos, evitando eventos duplicados en Google.
 */
export function buildDeterministicGoogleEventId(appointmentId: string): string {
  const cleanId = appointmentId.toLowerCase().replace(/[^0-9a-v]/g, '');
  const base = `kani${cleanId}`;
  return base.padEnd(5, '0').slice(0, 64);
}

export function buildGoogleCalendarEventPayload(
  item: Pick<
    CalendarSyncQueueItem,
    | 'service_name'
    | 'custom_service_name'
    | 'booking_date'
    | 'start_time'
    | 'end_time'
    | 'client_name'
    | 'service_price_ars'
    | 'deposit_paid'
    | 'deposit_amount_ars'
    | 'request_number'
    | 'appointment_id'
  >,
): GoogleCalendarEventPayload {
  const serviceTitle = item.custom_service_name || item.service_name || 'Corte';
  const summary = `${serviceTitle} — Kani Barber Studio`;

  const startTimeStr = item.start_time.slice(0, 5);
  const endTimeStr = item.end_time.slice(0, 5);

  const startDateTime = `${item.booking_date}T${startTimeStr}:00-03:00`;
  const endDateTime = `${item.booking_date}T${endTimeStr}:00-03:00`;

  const depositArs = item.deposit_amount_ars ?? (item.deposit_paid ? 5000 : 0);
  const totalArs = item.service_price_ars ?? 0;
  const balanceArs = Math.max(0, totalArs - depositArs);

  const ref = item.request_number ? `#${item.request_number}` : `#${item.appointment_id.slice(0, 8)}`;

  const description = [
    `Cliente: ${item.client_name}`,
    `Servicio: ${serviceTitle}`,
    `Seña abonada: $${depositArs.toLocaleString('es-AR')}`,
    `Saldo restante: $${balanceArs.toLocaleString('es-AR')}`,
    `Referencia: ${ref}`,
  ].join('\n');

  return {
    summary,
    description,
    start: {
      dateTime: startDateTime,
      timeZone: 'America/Argentina/Buenos_Aires',
    },
    end: {
      dateTime: endDateTime,
      timeZone: 'America/Argentina/Buenos_Aires',
    },
    visibility: 'private',
  };
}

export async function computeEventChecksum(payload: GoogleCalendarEventPayload): Promise<string> {
  const raw = `${payload.summary}|${payload.start.dateTime}|${payload.end.dateTime}|${payload.description}`;
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export type SyncItemResult = {
  syncId: string;
  appointmentId: string;
  status: 'SYNCED' | 'FAILED' | 'SKIPPED';
  action: 'UPSERT' | 'DELETE';
  googleEventId?: string;
  error?: string;
};

export async function resolveBarberCalendarId(
  barberName: string,
  supabaseClient?: any,
): Promise<string | null> {
  const norm = barberName.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
  const globalObj = globalThis as typeof globalThis & {
    __env__?: Record<string, unknown>;
    __KANI_RUNTIME_ENV?: Record<string, string>;
  };

  const getVar = (k: string) => {
    const val = env[k] ?? globalObj.__KANI_RUNTIME_ENV?.[k] ?? globalObj.__env__?.[k];
    return typeof val === 'string' && val.trim() ? val.trim() : undefined;
  };

  // Variables en Cloudflare Workers: ej. GOOGLE_CALENDAR_ID_FRANCO, CALENDAR_ID_FRANCO, etc.
  const envCalendarId =
    getVar(`GOOGLE_CALENDAR_ID_${norm}`) ||
    getVar(`GOOGLE_CALENDAR_${norm}_ID`) ||
    getVar(`GOOGLE_CALENDAR_${norm}`) ||
    getVar(`CALENDAR_ID_${norm}`) ||
    getVar(`GOOGLE_CALENDAR_ID_${barberName.trim().toUpperCase()}`);

  if (envCalendarId && envCalendarId.trim()) {
    return envCalendarId.trim();
  }

  // Fallback a base de datos barber_google_calendars
  try {
    const supabase = supabaseClient || defaultSupabase;
    if (supabase && typeof supabase.from === 'function') {
      const { data: barberRow } = await supabase
        .from('barbers')
        .select('id, name')
        .ilike('name', barberName.trim())
        .maybeSingle();

      if (barberRow?.id) {
        const { data: calRow } = await supabase
          .from('barber_google_calendars')
          .select('calendar_id')
          .eq('barber_id', barberRow.id)
          .maybeSingle();

        if (calRow?.calendar_id) {
          return calRow.calendar_id;
        }
      }
    }
  } catch (err) {
    console.warn('[Calendar Sync] Fallback de búsqueda de calendar_id en BD falló:', err);
  }

  return null;
}

/**
 * Sincroniza un elemento individual de la cola Kani -> Google Calendar
 */
export async function syncQueueItem(
  item: CalendarSyncQueueItem & { sync_version?: number },
  client: GoogleCalendarClient,
  supabaseClient: any = defaultSupabase,
  workerId?: string,
): Promise<SyncItemResult> {
  const syncVersion = item.sync_version ?? (item as any).version;

  const recordSuccess = async (googleEventId: string | null, calendarId: string | null, checksum: string | null) => {
    // Si el trabajo fue reclamado mediante leases transaccionales (workerId y syncVersion presentes),
    // exigir de forma estricta record_calendar_sync_success_v2 sin fallbacks que permitan saltarse versiones
    if (workerId && syncVersion !== undefined) {
      const { data, error } = await supabaseClient.rpc('record_calendar_sync_success_v2', {
        p_sync_id: item.sync_id,
        p_worker_id: workerId,
        p_version: syncVersion,
        p_google_event_id: googleEventId,
        p_calendar_id: calendarId,
        p_checksum: checksum,
      });
      if (error) {
        throw new Error(`CONCURRENCY_SUCCESS_RECORD_FAILED: ${error.message}`);
      }
      if (data === false) {
        throw new Error('CONCURRENCY_LEASE_LOST: El lease o versión del trabajo cambió mientras se procesaba.');
      }
      return;
    }

    // Solo para ejecuciones directas sin lease (ej: tests unitarios legacy sin worker)
    await supabaseClient.rpc('record_calendar_sync_success', {
      p_sync_id: item.sync_id,
      p_google_event_id: googleEventId,
      p_calendar_id: calendarId,
      p_checksum: checksum,
    });
  };

  const recordFailure = async (errorMsg: string) => {
    if (workerId && syncVersion !== undefined) {
      const { data, error } = await supabaseClient.rpc('record_calendar_sync_failure_v2', {
        p_sync_id: item.sync_id,
        p_worker_id: workerId,
        p_version: syncVersion,
        p_error: errorMsg,
      });
      if (error) {
        console.error(`[Kani Calendar Sync] Error al registrar falla en BD:`, error.message);
      }
      return;
    }

    await supabaseClient.rpc('record_calendar_sync_failure', {
      p_sync_id: item.sync_id,
      p_error: errorMsg,
    });
  };

  try {
    const effectiveCalendarId =
      item.calendar_id || (await resolveBarberCalendarId(item.barber_name, supabaseClient));

    // 1. Manejo de DELETE
    if (item.sync_action === 'DELETE') {
      if (effectiveCalendarId && item.google_event_id) {
        await client.deleteEvent(effectiveCalendarId, item.google_event_id);
      }
      await recordSuccess(null, effectiveCalendarId, null);
      return {
        syncId: item.sync_id,
        appointmentId: item.appointment_id,
        status: 'SYNCED',
        action: 'DELETE',
      };
    }

    // 2. Manejo de UPSERT (Creación o Actualización)
    if (!effectiveCalendarId) {
      const err = `CALENDAR_NOT_CONFIGURED: El barbero ${item.barber_name} no tiene asignado un calendar_id en Cloudflare ni en barber_google_calendars.`;
      await recordFailure(err);
      return {
        syncId: item.sync_id,
        appointmentId: item.appointment_id,
        status: 'FAILED',
        action: 'UPSERT',
        error: err,
      };
    }

    const payload = buildGoogleCalendarEventPayload(item);
    const checksum = await computeEventChecksum(payload);
    const deterministicId = buildDeterministicGoogleEventId(item.appointment_id);

    // 2.1 Caso cambio de barbero: Eliminar evento del calendario anterior
    // Si la eliminación en el calendario viejo falla, NO se considera definitivamente exitoso.
    // Se lanza error para registrar el fallo y programar el reintento, garantizando que
    // previous_calendar_id y previous_google_event_id no se pierdan.
    if (item.previous_calendar_id && item.previous_google_event_id) {
      try {
        await client.deleteEvent(item.previous_calendar_id, item.previous_google_event_id);
      } catch (delError: any) {
        const delMsg = `OLD_CALENDAR_DELETE_FAILED: No se pudo eliminar el evento previo (${item.previous_google_event_id}) del calendario ${item.previous_calendar_id}: ${delError?.message || delError}`;
        console.error(`[Kani Calendar Sync] ${delMsg}`);
        throw new Error(delMsg);
      }
    }

    let resultingEventId = item.google_event_id;

    // 2.2 Si ya existe google_event_id, actualizar (PATCH) si cambió el contenido
    if (item.google_event_id) {
      if (item.payload_checksum === checksum) {
        // Idempotencia: el evento ya está exactamente sincronizado
        await recordSuccess(item.google_event_id, effectiveCalendarId, checksum);
        return {
          syncId: item.sync_id,
          appointmentId: item.appointment_id,
          status: 'SYNCED',
          action: 'UPSERT',
          googleEventId: item.google_event_id,
        };
      }

      const updated = await client.updateEvent(effectiveCalendarId, item.google_event_id, payload);
      resultingEventId = updated.id;
    } else {
      // 2.3 Si no existe, crear nuevo evento con ID determinista para garantizar idempotencia
      const created = await client.createEvent(effectiveCalendarId, payload, deterministicId);
      resultingEventId = created.id;
    }

    await recordSuccess(resultingEventId, effectiveCalendarId, checksum);

    return {
      syncId: item.sync_id,
      appointmentId: item.appointment_id,
      status: 'SYNCED',
      action: 'UPSERT',
      googleEventId: resultingEventId || undefined,
    };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    await recordFailure(errorMsg);
    return {
      syncId: item.sync_id,
      appointmentId: item.appointment_id,
      status: 'FAILED',
      action: item.sync_action,
      error: errorMsg,
    };
  }
}

let isSyncInProgress = false;

export function isCalendarSyncInProgress(): boolean {
  return isSyncInProgress;
}

export async function getSyncSupabaseClient(custom?: any): Promise<any> {
  if (custom) return custom;

  const envObj = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
  const globalObj = globalThis as typeof globalThis & {
    __env__?: Record<string, unknown>;
    __KANI_RUNTIME_ENV?: Record<string, string>;
  };
  const url =
    envObj['SUPABASE_URL'] ||
    globalObj.__KANI_RUNTIME_ENV?.['SUPABASE_URL'] ||
    (globalObj.__env__?.['SUPABASE_URL'] as string) ||
    'https://iockpxtkflyjfagkvgnr.supabase.co';
  const key =
    envObj['SUPABASE_SERVICE_ROLE_KEY'] ||
    globalObj.__KANI_RUNTIME_ENV?.['SUPABASE_SERVICE_ROLE_KEY'] ||
    (globalObj.__env__?.['SUPABASE_SERVICE_ROLE_KEY'] as string);

  if (url && key) {
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    if (supabaseAdmin) return supabaseAdmin;
  } catch {
    // fallback en entornos de navegador o sin variables de servidor
  }
  return defaultSupabase;
}

export type ProcessQueueOptions = {
  limit?: number;
  force?: boolean;
  client?: GoogleCalendarClient;
  supabaseClient?: any;
};

export type ProcessQueueResult = {
  status: 'SUCCESS' | 'DISABLED' | 'PARTIAL' | 'ERROR' | 'SKIPPED';
  processed: number;
  synced: number;
  failed: number;
  skipped: number;
  items: SyncItemResult[];
  message?: string;
};

/**
 * Asocia los 4 calendarios secundarios de Google a los barberos en barber_google_calendars
 */
export async function syncBarberCalendarAssociations(supabaseClient?: any): Promise<{
  success: boolean;
  associations: Array<{
    barber: string;
    calendarId: string;
    variable: string;
    persisted: boolean;
  }>;
  errors: string[];
}> {
  const client = await getSyncSupabaseClient(supabaseClient);
  const barbers = [
    { name: 'Lautaro', varName: 'GOOGLE_CALENDAR_LAUTARO_ID' },
    { name: 'Gonzalo', varName: 'GOOGLE_CALENDAR_GONZALO_ID' },
    { name: 'Valentín', varName: 'GOOGLE_CALENDAR_VALENTIN_ID' },
    { name: 'Franco', varName: 'GOOGLE_CALENDAR_FRANCO_ID' },
  ];

  const associations: Array<{
    barber: string;
    calendarId: string;
    variable: string;
    persisted: boolean;
  }> = [];
  const errors: string[] = [];

  for (const b of barbers) {
    const calendarId = await resolveBarberCalendarId(b.name, client);
    if (!calendarId) {
      errors.push(`Variable ${b.varName} no encontrada para ${b.name}`);
      continue;
    }

    try {
      let persisted = false;
      try {
        const { error: rpcErr } = await client.rpc('set_barber_google_calendar', {
          p_barber_name: b.name,
          p_calendar_id: calendarId,
        });
        if (!rpcErr) persisted = true;
      } catch {
        // Fallback a upsert directo
      }

      if (!persisted) {
        const { data: barberRow } = await client
          .from('barbers')
          .select('id, name')
          .ilike('name', b.name)
          .maybeSingle();

        if (barberRow?.id) {
          const { error: upsertErr } = await client
            .from('barber_google_calendars')
            .upsert(
              {
                barber_id: barberRow.id,
                calendar_id: calendarId,
                sync_enabled: true,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'barber_id' },
            );
          if (upsertErr) throw upsertErr;
          persisted = true;
        } else {
          throw new Error(`BARBER_NOT_FOUND: ${b.name}`);
        }
      }

      associations.push({
        barber: b.name,
        calendarId,
        variable: b.varName,
        persisted: true,
      });
    } catch (err: any) {
      errors.push(`Error asociando calendario de ${b.name}: ${err?.message || String(err)}`);
    }
  }

  return {
    success: errors.length === 0,
    associations,
    errors,
  };
}

/**
 * Concilia de forma inteligente y selectiva los trabajos de sincronización acumulados:
 * - Descarta reservas de prueba ficticias (SKIPPED).
 * - Descarta reservas canceladas que nunca se sincronizaron en Google (SKIPPED).
 * - Descarta reservas obsoletas del pasado sin sincronizar (SKIPPED).
 * - PRESERVA estrictamente en PENDING las reservas confirmadas legítimas futuras.
 */
export async function purgeStaleSyncItems(supabaseClient?: any): Promise<{
  staleItemsCount: number;
  skipped: boolean;
  reconciled?: {
    testAppointmentsSkipped: number;
    cancelledSkipped: number;
    pastAppointmentsSkipped: number;
    legitimateFuturePreserved: number;
  };
}> {
  const client = await getSyncSupabaseClient(supabaseClient);
  try {
    if (typeof client?.rpc === 'function') {
      const { data: rpcRes, error: rpcErr } = await client.rpc('reconcile_stale_calendar_sync_items');
      if (!rpcErr && rpcRes) {
        const testCount = Number(rpcRes.testAppointmentsSkipped || 0);
        const cancCount = Number(rpcRes.cancelledSkipped || 0);
        const pastCount = Number(rpcRes.pastAppointmentsSkipped || 0);
        const total = testCount + cancCount + pastCount;
        return {
          staleItemsCount: total,
          skipped: true,
          reconciled: rpcRes,
        };
      }
      if (rpcErr) {
        console.warn('[Calendar Sync] Error al invocar reconcile_stale_calendar_sync_items:', rpcErr.message);
      }
    }

    return { staleItemsCount: 0, skipped: false };
  } catch (err) {
    console.warn('[Calendar Sync] Fallback/Aviso al conciliar items antiguos:', err);
    return { staleItemsCount: 0, skipped: false };
  }
}

export type BarberCalendarVerificationResult = {
  barber: string;
  calendarId: string | null;
  accessible: boolean;
  calendarSummary?: string;
  error?: string;
  errorCode?: string;
  steps?: {
    create: boolean;
    read: boolean;
    delete: boolean;
    confirmDeleted: boolean;
  };
};

/**
 * Diagnostica con precisión el código de error devuelto por Google Calendar API:
 * - 401: problema de autenticación / token inválido o expirado.
 * - 403: permisos OAuth insuficientes o acceso denegado.
 * - 404: identificador de calendario incorrecto o inexistente.
 * - 429: límite de cuota temporal excedido.
 * - Otros errores.
 */
export function parseGoogleCalendarError(err: any): {
  code: 'AUTH_401' | 'FORBIDDEN_403' | 'NOT_FOUND_404' | 'RATE_LIMIT_429' | 'GOOGLE_ERROR';
  message: string;
} {
  const rawMsg = err instanceof Error ? err.message : String(err);

  if (
    rawMsg.includes('401') ||
    rawMsg.includes('GOOGLE_AUTH_TOKEN_MISSING') ||
    rawMsg.includes('Invalid Credentials') ||
    rawMsg.includes('invalid_grant')
  ) {
    return {
      code: 'AUTH_401',
      message: 'AUTH_FAILED_401: Sesión OAuth expirada o token inválido. Reautorice Google Calendar desde el panel.',
    };
  }

  if (
    rawMsg.includes('403') ||
    rawMsg.includes('insufficientPermissions') ||
    rawMsg.includes('accessDenied') ||
    rawMsg.includes('FORBIDDEN')
  ) {
    return {
      code: 'FORBIDDEN_403',
      message: 'PERMISSION_DENIED_403: Permisos OAuth insuficientes o acceso denegado al calendario. Verifique que la cuenta central de Kani tenga permisos de administración sobre este calendario.',
    };
  }

  if (rawMsg.includes('404') || rawMsg.includes('notFound')) {
    return {
      code: 'NOT_FOUND_404',
      message: 'CALENDAR_NOT_FOUND_404: Identificador de calendario incorrecto o calendario inexistente en Google Calendar.',
    };
  }

  if (rawMsg.includes('429') || rawMsg.includes('rateLimitExceeded')) {
    return {
      code: 'RATE_LIMIT_429',
      message: 'RATE_LIMIT_429: Cuota de peticiones excedida temporalmente en Google Calendar. Reintente en unos instantes.',
    };
  }

  return {
    code: 'GOOGLE_ERROR',
    message: `GOOGLE_API_ERROR: ${rawMsg}`,
  };
}

/**
 * Ejecuta una verificación controlada de lectura y escritura en un calendario individual mediante la Events API:
 * 1. Crear un evento temporal claramente identificado como auditoría técnica.
 * 2. Consultar el evento y verificar datos.
 * 3. Eliminar el evento temporal.
 * 4. Confirmar mediante la API que el evento ya no existe.
 * 
 * Regla de seguridad: Si falla cualquier operación, se ejecuta cleanup de emergencia para no dejar eventos residuales.
 */
export async function verifySingleBarberCalendar(
  calendarId: string,
  barberName: string,
  client: GoogleCalendarClient = new GoogleCalendarClient(),
): Promise<BarberCalendarVerificationResult> {
  const result: BarberCalendarVerificationResult = {
    barber: barberName,
    calendarId,
    accessible: false,
    steps: {
      create: false,
      read: false,
      delete: false,
      confirmDeleted: false,
    },
  };

  let createdEventId: string | null = null;

  try {
    // 0. Limpieza previa de eventos de auditoría previos
    try {
      if (typeof client.cleanupPreviousAuditEvents === 'function') {
        await client.cleanupPreviousAuditEvents(calendarId);
      }
    } catch {
      // Ignorar fallo de búsqueda previa
    }

    // 1. Crear evento temporal de verificación
    const verifyPayload: GoogleCalendarEventPayload = {
      summary: `[AUDIT-VERIFY] Verificación Kani Barber Studio (${barberName})`,
      description: `Evento temporal de verificación técnica de lectura y escritura para el calendario de ${barberName}. No corresponde a un turno real.`,
      start: {
        dateTime: '2026-11-10T12:00:00-03:00',
        timeZone: 'America/Argentina/Buenos_Aires',
      },
      end: {
        dateTime: '2026-11-10T12:30:00-03:00',
        timeZone: 'America/Argentina/Buenos_Aires',
      },
      visibility: 'private',
    };

    const created = await client.createEvent(calendarId, verifyPayload);
    if (!created?.id) {
      throw new Error('CREATE_EMPTY_RESPONSE: Google Calendar no devolvió identificador de evento.');
    }
    createdEventId = created.id;
    result.steps!.create = true;

    // 2. Consultar el evento (lectura)
    const readBack = await client.getEvent(calendarId, created.id);
    if (!readBack || readBack.status === 'cancelled') {
      throw new Error('READ_VERIFY_FAILED: El evento creado no pudo ser consultado desde Google Calendar.');
    }
    result.steps!.read = true;

    // 3. Eliminar el evento temporal
    const deleteRes = await client.deleteEvent(calendarId, created.id);
    if (!deleteRes.success && !deleteRes.alreadyDeleted) {
      throw new Error('DELETE_VERIFY_FAILED: No se pudo eliminar el evento temporal de prueba.');
    }
    result.steps!.delete = true;

    // 4. Confirmar que ya no existe (404 / cancelled)
    const postDeleteRead = await client.getEvent(calendarId, created.id);
    if (postDeleteRead !== null && postDeleteRead.status !== 'cancelled') {
      throw new Error('CONFIRM_DELETE_FAILED: El evento temporal figura todavía activo tras la eliminación.');
    }
    result.steps!.confirmDeleted = true;

    result.accessible = true;
    result.calendarSummary = 'Lectura y escritura verificadas (creación, consulta y eliminación OK)';
    return result;
  } catch (err: any) {
    // Cleanup de emergencia si el evento llegó a crearse
    if (createdEventId && !result.steps?.confirmDeleted) {
      try {
        await client.deleteEvent(calendarId, createdEventId);
      } catch (cleanupErr) {
        console.warn(`[Calendar Verify] Error en cleanup de emergencia (${barberName}):`, cleanupErr);
      }
    }

    const diag = parseGoogleCalendarError(err);
    result.error = diag.message;
    result.errorCode = diag.code;
    result.accessible = false;
    return result;
  }
}

/**
 * Verifica acceso y permisos a los 4 calendarios de Google de Kani (Lautaro, Gonzalo, Valentín, Franco)
 * mediante auditorías controladas de lectura y escritura en la Events API (100% compatible con calendar.events.owned)
 */
export async function verifyAllBarberCalendars(
  client: GoogleCalendarClient = new GoogleCalendarClient(),
  supabaseClient?: any,
): Promise<{
  allAccessible: boolean;
  calendars: BarberCalendarVerificationResult[];
}> {
  const sClient = await getSyncSupabaseClient(supabaseClient);
  const barbers = ['Lautaro', 'Gonzalo', 'Valentín', 'Franco'];
  const results: BarberCalendarVerificationResult[] = [];

  for (const b of barbers) {
    const calendarId = await resolveBarberCalendarId(b, sClient);
    if (!calendarId) {
      const normVar = b.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      results.push({
        barber: b,
        calendarId: null,
        accessible: false,
        errorCode: 'NOT_CONFIGURED',
        error: `CALENDAR_ID_NOT_CONFIGURED: La variable GOOGLE_CALENDAR_${normVar}_ID no está configurada en Cloudflare ni en barber_google_calendars.`,
      });
      continue;
    }

    const singleRes = await verifySingleBarberCalendar(calendarId, b, client);
    results.push(singleRes);
  }

  return {
    allAccessible: results.every(r => r.accessible),
    calendars: results,
  };
}

/**
 * Procesa en lote los elementos pendientes de la cola de sincronización.
 * Si GOOGLE_CALENDAR_SYNC_ENABLED no es true (Etapa 1), omite el procesamiento
 * salvo que se fuerce explícitamente en tests o mantenimiento.
 * 
 * Implementa concurrencia distribuida mediante reclamo transaccional con lease (SKIP LOCKED),
 * identificador único de worker (`claimed_by`) y recuperación de leases expirados.
 */
export async function processCalendarSyncQueue(
  options: ProcessQueueOptions = {},
): Promise<ProcessQueueResult> {
  // Prevención de concurrencia in-process (Mutex local adicional)
  if (isSyncInProgress && !options.force) {
    return {
      status: 'SKIPPED',
      processed: 0,
      synced: 0,
      failed: 0,
      skipped: 0,
      items: [],
      message: 'Sincronización omitida: otra ejecución ya se encuentra en progreso.',
    };
  }

  const authConfig = getGoogleCalendarAuthConfig();
  if (!authConfig.enabled && !options.force) {
    return {
      status: 'DISABLED',
      processed: 0,
      synced: 0,
      failed: 0,
      skipped: 0,
      items: [],
      message: 'Sincronización con Google Calendar deshabilitada por configuración (Etapa 1).',
    };
  }

  isSyncInProgress = true;
  try {
    const client = options.client || new GoogleCalendarClient();
    const supabaseClient = await getSyncSupabaseClient(options.supabaseClient);
    const workerId = `worker_${crypto.randomUUID().slice(0, 8)}_${Date.now()}`;

    // Reclamo transaccional obligatorio con SKIP LOCKED y leases
    // No se permite fallback al mecanismo antiguo. Una cola vacía es un resultado válido.
    const { data: claimed, error: claimErr } = await supabaseClient.rpc(
      'claim_pending_calendar_sync_jobs',
      {
        p_worker_id: workerId,
        p_limit: options.limit || 10,
        p_lease_seconds: 120,
      },
    );

    if (claimErr) {
      console.error('[Calendar Sync] Falló claim_pending_calendar_sync_jobs:', claimErr.message);
      return {
        status: 'ERROR',
        processed: 0,
        synced: 0,
        failed: 0,
        skipped: 0,
        items: [],
        message: `CLAIM_JOBS_FAILED: ${claimErr.message}`,
      };
    }

    const queueItems = (claimed || []) as (CalendarSyncQueueItem & { sync_version?: number })[];

    if (queueItems.length === 0) {
      return {
        status: 'SUCCESS',
        processed: 0,
        synced: 0,
        failed: 0,
        skipped: 0,
        items: [],
      };
    }

    const results: SyncItemResult[] = [];
    let synced = 0;
    let failed = 0;
    let skipped = 0;

    for (const item of queueItems) {
      const res = await syncQueueItem(item, client, supabaseClient, workerId);
      results.push(res);
      if (res.status === 'SYNCED') synced++;
      else if (res.status === 'FAILED') failed++;
      else skipped++;
    }

    const status: ProcessQueueResult['status'] =
      failed > 0 && synced > 0 ? 'PARTIAL' : failed > 0 ? 'ERROR' : 'SUCCESS';

    return {
      status,
      processed: results.length,
      synced,
      failed,
      skipped,
      items: results,
    };
  } finally {
    isSyncInProgress = false;
  }
}

export type ControlledAuditResult = {
  success: boolean;
  barber?: string;
  calendarVariable?: string;
  calendarId: string;
  steps: {
    access: boolean;
    create: boolean;
    read: boolean;
    update: boolean;
    delete: boolean;
    confirmDeleted?: boolean;
    operation1_create?: boolean;
    operation2_read?: boolean;
    operation3_update?: boolean;
    operation4_delete?: boolean;
    operation5_confirmDeleted?: boolean;
  };
  details: {
    createdEventId?: string;
    createdSummary?: string;
    verifiedSummary?: string;
    updatedSummary?: string;
    deleteStatus?: string;
    confirmedDeleted?: boolean;
    emergencyCleanup?: boolean;
    priorEventsCleaned?: number;
    executedAt?: string;
  };
  error?: string;
};

/**
 * Prueba controlada de 5 pasos requerida para la auditoría de Google Calendar:
 * 1. Crear un evento ficticio claramente identificado como prueba.
 * 2. Consultar el evento y comprobar sus datos.
 * 3. Actualizarlo y verificar el cambio.
 * 4. Eliminarlo.
 * 5. Confirmar mediante Google Calendar API que el evento ya no existe.
 * 
 * Regla de seguridad: Si alguna operación falla, se ejecuta cleanup de emergencia
 * para evitar dejar eventos ficticios sin eliminar en el calendario del barbero.
 */
export async function runGoogleCalendarControlledAudit(
  calendarId: string,
  client: GoogleCalendarClient = new GoogleCalendarClient(),
  barberName: string = 'Franco',
): Promise<ControlledAuditResult> {
  const normBarber = barberName.trim().toUpperCase();
  const calendarVariable = `GOOGLE_CALENDAR_${normBarber}_ID`;

  const result: ControlledAuditResult = {
    success: false,
    barber: barberName,
    calendarVariable,
    calendarId,
    steps: {
      access: false,
      create: false,
      read: false,
      update: false,
      delete: false,
      confirmDeleted: false,
      operation1_create: false,
      operation2_read: false,
      operation3_update: false,
      operation4_delete: false,
      operation5_confirmDeleted: false,
    },
    details: {
      executedAt: new Date().toISOString(),
    },
  };

  try {
    // Limpieza de seguridad previa por si alguna auditoría anterior dejó eventos huérfanos
    try {
      if (typeof client.cleanupPreviousAuditEvents === 'function') {
        const priorCleaned = await client.cleanupPreviousAuditEvents(calendarId);
        if (priorCleaned > 0) {
          result.details.priorEventsCleaned = priorCleaned;
        }
      }
    } catch {
      // Ignorar fallo en búsqueda previa
    }

    // 0. Acceso inicial
    result.steps.access = true;

    // 1. Crear un evento ficticio claramente identificado como prueba
    const auditPayload: GoogleCalendarEventPayload = {
      summary: '[AUDIT-TEST] Verificación Kani Barber Studio',
      description: `Evento ficticio temporal de auditoría técnica Kani Barber Studio (Barbero: ${barberName}). No corresponde a una reserva real.`,
      start: {
        dateTime: '2026-11-10T16:00:00-03:00',
        timeZone: 'America/Argentina/Buenos_Aires',
      },
      end: {
        dateTime: '2026-11-10T16:45:00-03:00',
        timeZone: 'America/Argentina/Buenos_Aires',
      },
      visibility: 'private',
    };

    const created = await client.createEvent(calendarId, auditPayload);
    result.steps.create = true;
    result.steps.operation1_create = true;
    result.details.createdEventId = created.id;
    result.details.createdSummary = created.summary || auditPayload.summary;

    // 2. Consultar el evento y comprobar sus datos
    const readBack = await client.getEvent(calendarId, created.id);
    if (!readBack || (readBack.summary !== auditPayload.summary && readBack.summary !== created.summary)) {
      throw new Error(`AUDIT_READ_FAILED: El evento leído no coincide con el creado.`);
    }
    result.steps.read = true;
    result.steps.operation2_read = true;
    result.details.verifiedSummary = readBack.summary;

    // 3. Actualizarlo y verificar el cambio
    const updatedPayload = {
      summary: '[AUDIT-TEST-UPDATED] Verificación Kani Barber Studio (Actualizado)',
    };
    const updated = await client.updateEvent(calendarId, created.id, updatedPayload);
    if (!updated || updated.summary !== updatedPayload.summary) {
      throw new Error(`AUDIT_UPDATE_FAILED: La actualización del evento no se reflejó.`);
    }
    result.steps.update = true;
    result.steps.operation3_update = true;
    result.details.updatedSummary = updated.summary;

    // 4. Eliminarlo
    const deleteRes = await client.deleteEvent(calendarId, created.id);
    result.steps.delete = true;
    result.steps.operation4_delete = true;
    result.details.deleteStatus = deleteRes.alreadyDeleted ? 'ALREADY_DELETED' : 'DELETED_204';

    // 5. Confirmar mediante Google Calendar API que el evento ya no existe
    const postDeleteRead = await client.getEvent(calendarId, created.id);
    if (postDeleteRead !== null && postDeleteRead.status !== 'cancelled') {
      throw new Error(`AUDIT_CONFIRM_DELETE_FAILED: El evento todavía existe tras ser eliminado.`);
    }
    result.steps.confirmDeleted = true;
    result.steps.operation5_confirmDeleted = true;
    result.details.confirmedDeleted = true;

    result.success = true;
    return result;
  } catch (err: any) {
    // Si alguna operación falla, evitar dejar eventos ficticios sin eliminar
    if (result.details.createdEventId && !result.details.confirmedDeleted) {
      try {
        await client.deleteEvent(calendarId, result.details.createdEventId);
        result.details.emergencyCleanup = true;
      } catch (cleanupErr) {
        console.warn('[Google Calendar Audit] Falló limpieza de emergencia de evento ficticio:', cleanupErr);
      }
    }
    result.error = err?.message || String(err);
    result.success = false;
    return result;
  }
}
