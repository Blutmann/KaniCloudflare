/**
 * KANI BARBER STUDIO — Autenticación segura con Google Calendar API
 * 
 * Soporta dos estrategias de autenticación centralizada:
 * 1. OAuth 2.0 Centralizado (Flujo de Consentimiento con Acceso Offline):
 *    - Endpoints de autorización y callback protegidos contra CSRF (state con HMAC y nonce).
 *    - Acceso offline con prompt=consent garantizando la obtención de refresh_token.
 *    - Almacenamiento seguro del refresh_token en backend (Supabase service_role o env vars).
 *    - Renovación automática y transparente de access tokens.
 * 2. Cuenta de Servicio de Google Cloud:
 *    - Firma JWT RS256 mediante Web Crypto nativo.
 * 
 * REGLAS DE SEGURIDAD:
 * - Autorización de conexión exclusiva para administradores (ADMIN).
 * - Credenciales y secretos estrictamente en backend / Cloudflare Secrets.
 * - Nunca se imprimen claves privadas, tokens ni secretos en logs.
 * - Permisos mínimos solicitados: https://www.googleapis.com/auth/calendar.events.owned
 */

export type GoogleAuthConfig = {
  enabled: boolean;
  strategy: 'SERVICE_ACCOUNT' | 'OAUTH2' | 'NONE';
  serviceAccountEmail?: string;
  serviceAccountPrivateKey?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
};

export type GoogleTokenResponse = {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  scope?: string;
};

export type StoredOAuthTokens = {
  id: string;
  refreshToken: string;
  accessToken: string | null;
  expiresAt: string | null;
  scope: string | null;
  updatedAt: string;
};

let cachedToken: GoogleTokenResponse | null = null;

export const GOOGLE_CALENDAR_DEFAULT_SCOPE =
  'https://www.googleapis.com/auth/calendar.events.owned';

export function getGoogleCalendarAuthConfig(): GoogleAuthConfig {
  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
  const globalEnv = (globalThis as typeof globalThis & {
    __KANI_RUNTIME_ENV?: Record<string, string>;
  }).__KANI_RUNTIME_ENV || {};

  const getVar = (key: string): string | undefined => env[key] || globalEnv[key];

  const enabled = getVar('GOOGLE_CALENDAR_SYNC_ENABLED') === 'true';
  const saEmail = getVar('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const saKey = getVar('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');

  const clientId = getVar('GOOGLE_CLIENT_ID');
  const clientSecret = getVar('GOOGLE_CLIENT_SECRET');
  const refreshToken = getVar('GOOGLE_REFRESH_TOKEN');

  if (clientId && clientSecret) {
    return {
      enabled,
      strategy: 'OAUTH2',
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      refreshToken: refreshToken?.trim(),
    };
  }

  if (saEmail && saKey) {
    return {
      enabled,
      strategy: 'SERVICE_ACCOUNT',
      serviceAccountEmail: saEmail.trim(),
      serviceAccountPrivateKey: saKey.trim(),
    };
  }

  return {
    enabled,
    strategy: 'NONE',
  };
}

export function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

export function pemToDer(pem: string): Uint8Array {
  const clean = pem
    .replace(/-----BEGIN[ A-Z_-]+-----/g, '')
    .replace(/-----END[ A-Z_-]+-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function hmacSha256(keyStr: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(keyStr),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return base64UrlEncode(new Uint8Array(signature));
}

// ==============================================================================
// CSRF & STATE GENERATION / VERIFICATION
// ==============================================================================

export type OAuthStatePayload = {
  nonce: string;
  adminUserId: string;
  ts: number;
};

export async function createOAuthState(
  adminUserId: string,
  secret: string,
): Promise<{ state: string; nonce: string }> {
  const nonce = crypto.randomUUID();
  const payload: OAuthStatePayload = {
    nonce,
    adminUserId,
    ts: Date.now(),
  };

  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = await hmacSha256(secret, payloadB64);
  const state = `${payloadB64}.${sig}`;

  return { state, nonce };
}

export async function verifyOAuthState(
  state: string,
  secret: string,
  cookieNonce?: string | null,
  maxAgeMs = 10 * 60 * 1000, // 10 minutes
): Promise<{ valid: boolean; adminUserId?: string; error?: string }> {
  try {
    if (!state || !state.includes('.')) {
      return { valid: false, error: 'STATE_FORMAT_INVALID' };
    }

    const [payloadB64, providedSig] = state.split('.');
    if (!payloadB64 || !providedSig) {
      return { valid: false, error: 'STATE_PARTS_MISSING' };
    }

    const expectedSig = await hmacSha256(secret, payloadB64);
    if (providedSig !== expectedSig) {
      return { valid: false, error: 'STATE_SIGNATURE_MISMATCH' };
    }

    const payloadJson = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadJson) as OAuthStatePayload;

    const now = Date.now();
    if (now - payload.ts >= maxAgeMs) {
      return { valid: false, error: 'STATE_EXPIRED' };
    }

    if (cookieNonce && cookieNonce !== payload.nonce) {
      return { valid: false, error: 'STATE_NONCE_COOKIE_MISMATCH' };
    }

    return { valid: true, adminUserId: payload.adminUserId };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'STATE_DECODE_FAILED' };
  }
}

export function generateOAuthAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const scope = params.scope || GOOGLE_CALENDAR_DEFAULT_SCOPE;
  const searchParams = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent',
    state: params.state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${searchParams.toString()}`;
}

// ==============================================================================
// OAUTH CODE EXCHANGE & TOKEN STORAGE
// ==============================================================================

export type ExchangeCodeResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
  tokenType?: string;
};

export async function exchangeOAuthCodeForTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchFn?: typeof fetch;
}): Promise<ExchangeCodeResponse> {
  const fetchFn = params.fetchFn || fetch;
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`GOOGLE_OAUTH_EXCHANGE_ERROR_${res.status}: ${errorBody}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    scope: json.scope,
    tokenType: json.token_type,
  };
}

