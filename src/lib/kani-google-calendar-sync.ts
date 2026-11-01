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
  request_number: number | null;
  client_name: string;
  service_name: string;
  custom_service_name: string | null;
  service_price_ars: number | null;
  deposit_paid: boolean;
  deposit_amount_ars: number | null;
};

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
  item: CalendarSyncQueueItem,
  client: GoogleCalendarClient,
  supabaseClient: any = defaultSupabase,
): Promise<SyncItemResult> {
  try {
    const effectiveCalendarId =
      item.calendar_id || (await resolveBarberCalendarId(item.barber_name, supabaseClient));

    // 1. Manejo de DELETE
    if (item.sync_action === 'DELETE') {
      if (effectiveCalendarId && item.google_event_id) {
        await client.deleteEvent(effectiveCalendarId, item.google_event_id);
      }
      await supabaseClient.rpc('record_calendar_sync_success', {
        p_sync_id: item.sync_id,
        p_google_event_id: null,
        p_calendar_id: effectiveCalendarId,
        p_checksum: null,
      });
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
      await supabaseClient.rpc('record_calendar_sync_failure', {
        p_sync_id: item.sync_id,
        p_error: err,
      });
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

    // 2.1 Caso cambio de barbero: Eliminar evento del calendario anterior
    if (item.previous_calendar_id && item.previous_google_event_id) {
      try {
        await client.deleteEvent(item.previous_calendar_id, item.previous_google_event_id);
      } catch (delError) {
        console.warn(`[Kani Calendar Sync] Aviso al remover evento previo en cambio de barbero:`, delError);
      }
    }

    let resultingEventId = item.google_event_id;

    // 2.2 Si ya existe google_event_id, actualizar (PATCH) si cambió el contenido
    if (item.google_event_id) {
      if (item.payload_checksum === checksum) {
        // Idempotencia: el evento ya está exactamente sincronizado
        await supabaseClient.rpc('record_calendar_sync_success', {
          p_sync_id: item.sync_id,
          p_google_event_id: item.google_event_id,
          p_calendar_id: effectiveCalendarId,
          p_checksum: checksum,
        });
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
      // 2.3 Si no existe, crear nuevo evento (POST)
      const created = await client.createEvent(effectiveCalendarId, payload);
      resultingEventId = created.id;
    }

    await supabaseClient.rpc('record_calendar_sync_success', {
      p_sync_id: item.sync_id,
      p_google_event_id: resultingEventId,
      p_calendar_id: effectiveCalendarId,
      p_checksum: checksum,
    });

    return {
      syncId: item.sync_id,
      appointmentId: item.appointment_id,
      status: 'SYNCED',
      action: 'UPSERT',
      googleEventId: resultingEventId || undefined,
    };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    await supabaseClient.rpc('record_calendar_sync_failure', {
      p_sync_id: item.sync_id,
      p_error: errorMsg,
    });
    return {
      syncId: item.sync_id,
      appointmentId: item.appointment_id,
      status: 'FAILED',
      action: item.sync_action,
      error: errorMsg,
    };
  }
}

export type ProcessQueueOptions = {
  limit?: number;
  force?: boolean;
  client?: GoogleCalendarClient;
  supabaseClient?: any;
};

export type ProcessQueueResult = {
  status: 'SUCCESS' | 'DISABLED' | 'PARTIAL' | 'ERROR';
  processed: number;
  synced: number;
  failed: number;
  skipped: number;
  items: SyncItemResult[];
  message?: string;
};

/**
 * Procesa en lote los elementos pendientes de la cola de sincronización.
 * Si GOOGLE_CALENDAR_SYNC_ENABLED no es true (Etapa 1), omite el procesamiento
 * salvo que se fuerce explícitamente en tests.
 */
export async function processCalendarSyncQueue(
  options: ProcessQueueOptions = {},
): Promise<ProcessQueueResult> {
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

  const client = options.client || new GoogleCalendarClient();
  const supabaseClient = options.supabaseClient || defaultSupabase;

  const { data: items, error } = await supabaseClient.rpc('get_pending_calendar_sync_items', {
    p_limit: options.limit || 10,
  });

  if (error) {
    throw new Error(`GET_PENDING_SYNC_ITEMS_FAILED: ${error.message}`);
  }

  const queueItems = (items || []) as CalendarSyncQueueItem[];
  const results: SyncItemResult[] = [];

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of queueItems) {
    const res = await syncQueueItem(item, client, supabaseClient);
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
