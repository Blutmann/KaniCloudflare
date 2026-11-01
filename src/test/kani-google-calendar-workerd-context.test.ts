/**
 * KANI BARBER STUDIO — Regression Test: Cloudflare Workers Native fetch `this` Context
 * 
 * Verifica que las invocaciones a `fetch` dentro de:
 * - GoogleCalendarClient
 * - requestOAuth2AccessToken
 * - getGoogleCalendarAccessToken
 * - runGoogleCalendarControlledAudit
 * mantengan la vinculación correcta a `globalThis` y no lancen
 * "TypeError: Illegal invocation: function called with incorrect this reference."
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleCalendarClient } from '@/lib/kani-google-calendar-client';
import {
  requestOAuth2AccessToken,
  getGoogleCalendarAccessToken,
  clearGoogleTokenCache,
  safeWorkerFetch,
  resolveFetchFn,
} from '@/lib/kani-google-calendar-auth';
import { runGoogleCalendarControlledAudit } from '@/lib/kani-google-calendar-sync';

describe('Cloudflare Workers Native fetch Context Preservation (Illegal Invocation Regression)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearGoogleTokenCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearGoogleTokenCache();
  });

  it('1. Simula el comportamiento estricto de Cloudflare Workers (workerd) ante un `this` incorrecto', async () => {
    // Definir un fetch simulador de Cloudflare Workers que exige this === globalThis
    const workerdFetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation: function called with incorrect this reference.');
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };

    // Invocado como método de un objeto arbitrario falla
    const dummyObj = { fetchFn: workerdFetch };
    expect(() => dummyObj.fetchFn('https://example.com')).toThrowError(/Illegal invocation/);

    // Con resolveFetchFn / safeWorkerFetch se preserva globalThis y tiene éxito
    globalThis.fetch = workerdFetch as any;
    const boundFetch = resolveFetchFn();
    const res = await boundFetch('https://example.com');
    expect(res.status).toBe(200);
  });

  it('2. requestOAuth2AccessToken se ejecuta sin "Illegal invocation" bajo entorno tipo workerd', async () => {
    const workerdFetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation: function called with incorrect this reference.');
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'mock_valid_token_123',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/calendar.events.owned',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    };

    globalThis.fetch = workerdFetch as any;

    const tokenRes = await requestOAuth2AccessToken(
      'mock_client_id',
      'mock_client_secret',
      'mock_refresh_token',
    );

    expect(tokenRes.accessToken).toBe('mock_valid_token_123');
  });

  it('3. GoogleCalendarClient ejecuta create, get, update y delete sin "Illegal invocation"', async () => {
    let storedEvent: any = null;

    const workerdFetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      // Regla estricta de workerd / V8
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation: function called with incorrect this reference.');
      }

      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method || 'GET';

      if (url.includes('/events') && method === 'POST') {
        const body = JSON.parse(init?.body as string);
        storedEvent = { id: 'evt_workerd_test_01', ...body };
        return Promise.resolve(new Response(JSON.stringify(storedEvent), { status: 200 }));
      }

      if (url.includes('/events/evt_workerd_test_01') && method === 'GET') {
        if (!storedEvent) {
          return Promise.resolve(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
        }
        return Promise.resolve(new Response(JSON.stringify(storedEvent), { status: 200 }));
      }

      if (url.includes('/events/evt_workerd_test_01') && method === 'PATCH') {
        const patch = JSON.parse(init?.body as string);
        storedEvent = { ...storedEvent, ...patch };
        return Promise.resolve(new Response(JSON.stringify(storedEvent), { status: 200 }));
      }

      if (url.includes('/events/evt_workerd_test_01') && method === 'DELETE') {
        storedEvent = null;
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    };

    globalThis.fetch = workerdFetch as any;

    const client = new GoogleCalendarClient({
      tokenProvider: () => Promise.resolve('mock_access_token_abc'),
    });

    // 1. Create
    const created = await client.createEvent('c_franco@group.calendar.google.com', {
      summary: '[AUDIT-TEST] Verificación Kani Barber Studio',
      description: 'Prueba de contexto workerd',
      start: { dateTime: '2026-11-10T16:00:00-03:00', timeZone: 'America/Argentina/Buenos_Aires' },
      end: { dateTime: '2026-11-10T16:45:00-03:00', timeZone: 'America/Argentina/Buenos_Aires' },
      visibility: 'private',
    });
    expect(created.id).toBe('evt_workerd_test_01');

    // 2. Read
    const read = await client.getEvent('c_franco@group.calendar.google.com', 'evt_workerd_test_01');
    expect(read?.summary).toBe('[AUDIT-TEST] Verificación Kani Barber Studio');

    // 3. Update
    const updated = await client.updateEvent('c_franco@group.calendar.google.com', 'evt_workerd_test_01', {
      summary: '[AUDIT-TEST-UPDATED] Verificación Kani Barber Studio (Actualizado)',
    });
    expect(updated.summary).toBe('[AUDIT-TEST-UPDATED] Verificación Kani Barber Studio (Actualizado)');

    // 4. Delete
    const deleted = await client.deleteEvent('c_franco@group.calendar.google.com', 'evt_workerd_test_01');
    expect(deleted.success).toBe(true);

    // 5. Confirm Deleted (404)
    const postDelete = await client.getEvent('c_franco@group.calendar.google.com', 'evt_workerd_test_01');
    expect(postDelete).toBeNull();
  });

  it('4. runGoogleCalendarControlledAudit completa los 5 pasos sin errores bajo fetch estricto', async () => {
    let mockStore: Record<string, any> = {};

    const workerdFetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation: function called with incorrect this reference.');
      }

      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method || 'GET';

      if (url.includes('q=%5BAUDIT-TEST%5D')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }

      if (url.includes('/events') && method === 'POST') {
        const body = JSON.parse(init?.body as string);
        const id = 'evt_audit_seq_1';
        mockStore[id] = { id, ...body };
        return Promise.resolve(new Response(JSON.stringify(mockStore[id]), { status: 200 }));
      }

      if (url.includes('/events/evt_audit_seq_1') && method === 'GET') {
        const event = mockStore['evt_audit_seq_1'];
        if (!event) return Promise.resolve(new Response(null, { status: 404 }));
        return Promise.resolve(new Response(JSON.stringify(event), { status: 200 }));
      }

      if (url.includes('/events/evt_audit_seq_1') && method === 'PATCH') {
        const patch = JSON.parse(init?.body as string);
        mockStore['evt_audit_seq_1'] = { ...mockStore['evt_audit_seq_1'], ...patch };
        return Promise.resolve(new Response(JSON.stringify(mockStore['evt_audit_seq_1']), { status: 200 }));
      }

      if (url.includes('/events/evt_audit_seq_1') && method === 'DELETE') {
        delete mockStore['evt_audit_seq_1'];
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    };

    globalThis.fetch = workerdFetch as any;

    const client = new GoogleCalendarClient({
      tokenProvider: () => Promise.resolve('mock_token_workerd'),
    });

    const result = await runGoogleCalendarControlledAudit(
      'c_franco@group.calendar.google.com',
      client,
      'Franco',
    );

    expect(result.success).toBe(true);
    expect(result.steps.operation1_create).toBe(true);
    expect(result.steps.operation2_read).toBe(true);
    expect(result.steps.operation3_update).toBe(true);
    expect(result.steps.operation4_delete).toBe(true);
    expect(result.steps.operation5_confirmDeleted).toBe(true);
    expect(result.details.confirmedDeleted).toBe(true);
  });
});