// ==============================================================================
// ENCRYPT AT REST (AES-GCM PARA REFRESH TOKENS EN BD)
// ==============================================================================

function getEncryptionSecret(): string {
  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
  const globalEnv = (globalThis as typeof globalThis & { __KANI_RUNTIME_ENV?: Record<string, string> }).__KANI_RUNTIME_ENV || {};
  return (
    env['SUPABASE_SERVICE_ROLE_KEY'] ||
    globalEnv['SUPABASE_SERVICE_ROLE_KEY'] ||
    env['GOOGLE_CLIENT_SECRET'] ||
    globalEnv['GOOGLE_CLIENT_SECRET'] ||
    'kani_gcal_token_aes_secret_fallback_key_32'
  );
}

export async function encryptTokenAtRest(plainText: string, secret = getEncryptionSecret()): Promise<string> {
  if (!plainText) return '';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const cryptoKey = await crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    new TextEncoder().encode(plainText),
  );
  return `enc:v1:${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

export async function decryptTokenAtRest(cipherText: string, secret = getEncryptionSecret()): Promise<string> {
  if (!cipherText) return '';
  if (!cipherText.startsWith('enc:v1:')) {
    // Si no tiene prefijo enc:v1:, es texto plano compatible
    return cipherText;
  }
  const raw = cipherText.slice(7);
  const [ivB64, dataB64] = raw.split('.');
  if (!ivB64 || !dataB64) return cipherText;

  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const cryptoKey = await crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['decrypt']);
  const iv = Uint8Array.from(base64UrlDecode(ivB64), c => c.charCodeAt(0));
  const data = Uint8Array.from(base64UrlDecode(dataB64), c => c.charCodeAt(0));

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    data,
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Guarda los tokens OAuth de forma segura y cifrada en la tabla protegida de Supabase
 */
export async function saveStoredOAuthTokens(
  tokens: {
    refreshToken: string;
    accessToken?: string;
    expiresIn?: number;
    scope?: string;
  },
  customSupabaseClient?: any,
): Promise<void> {
  let supabase = customSupabaseClient;
  if (!supabase) {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    supabase = supabaseAdmin;
  }

  const expiresAt = tokens.expiresIn
    ? new Date(Date.now() + (tokens.expiresIn - 60) * 1000).toISOString()
    : null;

  const encryptedRefreshToken = await encryptTokenAtRest(tokens.refreshToken);

  const { error } = await supabase.from('google_calendar_oauth_tokens').upsert(
    {
      id: 'primary',
      refresh_token: encryptedRefreshToken,
      access_token: tokens.accessToken || null,
      expires_at: expiresAt,
      scope: tokens.scope || GOOGLE_CALENDAR_DEFAULT_SCOPE,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );

  if (error) {
    throw new Error(`SAVE_OAUTH_TOKENS_FAILED: ${error.message}`);
  }

  if (tokens.accessToken && tokens.expiresIn) {
    cachedToken = {
      accessToken: tokens.accessToken,
      expiresAt: Date.now() + (tokens.expiresIn - 60) * 1000,
      refreshToken: tokens.refreshToken,
      scope: tokens.scope,
    };
  }
}

/**
 * Lee y descifra los tokens OAuth almacenados en la tabla protegida de Supabase
 */
export async function getStoredOAuthTokens(
  customSupabaseClient?: any,
): Promise<StoredOAuthTokens | null> {
  let supabase = customSupabaseClient;
  if (!supabase) {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    supabase = supabaseAdmin;
  }

  const { data, error } = await supabase
    .from('google_calendar_oauth_tokens')
    .select('id, refresh_token, access_token, expires_at, scope, updated_at')
    .eq('id', 'primary')
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const decryptedRefreshToken = await decryptTokenAtRest(data.refresh_token);

  return {
    id: data.id,
    refreshToken: decryptedRefreshToken,
    accessToken: data.access_token,
    expiresAt: data.expires_at,
    scope: data.scope,
    updatedAt: data.updated_at,
  };
}

// ==============================================================================
// CUENTA DE SERVICIO (JWT RS256)
// ==============================================================================

export async function createServiceAccountJwt(
  clientEmail: string,
  privateKeyPem: string,
  scopes: string[] = [GOOGLE_CALENDAR_DEFAULT_SCOPE],
): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientEmail,
    scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const message = `${headerB64}.${payloadB64}`;

  const der = pemToDer(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(message),
  );

  return `${message}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function requestServiceAccountAccessToken(
  clientEmail: string,
  privateKeyPem: string,
  fetchFn: typeof fetch = fetch,
): Promise<GoogleTokenResponse> {
  const assertion = await createServiceAccountJwt(clientEmail, privateKeyPem);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GOOGLE_AUTH_TOKEN_ERROR_${res.status}: ${errorText}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = Date.now() + (json.expires_in - 120) * 1000;
  return {
    accessToken: json.access_token,
    expiresAt,
  };
}

