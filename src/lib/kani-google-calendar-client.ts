/**
 * KANI BARBER STUDIO — Cliente REST para Google Calendar API (v3)
 * 
 * Implementación ultraliviana para Cloudflare Workers / Node.js
 * Respeta rigurosamente las reglas de seguridad y privacidad:
 * - Sin envío de correos ni invitaciones a clientes (sendUpdates=none).
 * - Sin inclusión del cliente en el campo 'attendees'.
 * - Eventos configurados con visibilidad privada por defecto.
 * - Respuestas idempotentes ante borrados repetidos (404/410).
 */

import { getGoogleCalendarAccessToken, resolveFetchFn } from './kani-google-calendar-auth';

export type GoogleCalendarDateTime = {
  dateTime: string; // ISO RFC3339: YYYY-MM-DDTHH:mm:ss-03:00
  timeZone: string; // 'America/Argentina/Buenos_Aires'
};

export type GoogleCalendarEventPayload = {
  summary: string;
  description: string;
  start: GoogleCalendarDateTime;
  end: GoogleCalendarDateTime;
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  colorId?: string;
};

export type GoogleCalendarEventResponse = {
  id: string;
  status: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  start?: GoogleCalendarDateTime;
  end?: GoogleCalendarDateTime;
  updated?: string;
};

export type GoogleCalendarClientOptions = {
  fetchFn?: typeof fetch;
  tokenProvider?: () => Promise<string | null>;
};

export class GoogleCalendarClient {
  private fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  private tokenProvider: () => Promise<string | null>;

  constructor(options: GoogleCalendarClientOptions = {}) {
    const rawFetch = resolveFetchFn(options.fetchFn);
    // Preservar la vinculación y evitar pasar `this` de la clase al native fetch de V8/Cloudflare
    this.fetchFn = (input, init) => rawFetch(input, init);
    this.tokenProvider = options.tokenProvider || (() => getGoogleCalendarAccessToken(this.fetchFn));
  }

  /**
   * Limpia eventos ficticios de auditoría previos que hayan quedado sin eliminar
   */
  async cleanupPreviousAuditEvents(calendarId: string): Promise<number> {
    if (!calendarId) return 0;
    try {
      const headers = await this.getAuthHeaders();
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?q=%5BAUDIT-TEST%5D&maxResults=15&sendUpdates=none`;
      const res = await this.fetchFn(url, { method: 'GET', headers });
      if (!res.ok) return 0;
      const data = (await res.json()) as { items?: Array<{ id: string; summary?: string }> };
      const items = data.items || [];
      let cleaned = 0;
      for (const item of items) {
        if (item.id && (item.summary?.includes('[AUDIT-TEST]') || item.summary?.includes('Verificación Kani Barber Studio'))) {
          await this.deleteEvent(calendarId, item.id);
          cleaned++;
        }
      }
      return cleaned;
    } catch {
      return 0;
    }
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.tokenProvider();
    if (!token) {
      throw new Error('GOOGLE_AUTH_TOKEN_MISSING: No hay token de acceso disponible.');
    }
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Crea un nuevo evento en el calendario indicado
   */
  async createEvent(
    calendarId: string,
    event: GoogleCalendarEventPayload,
  ): Promise<GoogleCalendarEventResponse> {
    if (!calendarId) throw new Error('CALENDAR_ID_REQUIRED');
    const headers = await this.getAuthHeaders();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`;

    const res = await this.fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...event,
        visibility: event.visibility || 'private',
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`GOOGLE_CALENDAR_CREATE_FAILED_${res.status}: ${errBody}`);
    }

    return (await res.json()) as GoogleCalendarEventResponse;
  }

  /**
   * Actualiza un evento existente mediante PATCH (idempotente)
   */
  async updateEvent(
    calendarId: string,
    eventId: string,
    event: Partial<GoogleCalendarEventPayload>,
  ): Promise<GoogleCalendarEventResponse> {
    if (!calendarId) throw new Error('CALENDAR_ID_REQUIRED');
    if (!eventId) throw new Error('EVENT_ID_REQUIRED');
    const headers = await this.getAuthHeaders();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`;

    const res = await this.fetchFn(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(event),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`GOOGLE_CALENDAR_UPDATE_FAILED_${res.status}: ${errBody}`);
    }

    return (await res.json()) as GoogleCalendarEventResponse;
  }

  /**
   * Elimina un evento de Google Calendar.
   * Si el evento ya fue eliminado o no existe (404 o 410 Gone), se considera éxito idempotente.
   */
  async deleteEvent(
    calendarId: string,
    eventId: string,
  ): Promise<{ success: boolean; alreadyDeleted: boolean }> {
    if (!calendarId) throw new Error('CALENDAR_ID_REQUIRED');
    if (!eventId) throw new Error('EVENT_ID_REQUIRED');
    const headers = await this.getAuthHeaders();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`;

    const res = await this.fetchFn(url, {
      method: 'DELETE',
      headers,
    });

    if (res.status === 204 || res.status === 200) {
      return { success: true, alreadyDeleted: false };
    }

    if (res.status === 404 || res.status === 410) {
      return { success: true, alreadyDeleted: true };
    }

    const errBody = await res.text();
    throw new Error(`GOOGLE_CALENDAR_DELETE_FAILED_${res.status}: ${errBody}`);
  }

  /**
   * Lee un evento específico de Google Calendar
   */
  async getEvent(
    calendarId: string,
    eventId: string,
  ): Promise<GoogleCalendarEventResponse | null> {
    if (!calendarId) throw new Error('CALENDAR_ID_REQUIRED');
    if (!eventId) throw new Error('EVENT_ID_REQUIRED');
    const headers = await this.getAuthHeaders();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

    const res = await this.fetchFn(url, {
      method: 'GET',
      headers,
    });

    if (res.status === 404 || res.status === 410) {
      return null;
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`GOOGLE_CALENDAR_GET_FAILED_${res.status}: ${errBody}`);
    }

    return (await res.json()) as GoogleCalendarEventResponse;
  }

  /**
   * Obtiene la metadata del calendario para validar existencia y permisos
   */
  async getCalendar(
    calendarId: string,
  ): Promise<{ id: string; summary?: string; timeZone?: string } | null> {
    if (!calendarId) return null;
    const headers = await this.getAuthHeaders();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`;

    const res = await this.fetchFn(url, {
      method: 'GET',
      headers,
    });

    if (res.status === 404 || res.status === 403) {
      return null;
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`GOOGLE_CALENDAR_GET_CALENDAR_FAILED_${res.status}: ${errBody}`);
    }

    return (await res.json()) as { id: string; summary?: string; timeZone?: string };
  }
}
