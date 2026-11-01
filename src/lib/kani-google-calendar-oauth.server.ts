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
      supabase = createClient(supabaseUrl, serviceRoleKey || anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
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
 * 1. GET /api/integrations/google-calendar/authorize
 */
export async function handleGoogleCalendarAuthorize(
  request: Request,
  customSupabaseClient?: any,
): Promise<Response> {
  const auth = await authenticateAdminRequest(request, customSupabaseClient);
  if (!auth.authorized || !auth.userId) {
    return new Response(
      renderAdminErrorHtml('Acceso Denegado', auth.error || 'Se requieren permisos de Administrador.'),
      {
        status: 403,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  }

  const clientId = getRuntimeSecret('GOOGLE_CLIENT_ID');
  if (!clientId) {
    return new Response(
      renderAdminErrorHtml(
        'Falta Configuración de Google Cloud',
        'La variable GOOGLE_CLIENT_ID no está configurada en los secretos de Cloudflare Workers.',
      ),
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
  responseHeaders.set('Location', authUrl);

  // Cookie HttpOnly con el nonce para validación CSRF estricta
  responseHeaders.append(
    'Set-Cookie',
    `kani_gcal_oauth_state=${nonce}; Path=/api/integrations/google-calendar; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  );

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

  return new Response(
    JSON.stringify({
      configured: Boolean(config.clientId && config.clientSecret),
      authorized: Boolean(config.refreshToken || hasStoredRefreshToken),
      strategy: config.strategy,
      storageMethod: config.refreshToken ? 'CLOUDFLARE_SECRET' : hasStoredRefreshToken ? 'BACKEND_DATABASE' : 'NONE',
      syncEnabled: config.enabled,
      scope: storedScope || GOOGLE_CALENDAR_DEFAULT_SCOPE,
      lastAuthorizedAt: storedUpdatedAt,
      redirectUri,
      authorizeUrl: `${new URL(request.url).origin}/api/integrations/google-calendar/authorize`,
      envDetection: {
        hasGoogleClientId: Boolean(config.clientId),
        hasGoogleClientSecret: Boolean(config.clientSecret),
        hasSupabaseServiceRoleKey: Boolean(
          getRuntimeSecret('SUPABASE_SERVICE_ROLE_KEY') ||
          (typeof process !== 'undefined' && process.env.SUPABASE_SERVICE_ROLE_KEY)
        ),
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
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