export async function requestOAuth2AccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GOOGLE_OAUTH_TOKEN_ERROR_${res.status}: ${errorText}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number; scope?: string };
  const expiresAt = Date.now() + (json.expires_in - 120) * 1000;
  return {
    accessToken: json.access_token,
    expiresAt,
    refreshToken,
    scope: json.scope,
  };
}

/**
 * Obtiene un access_token activo con renovación automática:
 * 1. Revisa caché en memoria.
 * 2. Si hay Cuenta de Servicio configurada, genera token con JWT.
 * 3. Si hay OAuth 2.0 con GOOGLE_REFRESH_TOKEN en env var, refresca con Google.
 * 4. Si no está en env var, consulta la tabla segura public.google_calendar_oauth_tokens:
 *    - Si el token en BD sigue vigente, lo usa.
 *    - Si expiró, renueva automáticamente con el refresh_token almacenado y actualiza la BD.
 */
export async function getGoogleCalendarAccessToken(
  fetchFn: typeof fetch = fetch,
  customSupabaseClient?: any,
): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.accessToken;
  }

  const config = getGoogleCalendarAuthConfig();

  // 1. Estrategia Cuenta de Servicio
  if (config.strategy === 'SERVICE_ACCOUNT' && config.serviceAccountEmail && config.serviceAccountPrivateKey) {
    cachedToken = await requestServiceAccountAccessToken(
      config.serviceAccountEmail,
      config.serviceAccountPrivateKey,
      fetchFn,
    );
    return cachedToken.accessToken;
  }

  // 2. Estrategia OAuth 2.0 con refresh_token en env var
  if (config.strategy === 'OAUTH2' && config.clientId && config.clientSecret && config.refreshToken) {
    cachedToken = await requestOAuth2AccessToken(
      config.clientId,
      config.clientSecret,
      config.refreshToken,
      fetchFn,
    );
    return cachedToken.accessToken;
  }

  // 3. Estrategia OAuth 2.0 consultando almacenamiento seguro en BD
  if (config.strategy === 'OAUTH2' && config.clientId && config.clientSecret) {
    try {
      const stored = await getStoredOAuthTokens(customSupabaseClient);
      if (stored && stored.refreshToken) {
        // Si el token almacenado sigue vigente (más de 60s antes de expirar)
        if (stored.accessToken && stored.expiresAt && new Date(stored.expiresAt).getTime() > now + 60_000) {
          cachedToken = {
            accessToken: stored.accessToken,
            expiresAt: new Date(stored.expiresAt).getTime(),
            refreshToken: stored.refreshToken,
            scope: stored.scope || undefined,
          };
          return stored.accessToken;
        }

        // Si expiró, renovar automáticamente
        const renewed = await requestOAuth2AccessToken(
          config.clientId,
          config.clientSecret,
          stored.refreshToken,
          fetchFn,
        );

        // Guardar nuevo access_token renovado en BD
        await saveStoredOAuthTokens(
          {
            refreshToken: stored.refreshToken,
            accessToken: renewed.accessToken,
            expiresIn: Math.floor((renewed.expiresAt - now) / 1000),
            scope: renewed.scope || stored.scope || undefined,
          },
          customSupabaseClient,
        );

        cachedToken = renewed;
        return renewed.accessToken;
      }
    } catch (dbErr) {
      console.warn('[Kani Google Auth] No se pudo leer token OAuth desde la base de datos:', dbErr);
    }
  }

  return null;
}

export function clearGoogleTokenCache(): void {
  cachedToken = null;
}
