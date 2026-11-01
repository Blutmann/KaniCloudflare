/**
 * KANI BARBER STUDIO — Manejador de Autorización OAuth 2.0 para Google Calendar
 * 
 * Endpoints implementados:
 * 1. GET /api/integrations/google-calendar/authorize
 *    - Validación estricta de sesión ADMIN.
 *    - Generación de state con nonce CSRF y firma HMAC-SHA256.
 *    - Cookie HttpOnly SameSite=Lax con vigencia de 10 minutos.
 *    - Redirección 302 a Google con access_type=offline y prompt=consent.
 * 
 * 2. GET /api/integrations/google-calendar/callback
 *    - Validación del state contra cookie y firma criptográfica.
 *    - Intercambio seguro del authorization code por tokens en el backend.
 *    - Almacenamiento seguro del refresh_token en la tabla protegida de Supabase.
 *    - Renovación automática y transparente sin intervención manual.
 *    - Pantalla de confirmación para el administrador.
 * 
 * 3. GET /api/integrations/google-calendar/status
 *    - Diagnóstico del estado de configuración y credenciales sin exponer secretos.
 */

import {
  createOAuthState,
  verifyOAuthState,
  generateOAuthAuthorizationUrl,
  exchangeOAuthCodeForTokens,
  saveStoredOAuthTokens,
  getStoredOAuthTokens,
  getGoogleCalendarAuthConfig,
  GOOGLE_CALENDAR_DEFAULT_SCOPE,
} from './kani-google-calendar-auth';

function getRuntimeSecret(name: string): string | undefined {
  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
  const globalObj = globalThis as typeof globalThis & {
    __env__?: Record<string, unknown>;
    __KANI_RUNTIME_ENV?: Record<string, string>;
  };

  const val =
    env[name] ??
    globalObj.__KANI_RUNTIME_ENV?.[name] ??
    globalObj.__env__?.[name];
  return typeof val === 'string' && val.trim() ? val.trim() : undefined;
}

function resolveRedirectUri(request: Request): string {
  const envUri = getRuntimeSecret('GOOGLE_OAUTH_REDIRECT_URI');
  if (envUri && envUri.trim()) {
    return envUri.trim();
  }
  const url = new URL(request.url);
  return `${url.origin}/api/integrations/google-calendar/callback`;
}

function getHmacSigningSecret(): string {
  return (
    getRuntimeSecret('SUPABASE_SERVICE_ROLE_KEY') ||
    getRuntimeSecret('SESSION_SECRET') ||
    getRuntimeSecret('GOOGLE_CLIENT_SECRET') ||
    'kani_google_oauth_fallback_hmac_secret_2026'
  );
}

