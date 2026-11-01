import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createOAuthState,
  verifyOAuthState,
  generateOAuthAuthorizationUrl,
  exchangeOAuthCodeForTokens,
  getGoogleCalendarAccessToken,
  saveStoredOAuthTokens,
  getStoredOAuthTokens,
  clearGoogleTokenCache,
  GOOGLE_CALENDAR_DEFAULT_SCOPE,
} from '@/lib/kani-google-calendar-auth';
import {
  handleGoogleCalendarAuthorize,
  handleGoogleCalendarCallback,
  handleGoogleCalendarIntegrationStatus,
} from '@/lib/kani-google-calendar-oauth.server';

describe('KANI Barber Studio — OAuth 2.0 Centralizado para Google Calendar', () => {
  const secretKey = 'test_secret_hmac_key_for_oauth_testing_only';

  beforeEach(() => {
    vi.clearAllMocks();
    clearGoogleTokenCache();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    delete process.env.GOOGLE_CALENDAR_SYNC_ENABLED;
  });

  describe('1. Protección CSRF y Generación / Verificación de State', () => {
    it('genera un state firmado con HMAC-SHA256 y un nonce aleatorio', async () => {
      const { state, nonce } = await createOAuthState('admin-user-uuid', secretKey);

      expect(state).toBeDefined();
      expect(state).toContain('.');
      expect(nonce).toBeDefined();
      expect(nonce.length).toBeGreaterThan(10);

      // Verificación exitosa con el nonce y secret correctos
      const verification = await verifyOAuthState(state, secretKey, nonce);
      expect(verification.valid).toBe(true);
      expect(verification.adminUserId).toBe('admin-user-uuid');
    });

    it('rechaza un state adulterado o con firma incorrecta (ataque de manipulación)', async () => {
      const { state, nonce } = await createOAuthState('admin-user-uuid', secretKey);
      const tamperedState = `${state.slice(0, -4)}xxxx`;

      const verification = await verifyOAuthState(tamperedState, secretKey, nonce);
      expect(verification.valid).toBe(false);
      expect(verification.error).toBe('STATE_SIGNATURE_MISMATCH');
    });

    it('rechaza un state cuando el nonce de la cookie no coincide (ataque CSRF cross-browser)', async () => {
      const { state } = await createOAuthState('admin-user-uuid', secretKey);
      const forgedCookieNonce = 'forged-attacker-nonce-uuid';

      const verification = await verifyOAuthState(state, secretKey, forgedCookieNonce);
      expect(verification.valid).toBe(false);
      expect(verification.error).toBe('STATE_NONCE_COOKIE_MISMATCH');
    });

    it('rechaza un state expirado (> 10 minutos)', async () => {
      const { state, nonce } = await createOAuthState('admin-user-uuid', secretKey);
      // Simulamos maxAge 0 ms para verificar expiración
      const verification = await verifyOAuthState(state, secretKey, nonce, 0);
      expect(verification.valid).toBe(false);
      expect(verification.error).toBe('STATE_EXPIRED');
    });
  });

  describe('2. Generación de URL de Autorización (Offline Access & Consent)', () => {
    it('solicita acceso offline, prompt=consent y el permiso calendar.events.owned', () => {
      const urlStr = generateOAuthAuthorizationUrl({
        clientId: 'kani-client-id-123.apps.googleusercontent.com',
        redirectUri: 'https://kanibarberstudio-cloudflare.kanibarber.workers.dev/api/integrations/google-calendar/callback',
        state: 'signed.state.token',
      });

      const url = new URL(urlStr);
      expect(url.origin).toBe('https://accounts.google.com');
      expect(url.pathname).toBe('/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe('kani-client-id-123.apps.googleusercontent.com');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('scope')).toBe(GOOGLE_CALENDAR_DEFAULT_SCOPE);
      expect(url.searchParams.get('state')).toBe('signed.state.token');
    });
  });

  describe('3. Autorización Exclusiva de ADMIN (/authorize)', () => {
    function createMockSupabaseAdmin(role: 'ADMIN' | 'BARBER' | null, active = true) {
      return {
        auth: {
          getUser: vi.fn().mockImplementation((token: string) => {
            if (token === 'valid-admin-jwt' || token === 'valid-barber-jwt') {
              return Promise.resolve({
                data: { user: { id: 'user-uuid-1', email: 'test@kanibarber.com' } },
                error: null,
              });
            }
            return Promise.resolve({ data: { user: null }, error: new Error('Invalid token') });
          }),
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'staff_profiles') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve(
                      role
                        ? { data: { role, active }, error: null }
                        : { data: null, error: null },
                    ),
                }),
              }),
            };
          }
          return {};
        }),
      };
    }

    it('rechaza solicitudes no autenticadas con HTTP 403', async () => {
      const req = new Request('https://kanibarber.com/api/integrations/google-calendar/authorize');
      const res = await handleGoogleCalendarAuthorize(req, createMockSupabaseAdmin(null));

      expect(res.status).toBe(403);
      const text = await res.text();
      expect(text).toContain('AUTH_REQUIRED');
    });

    it('rechaza solicitudes de usuarios BARBER (no admin) con HTTP 403', async () => {
      const req = new Request('https://kanibarber.com/api/integrations/google-calendar/authorize?token=valid-barber-jwt');
      const res = await handleGoogleCalendarAuthorize(req, createMockSupabaseAdmin('BARBER'));

      expect(res.status).toBe(403);
      const text = await res.text();
      expect(text).toContain('ACCESS_DENIED');
    });

    it('permite a un ADMIN iniciar el flujo, seteando cookie y redirigiendo 302 a Google', async () => {
      process.env.GOOGLE_CLIENT_ID = 'kani-google-client-id-123';
      process.env.SUPABASE_SERVICE_ROLE_KEY = secretKey;

      const req = new Request(
        'https://kanibarberstudio-cloudflare.kanibarber.workers.dev/api/integrations/google-calendar/authorize?token=valid-admin-jwt',
      );
      const res = await handleGoogleCalendarAuthorize(req, createMockSupabaseAdmin('ADMIN'));

      expect(res.status).toBe(302);
      const location = res.headers.get('Location');
      expect(location).toBeDefined();
      expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(location).toContain('client_id=kani-google-client-id-123');
      expect(location).toContain('access_type=offline');
      expect(location).toContain('prompt=consent');

      const setCookie = res.headers.get('Set-Cookie');
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain('kani_gcal_oauth_state=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Lax');
    });
  });

  describe('4. Callback OAuth (/callback) y Almacenamiento Seguro', () => {
    it('rechaza callbacks con error reportado por Google (ej. consentimiento cancelado)', async () => {
      const req = new Request('https://kanibarber.com/api/integrations/google-calendar/callback?error=access_denied&error_description=User+cancelled');
      const res = await handleGoogleCalendarCallback(req);

      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain('Autorización Cancelada');
    });

    it('rechaza callbacks con state CSRF inválido', async () => {
      const req = new Request('https://kanibarber.com/api/integrations/google-calendar/callback?code=some-code&state=invalid.tampered.state');
      const res = await handleGoogleCalendarCallback(req);

      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain('Validación de Seguridad Fallida');
    });

    it('intercambia exitosamente el código, guarda el refresh token y renderiza confirmación', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
      process.env.SUPABASE_SERVICE_ROLE_KEY = secretKey;

      const { state, nonce } = await createOAuthState('admin-123', secretKey);

      // Mock de Supabase para guardar tokens en tabla segura
      const mockUpsert = vi.fn().mockResolvedValue({ error: null });
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'google_calendar_oauth_tokens') {
            return {
              upsert: mockUpsert,
              select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
            };
          }
          return {};
        },
      };

      // Mock de fetch a Google token endpoint
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.test_access_token',
          refresh_token: '1//0g_test_refresh_token',
          expires_in: 3600,
          scope: GOOGLE_CALENDAR_DEFAULT_SCOPE,
          token_type: 'Bearer',
        }),
      });

      const callbackUrl = `https://kanibarberstudio-cloudflare.kanibarber.workers.dev/api/integrations/google-calendar/callback?code=google_auth_code_xyz&state=${encodeURIComponent(state)}`;
      const req = new Request(callbackUrl, {
        headers: {
          Cookie: `kani_gcal_oauth_state=${nonce}`,
        },
      });

      const res = await handleGoogleCalendarCallback(req, {
        customSupabaseClient: mockSupabase,
        fetchFn: mockFetch as any,
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Google Calendar Conectado con Éxito');
      expect(text).toContain(GOOGLE_CALENDAR_DEFAULT_SCOPE);

      // Verificamos que se guardó en la tabla segura con service_role y cifrado AES-GCM
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'primary',
          refresh_token: expect.stringMatching(/^enc:v1:/),
          access_token: 'ya29.test_access_token',
          scope: GOOGLE_CALENDAR_DEFAULT_SCOPE,
        }),
        { onConflict: 'id' },
      );

      // La cookie de estado se limpió
      expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    });
  });

  describe('5. Renovación Automática de Access Tokens', () => {
    it('renueva automáticamente un token expirado leyendo el refresh_token de la base de datos', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

      // Base de datos tiene un token expirado (hace 10 minutos)
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'google_calendar_oauth_tokens') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'primary',
                        refresh_token: 'stored_db_refresh_token_123',
                        access_token: 'old_expired_access_token',
                        expires_at: new Date(Date.now() - 600_000).toISOString(),
                        scope: GOOGLE_CALENDAR_DEFAULT_SCOPE,
                      },
                      error: null,
                    }),
                }),
              }),
              upsert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          return {};
        },
      };

      // Mock de Google OAuth refresh
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.fresh_renewed_access_token',
          expires_in: 3600,
          scope: GOOGLE_CALENDAR_DEFAULT_SCOPE,
        }),
      });

      const token = await getGoogleCalendarAccessToken(mockFetch as any, mockSupabase);

      expect(token).toBe('ya29.fresh_renewed_access_token');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('grant_type=refresh_token'),
        }),
      );
    });

    it('utiliza el token en caché si aún no ha expirado sin hacer llamadas a Google', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

      // Base de datos tiene un token vigente por 30 minutos más
      const mockSupabase = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'primary',
                    refresh_token: 'stored_db_refresh_token_123',
                    access_token: 'valid_unexpired_token',
                    expires_at: new Date(Date.now() + 1_800_000).toISOString(),
                    scope: GOOGLE_CALENDAR_DEFAULT_SCOPE,
                  },
                  error: null,
                }),
            }),
          }),
        }),
      };

      const mockFetch = vi.fn();
      const token = await getGoogleCalendarAccessToken(mockFetch as any, mockSupabase);

      expect(token).toBe('valid_unexpired_token');
      // No debe llamar a Google
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('6. Endpoint de Diagnóstico de Integración (/status)', () => {
    it('informa correctamente el estado de configuración y la URL de redireccionamiento esperada', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

      const mockSupabase = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'primary',
                    refresh_token: 'some_refresh_token',
                    scope: GOOGLE_CALENDAR_DEFAULT_SCOPE,
                    updated_at: '2026-11-01T15:00:00Z',
                  },
                  error: null,
                }),
            }),
          }),
        }),
      };

      const req = new Request('https://kanibarberstudio-cloudflare.kanibarber.workers.dev/api/integrations/google-calendar/status');
      const res = await handleGoogleCalendarIntegrationStatus(req, mockSupabase);

      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.configured).toBe(true);
      expect(json.authorized).toBe(true);
      expect(json.strategy).toBe('OAUTH2');
      expect(json.redirectUri).toBe('https://kanibarberstudio-cloudflare.kanibarber.workers.dev/api/integrations/google-calendar/callback');
      expect(json.syncEnabled).toBe(false); // Sincronización automática deshabilitada en Etapa 1
    });
  });
});
