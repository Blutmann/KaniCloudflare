/**
 * KANI BARBER STUDIO — Autenticación segura con Google Calendar API
 * 
 * Soporta dos estrategias de autenticación centralizada:
 * 1. Cuenta de Servicio de Google Cloud (Recomendada):
 *    - Usa un par de claves RSA (RS256) mediante Web Crypto estándar.
 *    - No requiere dependencias externas pesadas (ej. googleapis o google-auth-library).
 *    - Compatible al 100% con Cloudflare Workers, Node 18+ y entornos de prueba.
 * 2. OAuth 2.0 Centralizado (Alternativa):
 *    - Utiliza GOOGLE_REFRESH_TOKEN de la cuenta central de Google de Kani.
 * 
 * REGLAS DE SEGURIDAD:
 * - Credenciales estrictamente en backend.
 * - Nunca se imprimen claves privadas, tokens ni secretos en logs.
 * - Permisos mínimos: https://www.googleapis.com/auth/calendar.events.
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
};

let cachedToken: GoogleTokenResponse | null = null;

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

  if (saEmail && saKey) {
    return {
      enabled,
      strategy: 'SERVICE_ACCOUNT',
      serviceAccountEmail: saEmail.trim(),
      serviceAccountPrivateKey: saKey.trim(),
    };
  }

  if (clientId && clientSecret && refreshToken) {
    return {
      enabled,
      strategy: 'OAUTH2',
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      refreshToken: refreshToken.trim(),
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

/**
 * Genera y firma un JWT de Cuenta de Servicio con RS256 usando Web Crypto nativo
 */
export async function createServiceAccountJwt(
  clientEmail: string,
  privateKeyPem: string,
  scopes: string[] = ['https://www.googleapis.com/auth/calendar.events'],
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

  const json = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = Date.now() + (json.expires_in - 120) * 1000;
  return {
    accessToken: json.access_token,
    expiresAt,
  };
}

export async function getGoogleCalendarAccessToken(
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const config = getGoogleCalendarAuthConfig();
  if (config.strategy === 'NONE') {
    return null;
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.accessToken;
  }

  if (config.strategy === 'SERVICE_ACCOUNT' && config.serviceAccountEmail && config.serviceAccountPrivateKey) {
    cachedToken = await requestServiceAccountAccessToken(
      config.serviceAccountEmail,
      config.serviceAccountPrivateKey,
      fetchFn,
    );
    return cachedToken.accessToken;
  }

  if (config.strategy === 'OAUTH2' && config.clientId && config.clientSecret && config.refreshToken) {
    cachedToken = await requestOAuth2AccessToken(
      config.clientId,
      config.clientSecret,
      config.refreshToken,
      fetchFn,
    );
    return cachedToken.accessToken;
  }

  return null;
}

export function clearGoogleTokenCache(): void {
  cachedToken = null;
}