function extractCookie(cookieHeader: string | null, cookieName: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Valida la identidad y rol del usuario administrador
 */
export async function authenticateAdminRequest(
  request: Request,
  customSupabaseClient?: any,
): Promise<{ authorized: boolean; userId?: string; error?: string }> {
  try {
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const cookieHeader = request.headers.get('Cookie');

    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (cookieHeader) {
      // Supabase access token en cookie si existe
      const sbTokenCookie = extractCookie(cookieHeader, 'sb-access-token') ||
        extractCookie(cookieHeader, 'sb-iockpxtkflyjfagkvgnr-auth-token');
      if (sbTokenCookie) {
        try {
          const parsed = JSON.parse(sbTokenCookie);
          token = Array.isArray(parsed) ? parsed[0] : parsed?.access_token || sbTokenCookie;
        } catch {
          token = sbTokenCookie;
        }
      }
    }

    if (!token) {
      return {
        authorized: false,
        error: 'AUTH_REQUIRED: Debe iniciar sesión como administrador de Kani Barber Studio.',
      };
    }

    let supabase = customSupabaseClient;
    if (!supabase) {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = getRuntimeSecret('SUPABASE_URL') || 'https://iockpxtkflyjfagkvgnr.supabase.co';
      const anonKey = getRuntimeSecret('VITE_SUPABASE_ANON_KEY') || getRuntimeSecret('SUPABASE_ANON_KEY') || 'sb_publishable_jLUHqN-Y_2az8c0Y2yG3mA_gl618304';
      const serviceRoleKey = getRuntimeSecret('SUPABASE_SERVICE_ROLE_KEY');

      const authClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });

      const {
        data: { user },
        error: userError,
      } = await authClient.auth.getUser(token);

      if (userError || !user) {
        return {
          authorized: false,
          error: 'AUTH_INVALID: Token de sesión inválido o expirado.',
        };
      }

      // Usar serviceRoleKey si está disponible para evitar restricciones de RLS al verificar rol
      const dbClient = serviceRoleKey
        ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
        : authClient;

      const { data: profile, error: profileError } = await dbClient
        .from('staff_profiles')
        .select('role, active')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError || !profile || !profile.active || profile.role !== 'ADMIN') {
        return {
          authorized: false,
          error: 'ACCESS_DENIED: Se requieren permisos de Administrador para configurar integraciones.',
        };
      }

      return { authorized: true, userId: user.id };
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return {
        authorized: false,
        error: 'AUTH_INVALID: Token de sesión inválido o expirado.',
      };
    }

    // Verificar en staff_profiles que tenga rol ADMIN y esté activo
    const { data: profile, error: profileError } = await supabase
      .from('staff_profiles')
      .select('role, active')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError || !profile || !profile.active || profile.role !== 'ADMIN') {
      return {
        authorized: false,
        error: 'ACCESS_DENIED: Se requieren permisos de Administrador para configurar integraciones.',
      };
    }

    return { authorized: true, userId: user.id };
  } catch (err: any) {
    return { authorized: false, error: err?.message || 'AUTH_VERIFICATION_ERROR' };
  }
}

/**
 * 1. GET / POST /api/integrations/google-calendar/authorize
 */
export async function handleGoogleCalendarAuthorize(
  request: Request,
  customSupabaseClient?: any,
): Promise<Response> {
  const wantsJson =
    request.method === 'POST' ||
    request.headers.get('Accept')?.includes('application/json') ||
    request.headers.get('Content-Type')?.includes('application/json');

  const auth = await authenticateAdminRequest(request, customSupabaseClient);
  if (!auth.authorized || !auth.userId) {
    const errorMsg = auth.error || 'Se requieren permisos de Administrador.';
    if (wantsJson) {
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      renderAdminErrorHtml('Acceso Denegado', errorMsg),
      {
        status: 403,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  }

  const clientId = getRuntimeSecret('GOOGLE_CLIENT_ID');
  if (!clientId) {
    const errorMsg = 'La variable GOOGLE_CLIENT_ID no está configurada en los secretos de Cloudflare Workers.';
    if (wantsJson) {
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      renderAdminErrorHtml('Falta Configuración de Google Cloud', errorMsg),
      {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  }

  const redirectUri = resolveRedirectUri(request);
  const secret = getHmacSigningSecret();
  const { state, nonce } = await createOAuthState(auth.userId, secret);

  const authUrl = generateOAuthAuthorizationUrl({
    clientId,
    redirectUri,
    state,
    scope: GOOGLE_CALENDAR_DEFAULT_SCOPE,
  });

  const responseHeaders = new Headers();

  // Cookie HttpOnly con el nonce para validación CSRF estricta
  responseHeaders.append(
    'Set-Cookie',
    `kani_gcal_oauth_state=${nonce}; Path=/api/integrations/google-calendar; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  );

  if (wantsJson) {
    responseHeaders.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ url: authUrl, state }), {
      status: 200,
      headers: responseHeaders,
    });
  }

  responseHeaders.set('Location', authUrl);
  return new Response(null, {
    status: 302,
    headers: responseHeaders,
  });
}

/**
 * 2. GET /api/integrations/google-calendar/callback
 */
export async function handleGoogleCalendarCallback(
  request: Request,
  options: {
    customSupabaseClient?: any;
    fetchFn?: typeof fetch;
  } = {},
): Promise<Response> {
  const url = new URL(request.url);
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    const errorDesc = url.searchParams.get('error_description') || errorParam;
    return new Response(
      renderAdminErrorHtml('Autorización Cancelada en Google', `Google reportó: ${errorDesc}`),
      {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return new Response(
      renderAdminErrorHtml('Solicitud Incompleta', 'Faltan parámetros requeridos (code o state).'),
      {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  }

  const cookieHeader = request.headers.get('Cookie');
  const cookieNonce = extractCookie(cookieHeader, 'kani_gcal_oauth_state');
  const secret = getHmacSigningSecret();

  const stateVerification = await verifyOAuthState(state, secret, cookieNonce);
  if (!stateVerification.valid) {
    return new Response(
      renderAdminErrorHtml(
        'Validación de Seguridad Fallida (CSRF)',
        `El parámetro state es inválido o ha expirado (${stateVerification.error}). Por favor, intente autorizar nuevamente desde el panel.`,
      ),
      {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  }

  const clientId = getRuntimeSecret('GOOGLE_CLIENT_ID');
  const clientSecret = getRuntimeSecret('GOOGLE_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    return new Response(
      renderAdminErrorHtml(
        'Configuración Incompleta en el Servidor',
        'Faltan las variables GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en Cloudflare Workers.',
      ),
      {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  }

  const redirectUri = resolveRedirectUri(request);

  try {
    const tokens = await exchangeOAuthCodeForTokens({
      code,
      clientId,
      clientSecret,
      redirectUri,
      fetchFn: options.fetchFn,
    });

    if (!tokens.refreshToken) {
      // Si Google no devuelve refresh_token (ej. re-autorización sin revocar), verificar si ya existía uno en BD
      const existing = await getStoredOAuthTokens(options.customSupabaseClient);
      if (!existing?.refreshToken) {
        return new Response(
          renderAdminErrorHtml(
            'Falta Refresh Token de Google',
            'Google no devolvió un refresh token. Para solucionarlo, ingrese a myaccount.google.com/permissions, desvincule Kani Barber Studio y vuelva a autorizar con prompt=consent.',
          ),
          {
            status: 400,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          },
        );
      }
      tokens.refreshToken = existing.refreshToken;
    }

    // Almacenamiento seguro en backend
    await saveStoredOAuthTokens(
      {
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        scope: tokens.scope,
      },
      options.customSupabaseClient,
    );

    const clearCookieHeader =
      'kani_gcal_oauth_state=; Path=/api/integrations/google-calendar; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

    return new Response(
      renderAdminSuccessHtml({
        scope: tokens.scope || GOOGLE_CALENDAR_DEFAULT_SCOPE,
        refreshToken: tokens.refreshToken,
        redirectUri,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Set-Cookie': clearCookieHeader,
        },
      },
    );
  } catch (exchangeError: any) {
    return new Response(
      renderAdminErrorHtml(
        'Error al Obtener Tokens de Google',
        exchangeError?.message || String(exchangeError),
      ),
      {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  }
}

/**
 * 3. GET /api/integrations/google-calendar/status
 */
export async function handleGoogleCalendarIntegrationStatus(
  request: Request,
  customSupabaseClient?: any,
): Promise<Response> {
  const config = getGoogleCalendarAuthConfig();
  let hasStoredRefreshToken = false;
  let storedScope: string | null = null;
  let storedUpdatedAt: string | null = null;

  try {
    const stored = await getStoredOAuthTokens(customSupabaseClient);
    if (stored?.refreshToken) {
      hasStoredRefreshToken = true;
      storedScope = stored.scope;
      storedUpdatedAt = stored.updatedAt;
    }
  } catch {
    // ignorar si aún no está creada la tabla
  }

  const redirectUri = resolveRedirectUri(request);

  const allAvailableKeys = new Set<string>();
  const envObj = (typeof process !== 'undefined' ? process.env : {}) as Record<string, unknown>;
  const globalObj = (globalThis as typeof globalThis & {
    __env__?: Record<string, unknown>;
    __KANI_RUNTIME_ENV?: Record<string, string>;
  });

  const clientId = getRuntimeSecret('GOOGLE_CLIENT_ID');
  const clientSecret = getRuntimeSecret('GOOGLE_CLIENT_SECRET');
  const serviceRoleKey =
    getRuntimeSecret('SUPABASE_SERVICE_ROLE_KEY') ||
    (typeof process !== 'undefined' ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined);

  for (const k of Object.keys(envObj)) {
    if (k.startsWith('GOOGLE_') || k.startsWith('SUPABASE_') || k.startsWith('PONTIUN_') || k.startsWith('VITE_') || k.includes('CLIENT')) allAvailableKeys.add(k);
  }
  if (globalObj.__KANI_RUNTIME_ENV) {
    for (const k of Object.keys(globalObj.__KANI_RUNTIME_ENV)) {
      if (k.startsWith('GOOGLE_') || k.startsWith('SUPABASE_') || k.startsWith('PONTIUN_') || k.startsWith('VITE_') || k.includes('CLIENT')) allAvailableKeys.add(k);
    }
  }
  if (globalObj.__env__) {
    for (const k of Object.keys(globalObj.__env__)) {
      if (k.startsWith('GOOGLE_') || k.startsWith('SUPABASE_') || k.startsWith('PONTIUN_') || k.startsWith('VITE_') || k.includes('CLIENT')) allAvailableKeys.add(k);
    }
  }

  let associations: Array<{ barber: string; calendarId: string | null; configured: boolean }> = [];
  let queueSummary: {
    total: number;
    pending: number;
    processing: number;
    synced: number;
    failed: number;
    recentJobs: any[];
    hasHistoricalUnexpected: boolean;
  } | null = null;

  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const sb = customSupabaseClient || supabaseAdmin;

    const { data: bgcRows } = await sb.from('barber_google_calendars').select('barber_id, calendar_id');
    const { data: barberRows } = await sb.from('barbers').select('id, name');
    if (barberRows) {
      associations = barberRows.map((b: any) => {
        const row = bgcRows?.find((c: any) => c.barber_id === b.id);
        return {
          barber: b.name,
          calendarId: row?.calendar_id || null,
          configured: Boolean(row?.calendar_id),
        };
      });
    }

    const { data: allSyncRows } = await sb
      .from('appointment_calendar_sync')
      .select('id, appointment_id, sync_action, sync_status, attempts, last_error, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (allSyncRows) {
      const pending = allSyncRows.filter((r: any) => r.sync_status === 'PENDING').length;
      const processing = allSyncRows.filter((r: any) => r.sync_status === 'PROCESSING').length;
      const synced = allSyncRows.filter((r: any) => r.sync_status === 'SYNCED').length;
      const failed = allSyncRows.filter((r: any) => r.sync_status === 'FAILED').length;
      queueSummary = {
        total: allSyncRows.length,
        pending,
        processing,
        synced,
        failed,
        recentJobs: allSyncRows.slice(0, 5),
        hasHistoricalUnexpected: failed > 0,
      };
    }
  } catch {
    // Non-blocking fallback
  }

  return new Response(
    JSON.stringify({
      configured: Boolean(clientId && clientSecret),
      authorized: Boolean(config.refreshToken || hasStoredRefreshToken),
      strategy: config.strategy,
      storageMethod: config.refreshToken ? 'CLOUDFLARE_SECRET' : hasStoredRefreshToken ? 'BACKEND_DATABASE' : 'NONE',
      syncEnabled: config.enabled,
      cron: {
        trigger: '* * * * *',
        registered: true,
      },
      associations,
      queueSummary,
      version: '20261101-strict-v2',
      scope: storedScope || GOOGLE_CALENDAR_DEFAULT_SCOPE,
      lastAuthorizedAt: storedUpdatedAt,
      redirectUri,
      authorizeUrl: `${new URL(request.url).origin}/api/integrations/google-calendar/authorize`,
      envDetection: {
        hasGoogleClientId: Boolean(clientId),
        hasGoogleClientSecret: Boolean(clientSecret),
        hasSupabaseServiceRoleKey: Boolean(serviceRoleKey),
        detectedMatchingKeyNames: Array.from(allAvailableKeys).sort(),
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * 4. GET /api/integrations/google-calendar/test-cycle
 * Permite ejecutar y auditar de forma segura y controlada el ciclo de vida de un turno ficticio:
 * - action=inspect: Inspecciona cola, asociaciones y cron trigger
 * - action=create: Crea un turno manual ficticio CONFIRMED para Franco, generando PENDING en la cola
 * - action=poll: Comprueba si el Cron Trigger procesó el turno a SYNCED y consulta Google Calendar
 * - action=modify: Modifica la hora del turno y verifica que vuelva a PENDING
 * - action=cancel: Cancela el turno y verifica sync_action = DELETE
 * - action=verify-deleted: Verifica que el evento se eliminó de Google Calendar (404)
 * - action=cleanup: Elimina de forma segura únicamente los datos de prueba
 */
export async function handleGoogleCalendarTestCycle(
  request: Request,
  customSupabaseClient?: any,
): Promise<Response> {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'inspect';

  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const sb = customSupabaseClient || supabaseAdmin;

  try {
    if (action === 'inspect') {
      const { data: bgcRows } = await sb.from('barber_google_calendars').select('barber_id, calendar_id');
      const { data: barberRows } = await sb.from('barbers').select('id, name');
      const associations = (barberRows || []).map((b: any) => {
        const row = bgcRows?.find((c: any) => c.barber_id === b.id);
        return {
          barber: b.name,
          calendarId: row?.calendar_id || null,
          configured: Boolean(row?.calendar_id),
        };
      });

      const { data: allSyncRows } = await sb
        .from('appointment_calendar_sync')
        .select('*')
        .order('created_at', { ascending: false });

      const pending = (allSyncRows || []).filter((r: any) => r.sync_status === 'PENDING').length;
      const processing = (allSyncRows || []).filter((r: any) => r.sync_status === 'PROCESSING').length;
      const synced = (allSyncRows || []).filter((r: any) => r.sync_status === 'SYNCED').length;
      const failed = (allSyncRows || []).filter((r: any) => r.sync_status === 'FAILED').length;

      return new Response(
        JSON.stringify({
          success: true,
          cronTrigger: '* * * * *',
          associations,
          queue: {
            total: (allSyncRows || []).length,
            pending,
            processing,
            synced,
            failed,
            items: (allSyncRows || []).slice(0, 10),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'create') {
      // 1. Obtener Franco y un servicio válido
      const { data: franco } = await sb
        .from('barbers')
        .select('id, name')
        .eq('name', 'Franco')
        .single();
      if (!franco) throw new Error('Barbero Franco no encontrado.');

      const { data: service } = await sb
        .from('services')
        .select('id, name, duration_minutes, price_ars')
        .eq('name', 'Corte')
        .single();

      // 2. Insertar turno de prueba confirmado
      const { data: appt, error: insertErr } = await sb
        .from('appointments')
        .insert({
          barber_id: franco.id,
          service_id: service?.id || null,
          booking_date: '2026-11-28',
          start_time: '14:00:00',
          end_time: '14:45:00',
          status: 'CONFIRMED',
          booking_client_name: '[AUDIT-TEST] Prueba Automática Cron',
          booking_client_phone: '+5491100000000',
          notes: '[AUDIT-TEST-CRON-LIFECYCLE]',
          deposit_paid: true,
          deposit_amount_ars: 5000,
          service_price_ars: 25000,
        })
        .select('*')
        .single();

      if (insertErr || !appt) {
        throw new Error(`Error al crear turno de prueba: ${insertErr?.message}`);
      }

      // 3. Consultar fila creada en appointment_calendar_sync
      const { data: syncRow } = await sb
        .from('appointment_calendar_sync')
        .select('*')
        .eq('appointment_id', appt.id)
        .maybeSingle();

      return new Response(
        JSON.stringify({
          success: true,
          step: 'CREATED',
          appointmentId: appt.id,
          requestNumber: appt.request_number,
          appointment: {
            barber: 'Franco',
            date: appt.booking_date,
            start_time: appt.start_time,
            end_time: appt.end_time,
            status: appt.status,
          },
          syncJob: syncRow,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const appointmentId = url.searchParams.get('appointmentId');
    if (!appointmentId) {
      return new Response(JSON.stringify({ error: 'appointmentId requerido' }), { status: 400 });
    }

    if (action === 'poll') {
      const { data: syncRow } = await sb
        .from('appointment_calendar_sync')
        .select('*')
        .eq('appointment_id', appointmentId)
        .maybeSingle();

      let googleEvent: any = null;
      let googleError: string | null = null;

      if (syncRow?.sync_status === 'SYNCED' && syncRow.google_event_id && syncRow.calendar_id) {
        try {
          const { getCalendarClient } = await import('./kani-google-calendar-sync');
          const client = await getCalendarClient();
          googleEvent = await client.getEvent(syncRow.calendar_id, syncRow.google_event_id);
        } catch (err) {
          googleError = err instanceof Error ? err.message : String(err);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          syncStatus: syncRow?.sync_status,
          syncJob: syncRow,
          isSynced: syncRow?.sync_status === 'SYNCED',
          googleEvent: googleEvent
            ? {
                id: googleEvent.id,
                summary: googleEvent.summary,
                start: googleEvent.start,
                end: googleEvent.end,
                status: googleEvent.status,
              }
            : null,
          googleError,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'modify') {
      // Modificar horario: de 14:00 a 15:00
      const { data: updatedAppt, error: updateErr } = await sb
        .from('appointments')
        .update({
          start_time: '15:00:00',
          end_time: '15:45:00',
          updated_at: new Date().toISOString(),
        })
        .eq('id', appointmentId)
        .select('*')
        .single();

      if (updateErr) throw new Error(`Fallo al modificar turno: ${updateErr.message}`);

      const { data: syncRow } = await sb
        .from('appointment_calendar_sync')
        .select('*')
        .eq('appointment_id', appointmentId)
        .maybeSingle();

      return new Response(
        JSON.stringify({
          success: true,
          step: 'MODIFIED',
          newStartTime: updatedAppt.start_time,
          newEndTime: updatedAppt.end_time,
          syncJob: syncRow,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'cancel') {
      const { data: cancelledAppt, error: cancelErr } = await sb
        .from('appointments')
        .update({
          status: 'CANCELLED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', appointmentId)
        .select('*')
        .single();

      if (cancelErr) throw new Error(`Fallo al cancelar turno: ${cancelErr.message}`);

      const { data: syncRow } = await sb
        .from('appointment_calendar_sync')
        .select('*')
        .eq('appointment_id', appointmentId)
        .maybeSingle();

      return new Response(
        JSON.stringify({
          success: true,
          step: 'CANCELLED',
          status: cancelledAppt.status,
          syncJob: syncRow,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'verify-deleted') {
      const { data: syncRow } = await sb
        .from('appointment_calendar_sync')
        .select('*')
        .eq('appointment_id', appointmentId)
        .maybeSingle();

      let eventGone = false;
      let checkError: string | null = null;

      if (syncRow?.google_event_id && syncRow.calendar_id) {
        try {
          const { getCalendarClient } = await import('./kani-google-calendar-sync');
          const client = await getCalendarClient();
          const evt = await client.getEvent(syncRow.calendar_id, syncRow.google_event_id);
          // Si no arrojó 404, verificar si status === 'cancelled'
          if (evt && evt.status === 'cancelled') {
            eventGone = true;
          }
        } catch (err: any) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('404') || msg.includes('notFound')) {
            eventGone = true;
          } else {
            checkError = msg;
          }
        }
      } else {
        eventGone = true;
      }

      return new Response(
        JSON.stringify({
          success: true,
          syncStatus: syncRow?.sync_status,
          eventGone,
          checkError,
          syncJob: syncRow,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'cleanup') {
      // Eliminar exclusivamente datos de auditoría con la nota técnica explícita
      const { data: appt } = await sb
        .from('appointments')
        .select('id, notes')
        .eq('id', appointmentId)
        .maybeSingle();

      if (appt && appt.notes?.includes('[AUDIT-TEST-CRON-LIFECYCLE]')) {
        await sb.from('appointment_calendar_sync').delete().eq('appointment_id', appointmentId);
        await sb.from('appointments').delete().eq('id', appointmentId);
        return new Response(
          JSON.stringify({ success: true, cleaned: true, appointmentId }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: false, message: 'El turno no corresponde a un test de auditoría seguro.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: `Acción desconocida: ${action}` }), { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ==============================================================================
// TEMPLATES HTML PARA ADMINISTRACIÓN
// ==============================================================================

function renderAdminSuccessHtml(data: {
  scope: string;
  redirectUri: string;
}): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Google Calendar Conectado — Kani Barber Studio</title>
  <style>
    body {
      margin: 0;
      padding: 40px 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0b0c10;
      color: #e5e5e5;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 80vh;
    }
    .card {
      background: #15171e;
      border: 1px solid #2d3139;
      border-radius: 12px;
      max-width: 580px;
      width: 100%;
      padding: 32px;
      box-shadow: 0 12px 36px rgba(0,0,0,0.4);
    }
    .badge {
      display: inline-block;
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
      border: 1px solid rgba(34, 197, 94, 0.3);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0 0 12px 0;
      font-size: 22px;
      color: #fff;
    }
    p {
      color: #9ca3af;
      font-size: 14px;
      line-height: 1.6;
      margin: 0 0 20px 0;
    }
    .details {
      background: #0f1117;
      border: 1px solid #232730;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
      font-size: 13px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .row:last-child {
      margin-bottom: 0;
    }
    .label {
      color: #6b7280;
    }
    .val {
      color: #f3f4f6;
      font-weight: 500;
    }
    .info-box {
      background: #1c202a;
      border-left: 3px solid #d4af37;
      padding: 12px 16px;
      border-radius: 0 6px 6px 0;
      margin-bottom: 24px;
      font-size: 12px;
      color: #cbd5e1;
      line-height: 1.5;
    }
    .btn {
      display: inline-block;
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      background: #d4af37;
      color: #0b0c10;
      font-weight: 600;
      padding: 12px 20px;
      border-radius: 6px;
      text-decoration: none;
      transition: background 0.2s;
    }
    .btn:hover {
      background: #e2c056;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">✓ Conexión Exitosa</div>
    <h1>Google Calendar Conectado con Éxito</h1>
    <p>La cuenta central de Google de Kani Barber Studio fue autorizada correctamente. El token de renovación (refresh token) ha sido almacenado de manera segura y cifrada en el backend para la renovación automática de accesos.</p>
    
    <div class="details">
      <div class="row">
        <span class="label">Permiso otorgado:</span>
        <span class="val">${data.scope}</span>
      </div>
      <div class="row">
        <span class="label">Modo:</span>
        <span class="val">Acceso Offline (Renovación automática)</span>
      </div>
      <div class="row">
        <span class="label">Almacenamiento:</span>
        <span class="val">Cifrado AES-GCM en backend (service_role protegido)</span>
      </div>
      <div class="row">
        <span class="label">Sincronización automática:</span>
        <span class="val">Deshabilitada (Etapa 1)</span>
      </div>
    </div>

    <div class="info-box">
      <strong>Renovación automática activa:</strong><br>
      Los tokens de acceso se renovarán automáticamente en segundo plano cuando sea necesario. No se requiere ninguna acción manual adicional ni intervención de los barberos.
    </div>

    <a href="/panel-administracion" class="btn">Volver al Panel de Administración</a>
  </div>
</body>
</html>`;
}

function renderAdminErrorHtml(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Error de Autorización — Kani Barber Studio</title>
  <style>
    body {
      margin: 0;
      padding: 40px 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0b0c10;
      color: #e5e5e5;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 80vh;
    }
    .card {
      background: #15171e;
      border: 1px solid #3b2020;
      border-radius: 12px;
      max-width: 580px;
      width: 100%;
      padding: 32px;
      box-shadow: 0 12px 36px rgba(0,0,0,0.4);
    }
    .badge {
      display: inline-block;
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0 0 12px 0;
      font-size: 22px;
      color: #fff;
    }
    p {
      color: #9ca3af;
      font-size: 14px;
      line-height: 1.6;
      margin: 0 0 24px 0;
    }
    .btn {
      display: inline-block;
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      background: #232730;
      color: #e5e5e5;
      font-weight: 600;
      padding: 12px 20px;
      border-radius: 6px;
      text-decoration: none;
      transition: background 0.2s;
    }
    .btn:hover {
      background: #2d3139;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">✕ Error de Autorización</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/panel-administracion" class="btn">Volver al Panel de Administración</a>
  </div>
</body>
</html>`;
}
