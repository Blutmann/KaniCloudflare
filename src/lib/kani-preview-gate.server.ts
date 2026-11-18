import kaniLogoLight from "../assets/kani-logo-light.webp";
import kaniLogoDark from "../assets/kani-logo-dark.webp";

export const PREVIEW_ACCESS_COOKIE_HOST = "__Host-kani-preview-access";
export const PREVIEW_ACCESS_COOKIE_DEV = "kani-preview-access";
export const PREVIEW_ACCESS_PATH = "/acceso-privado";
export const PREVIEW_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const PREVIEW_SESSION_TTL_MS = PREVIEW_SESSION_TTL_SECONDS * 1000;

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 8;

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const failedAttemptsByIp = new Map<string, RateLimitEntry>();

const PRODUCTION_WORKER_HOSTS = new Set([
  "kanibarberstudio-cloudflare.kanibarber.workers.dev",
  "kanibarberstudio-cloudflare.tomasblutmannliriumprive.workers.dev",
]);

const EXACT_EXCLUDED_PATHS = new Set([
  PREVIEW_ACCESS_PATH,
  "/api/webhook/mercadopago",
  "/api/webhook/whatsapp",
  "/api/webhook/pontiun",
  "/api/webhook/resend",
  "/api/integrations/google-calendar/callback",
  "/api/calendar/turno.ics",
  "/api/calendar/turno",
  "/googleb98699670c2c80a6.html",
  "/favicon.svg",
]);

function getEnvValue(name: string): string {
  const runtimeEnv = (
    globalThis as typeof globalThis & { __KANI_RUNTIME_ENV?: Record<string, string> }
  ).__KANI_RUNTIME_ENV;
  const raw = process.env[name] ?? runtimeEnv?.[name] ?? "";
  return typeof raw === "string" ? raw.trim() : "";
}

export function isPrivatePreviewEnabled(): boolean {
  return getEnvValue("KANI_PRIVATE_PREVIEW_ENABLED").toLowerCase() === "true";
}

export function getPreviewAccessPassword(): string {
  return getEnvValue("KANI_PREVIEW_ACCESS_PASSWORD");
}

function getPreviewSigningSecret(): string {
  const explicit = getEnvValue("KANI_PREVIEW_SESSION_SECRET");
  if (explicit.length >= 16) return explicit;
  return getPreviewAccessPassword();
}

export function isPreviewExcludedPath(pathname: string): boolean {
  if (EXACT_EXCLUDED_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/assets/")) return true;
  return false;
}

export function isWorkerDevHost(hostname: string): boolean {
  const clean = hostname.trim().toLowerCase();
  return PRODUCTION_WORKER_HOSTS.has(clean) || clean.endsWith(".workers.dev");
}

export function getWorkerCanonicalRedirectUrl(
  rawUrl: string,
  canonicalHost = "www.kanibarber.com",
): string | null {
  try {
    const url = new URL(rawUrl);
    if (!isWorkerDevHost(url.hostname)) return null;
    if (isPreviewExcludedPath(url.pathname)) return null;

    const cleanCanonical = canonicalHost.trim().toLowerCase();
    if (cleanCanonical !== "www.kanibarber.com" && cleanCanonical !== "kanibarber.com") {
      return null;
    }

    url.protocol = "https:";
    url.hostname = cleanCanonical;
    url.port = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizePreviewReturnPath(rawPath: string | null | undefined): string {
  if (!rawPath || typeof rawPath !== "string") return "/";
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/";
  if (/[\r\n\0\\]/.test(trimmed)) return "/";

  try {
    const parsed = new URL(trimmed, "https://www.kanibarber.com");
    if (parsed.origin !== "https://www.kanibarber.com") return "/";
    if (parsed.pathname === PREVIEW_ACCESS_PATH) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const material = new TextEncoder().encode(`kani-preview-session-v1:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function constantTimePasswordEquals(
  candidate: string,
  expected: string,
): Promise<boolean> {
  if (!expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const bytesA = new Uint8Array(a);
  const bytesB = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i += 1) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

export type PreviewSessionPayload = {
  v: 1;
  iat: number;
  exp: number;
  n: string;
};

export async function createPreviewSessionToken(
  secret: string,
  now = Date.now(),
): Promise<string> {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(12));
  const payload: PreviewSessionPayload = {
    v: 1,
    iat: now,
    exp: now + PREVIEW_SESSION_TTL_MS,
    n: encodeBase64Url(nonceBytes),
  };
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encodedPayload),
  );
  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyPreviewSessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<PreviewSessionPayload | null> {
  if (!token || !secret || token.length > 512) return null;
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0 || dotIdx === token.length - 1) return null;

  const encodedPayload = token.slice(0, dotIdx);
  const encodedSig = token.slice(dotIdx + 1);
  if (!encodedPayload || !encodedSig || encodedSig.includes(".")) return null;

  const sigBytes = decodeBase64Url(encodedSig);
  const payloadBytes = decodeBase64Url(encodedPayload);
  if (!sigBytes || !payloadBytes) return null;

  try {
    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(encodedPayload),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as PreviewSessionPayload;
    if (
      payload.v !== 1 ||
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= now ||
      typeof payload.n !== "string" ||
      payload.n.length < 8
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (!name) continue;
    try {
      map.set(name, decodeURIComponent(val));
    } catch {
      map.set(name, val);
    }
  }
  return map;
}

export function getPreviewCookieName(request: Request): string {
  try {
    const url = new URL(request.url);
    return url.protocol === "https:" ? PREVIEW_ACCESS_COOKIE_HOST : PREVIEW_ACCESS_COOKIE_DEV;
  } catch {
    return PREVIEW_ACCESS_COOKIE_HOST;
  }
}

export function buildPreviewSessionCookie(request: Request, token: string): string {
  const name = getPreviewCookieName(request);
  const isHttps = name === PREVIEW_ACCESS_COOKIE_HOST;
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${PREVIEW_SESSION_TTL_SECONDS}`,
  ];
  if (isHttps) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export async function hasValidPreviewSession(request: Request): Promise<boolean> {
  const secret = getPreviewSigningSecret();
  if (!secret) return false;
  const cookies = parseCookies(request.headers.get("cookie"));
  const token =
    cookies.get(PREVIEW_ACCESS_COOKIE_HOST) ?? cookies.get(PREVIEW_ACCESS_COOKIE_DEV);
  const verified = await verifyPreviewSessionToken(token, secret);
  return verified !== null;
}

function getClientIp(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return "unknown";
}

function getEdgeCache(): Cache | null {
  try {
    const g = globalThis as typeof globalThis & { caches?: { default?: Cache } };
    return g.caches?.default ?? null;
  } catch {
    return null;
  }
}

async function getRateLimitCacheKey(ip: string): Promise<Request> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`kani-rl-v1:${ip}`));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return new Request(`https://preview-ratelimit.kanibarber.internal/v1/ip/${hex}`, {
    method: "GET",
  });
}

async function readRateLimitEntry(ip: string, now = Date.now()): Promise<RateLimitEntry | null> {
  const mem = failedAttemptsByIp.get(ip);
  if (mem && now < mem.resetAt) {
    return mem;
  }
  if (mem && now >= mem.resetAt) {
    failedAttemptsByIp.delete(ip);
  }

  const cache = getEdgeCache();
  if (!cache) return null;

  try {
    const key = await getRateLimitCacheKey(ip);
    const cached = await cache.match(key);
    if (!cached) return null;
    const parsed = (await cached.json()) as RateLimitEntry;
    if (!parsed || typeof parsed.count !== "number" || typeof parsed.resetAt !== "number") {
      return null;
    }
    if (now >= parsed.resetAt) {
      await cache.delete(key);
      return null;
    }
    failedAttemptsByIp.set(ip, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function isRateLimited(ip: string, now = Date.now()): Promise<boolean> {
  const entry = await readRateLimitEntry(ip, now);
  if (!entry) return false;
  return entry.count >= RATE_LIMIT_MAX_ATTEMPTS;
}

async function recordFailedAttempt(ip: string, now = Date.now()): Promise<void> {
  const existing = await readRateLimitEntry(ip, now);
  const next: RateLimitEntry =
    !existing || now >= existing.resetAt
      ? { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }
      : { count: existing.count + 1, resetAt: existing.resetAt };

  failedAttemptsByIp.set(ip, next);
  if (failedAttemptsByIp.size > 2000) {
    for (const [k, v] of failedAttemptsByIp.entries()) {
      if (now >= v.resetAt) failedAttemptsByIp.delete(k);
    }
  }

  const cache = getEdgeCache();
  if (cache) {
    try {
      const key = await getRateLimitCacheKey(ip);
      const ttlSeconds = Math.max(1, Math.ceil((next.resetAt - now) / 1000));
      await cache.put(
        key,
        new Response(JSON.stringify(next), {
          headers: {
            "content-type": "application/json",
            "cache-control": `public, max-age=${ttlSeconds}`,
          },
        }),
      );
    } catch {
      // Ignore edge cache write errors cleanly
    }
  }
}

async function clearFailedAttempts(ip: string): Promise<void> {
  failedAttemptsByIp.delete(ip);
  const cache = getEdgeCache();
  if (cache) {
    try {
      const key = await getRateLimitCacheKey(ip);
      await cache.delete(key);
    } catch {
      // Ignore edge cache delete errors cleanly
    }
  }
}

export function resetPreviewRateLimitForTests(): void {
  failedAttemptsByIp.clear();
}

export function withPrivatePreviewHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("Vary", "Cookie");
  const contentType = headers.get("content-type") ?? "";
  if (
    contentType.includes("text/html") ||
    contentType.includes("application/json") ||
    response.status === 302 ||
    response.status === 303 ||
    response.status === 307 ||
    response.status === 401
  ) {
    headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate, max-age=0");
    headers.set("Pragma", "no-cache");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderPreviewGateHtml(options: {
  nextPath: string;
  errorMessage?: string;
}): string {
  const safeNext = escapeHtmlAttr(sanitizePreviewReturnPath(options.nextPath));
  const errorHtml = options.errorMessage
    ? `<p class="gate-error" role="alert" id="gate-error">${escapeHtmlAttr(options.errorMessage)}</p>`
    : `<p class="gate-error" role="alert" id="gate-error" hidden></p>`;

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <title>Acceso privado — KANI Barber Studio</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Antique&display=swap" />
    <script>
      try {
        var t = window.localStorage.getItem('kani-theme');
        if (t === 'dark' || t === 'light') {
          document.documentElement.dataset.theme = t;
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
          document.documentElement.dataset.theme = 'dark';
        } else {
          document.documentElement.dataset.theme = 'light';
        }
      } catch (e) {}
    </script>
    <style>
      :root {
        --bg-base: #f5f3ee;
        --bg-glow-1: rgba(212, 189, 148, 0.24);
        --bg-glow-2: rgba(180, 174, 162, 0.22);
        --glass-bg: rgba(255, 255, 255, 0.68);
        --glass-border: rgba(255, 255, 255, 0.72);
        --glass-shadow: 0 24px 60px -18px rgba(18, 16, 12, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.85);
        --text-primary: #171614;
        --text-secondary: #5c5852;
        --input-bg: rgba(255, 255, 255, 0.76);
        --input-border: rgba(23, 22, 20, 0.14);
        --input-focus: rgba(23, 22, 20, 0.42);
        --btn-bg: #171614;
        --btn-fg: #f7f5f0;
        --btn-hover: #2d2b27;
        --error-fg: #9f2d2d;
        --error-bg: rgba(159, 45, 45, 0.08);
        --error-border: rgba(159, 45, 45, 0.2);
      }

      html[data-theme="dark"] {
        --bg-base: #0c0c0b;
        --bg-glow-1: rgba(196, 164, 112, 0.14);
        --bg-glow-2: rgba(92, 92, 96, 0.16);
        --glass-bg: rgba(22, 22, 20, 0.72);
        --glass-border: rgba(255, 255, 255, 0.12);
        --glass-shadow: 0 28px 64px -16px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        --text-primary: #f4f1ea;
        --text-secondary: #a8a298;
        --input-bg: rgba(255, 255, 255, 0.06);
        --input-border: rgba(255, 255, 255, 0.15);
        --input-focus: rgba(244, 241, 234, 0.45);
        --btn-bg: #f4f1ea;
        --btn-fg: #121110;
        --btn-hover: #e2ddd2;
        --error-fg: #f29b9b;
        --error-bg: rgba(242, 155, 155, 0.1);
        --error-border: rgba(242, 155, 155, 0.24);
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        margin: 0;
        padding: 0;
        min-height: 100%;
        min-height: 100dvh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
        background-color: var(--bg-base);
        color: var(--text-primary);
        -webkit-font-smoothing: antialiased;
      }

      body {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: max(1.25rem, env(safe-area-inset-top)) max(1.25rem, env(safe-area-inset-right)) max(1.25rem, env(safe-area-inset-bottom)) max(1.25rem, env(safe-area-inset-left));
        background-image:
          radial-gradient(circle at 18% 20%, var(--bg-glow-1), transparent 46%),
          radial-gradient(circle at 82% 80%, var(--bg-glow-2), transparent 48%);
      }

      .gate-card {
        width: 100%;
        max-width: 420px;
        padding: 2.25rem 1.85rem 2rem;
        border-radius: 28px;
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        box-shadow: var(--glass-shadow);
        backdrop-filter: blur(24px) saturate(160%);
        -webkit-backdrop-filter: blur(24px) saturate(160%);
        text-align: center;
      }

      .gate-logo-wrap {
        display: flex;
        justify-content: center;
        margin-bottom: 1.5rem;
      }

      .gate-logo {
        height: 44px;
        width: auto;
        object-fit: contain;
      }

      .gate-logo-dark { display: none; }
      html[data-theme="dark"] .gate-logo-light { display: none; }
      html[data-theme="dark"] .gate-logo-dark { display: block; }

      .gate-title {
        font-family: "Zen Antique", Georgia, serif;
        font-size: 1.5rem;
        font-weight: 400;
        letter-spacing: 0.02em;
        margin: 0 0 0.65rem;
        color: var(--text-primary);
      }

      .gate-description {
        margin: 0 0 1.65rem;
        font-size: 0.92rem;
        line-height: 1.55;
        color: var(--text-secondary);
      }

      .gate-form {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
        text-align: left;
      }

      .gate-label {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }

      .gate-input-wrap {
        position: relative;
        display: flex;
        align-items: center;
      }

      .gate-input {
        width: 100%;
        height: 48px;
        padding: 0 3rem 0 1rem;
        border-radius: 14px;
        border: 1px solid var(--input-border);
        background: var(--input-bg);
        color: var(--text-primary);
        font-size: 16px;
        outline: none;
        transition: border-color 0.18s ease, box-shadow 0.18s ease;
      }

      .gate-input::placeholder {
        color: var(--text-secondary);
        opacity: 0.78;
      }

      .gate-input:focus {
        border-color: var(--input-focus);
        box-shadow: 0 0 0 3px rgba(168, 162, 152, 0.16);
      }

      .gate-toggle {
        position: absolute;
        right: 0.5rem;
        width: 36px;
        height: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        background: transparent;
        color: var(--text-secondary);
        border-radius: 10px;
        cursor: pointer;
        padding: 0;
      }

      .gate-toggle:hover {
        color: var(--text-primary);
      }

      .gate-error {
        margin: 0;
        padding: 0.6rem 0.85rem;
        border-radius: 12px;
        font-size: 0.84rem;
        line-height: 1.4;
        color: var(--error-fg);
        background: var(--error-bg);
        border: 1px solid var(--error-border);
        text-align: center;
      }

      .gate-error[hidden] {
        display: none;
      }

      .gate-submit {
        height: 48px;
        margin-top: 0.25rem;
        border: 0;
        border-radius: 14px;
        background: var(--btn-bg);
        color: var(--btn-fg);
        font-size: 0.95rem;
        font-weight: 500;
        letter-spacing: 0.02em;
        cursor: pointer;
        transition: background-color 0.18s ease, opacity 0.18s ease, transform 0.12s ease;
      }

      .gate-submit:hover {
        background: var(--btn-hover);
      }

      .gate-submit:active {
        transform: scale(0.99);
      }

      .gate-submit:disabled {
        opacity: 0.65;
        cursor: wait;
      }
    </style>
  </head>
  <body>
    <main class="gate-card">
      <div class="gate-logo-wrap">
        <img src="${escapeHtmlAttr(kaniLogoLight)}" alt="KANI Barber Studio" class="gate-logo gate-logo-light" />
        <img src="${escapeHtmlAttr(kaniLogoDark)}" alt="KANI Barber Studio" class="gate-logo gate-logo-dark" />
      </div>
      <h1 class="gate-title">Acceso privado</h1>
      <p class="gate-description">
        KANI Barber Studio se encuentra en una etapa de pruebas privadas. Ingresá la contraseña de acceso para continuar.
      </p>
      <form class="gate-form" id="preview-access-form" method="POST" action="${PREVIEW_ACCESS_PATH}" novalidate>
        <input type="hidden" name="next" id="next-input" value="${safeNext}" />
        <label class="gate-label" for="preview-password">Contraseña de acceso</label>
        <div class="gate-input-wrap">
          <input
            class="gate-input"
            id="preview-password"
            name="password"
            type="password"
            autocomplete="current-password"
            placeholder="Contraseña de acceso"
            required
            autofocus
          />
          <button
            type="button"
            class="gate-toggle"
            id="toggle-password"
            aria-label="Mostrar contraseña"
            aria-pressed="false"
          >
            <svg id="icon-eye" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <svg id="icon-eye-off" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden>
              <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/>
              <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/>
              <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/>
              <path d="m2 2 20 20"/>
            </svg>
          </button>
        </div>
        ${errorHtml}
        <button class="gate-submit" id="submit-btn" type="submit">Ingresar</button>
      </form>
    </main>
    <script>
      (function () {
        var form = document.getElementById('preview-access-form');
        var input = document.getElementById('preview-password');
        var toggle = document.getElementById('toggle-password');
        var eye = document.getElementById('icon-eye');
        var eyeOff = document.getElementById('icon-eye-off');
        var errorEl = document.getElementById('gate-error');
        var submitBtn = document.getElementById('submit-btn');
        var nextInput = document.getElementById('next-input');

        if (toggle && input && eye && eyeOff) {
          toggle.addEventListener('click', function () {
            var isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            toggle.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
            toggle.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
            eye.hidden = isPassword;
            eyeOff.hidden = !isPassword;
          });
        }

        if (form && input && errorEl && submitBtn) {
          form.addEventListener('submit', function (event) {
            if (!window.fetch) return;
            event.preventDefault();
            errorEl.hidden = true;
            errorEl.textContent = '';
            submitBtn.disabled = true;

            var body = new URLSearchParams();
            body.set('password', input.value || '');
            body.set('next', nextInput ? nextInput.value : '/');

            fetch('${PREVIEW_ACCESS_PATH}', {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
              },
              credentials: 'same-origin',
              body: body.toString()
            })
              .then(function (res) {
                return res.json().then(function (data) {
                  return { ok: res.ok, data: data };
                });
              })
              .then(function (result) {
                if (result.ok && result.data && result.data.ok) {
                  if (window.location.pathname !== '${PREVIEW_ACCESS_PATH}') {
                    window.location.reload();
                  } else {
                    window.location.replace((result.data.redirectTo || '/') + (window.location.hash || ''));
                  }
                  return;
                }
                errorEl.textContent = (result.data && result.data.error) || 'Contraseña incorrecta. Intentá nuevamente.';
                errorEl.hidden = false;
                input.focus();
                input.select();
              })
              .catch(function () {
                errorEl.textContent = 'Contraseña incorrecta. Intentá nuevamente.';
                errorEl.hidden = false;
              })
              .finally(function () {
                submitBtn.disabled = false;
              });
          });
        }
      })();
    </script>
  </body>
</html>`;
}

function renderPreviewUnavailableHtml(): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <title>Acceso privado — KANI Barber Studio</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.5rem; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0c0c0b; color: #f4f1ea; text-align: center; }
      .box { max-width: 400px; }
      h1 { font-size: 1.25rem; font-weight: 500; margin: 0 0 0.6rem; }
      p { font-size: 0.92rem; color: #a8a298; line-height: 1.55; margin: 0; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>Acceso privado</h1>
      <p>El entorno privado de pruebas todavía no está disponible. Intentá nuevamente en unos minutos.</p>
    </div>
  </body>
</html>`;
}

export async function handlePrivatePreviewGate(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const enabled = isPrivatePreviewEnabled();

  if (!enabled) {
    if (url.pathname === PREVIEW_ACCESS_PATH) {
      const nextPath = sanitizePreviewReturnPath(url.searchParams.get("next"));
      return new Response(null, {
        status: 302,
        headers: {
          Location: nextPath,
          "Cache-Control": "no-store",
        },
      });
    }
    return null;
  }

  // Normalize workers.dev traffic to canonical domain when private preview is active
  const workerRedirect = getWorkerCanonicalRedirectUrl(
    request.url,
    getEnvValue("KANI_CANONICAL_HOST") || "www.kanibarber.com",
  );
  if (workerRedirect) {
    return withPrivatePreviewHeaders(Response.redirect(workerRedirect, 302));
  }

  // Strict technical exclusions (webhooks, external OAuth callback, signed .ics, static assets)
  if (isPreviewExcludedPath(url.pathname) && url.pathname !== PREVIEW_ACCESS_PATH) {
    return null;
  }

  const configuredPassword = getPreviewAccessPassword();
  const signingSecret = getPreviewSigningSecret();
  if (!configuredPassword || !signingSecret) {
    console.error(
      "[PreviewGate] KANI_PRIVATE_PREVIEW_ENABLED=true pero falta configurar KANI_PREVIEW_ACCESS_PASSWORD.",
    );
    return withPrivatePreviewHeaders(
      new Response(renderPreviewUnavailableHtml(), {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
  }

  if (url.pathname === PREVIEW_ACCESS_PATH) {
    if (request.method === "GET" || request.method === "HEAD") {
      const nextPath = sanitizePreviewReturnPath(url.searchParams.get("next"));
      if (await hasValidPreviewSession(request)) {
        return withPrivatePreviewHeaders(
          new Response(null, {
            status: 302,
            headers: { Location: nextPath },
          }),
        );
      }
      return withPrivatePreviewHeaders(
        new Response(renderPreviewGateHtml({ nextPath }), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }

    if (request.method === "POST") {
      const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
      const ip = getClientIp(request);

      let submittedPassword = "";
      let rawNext = "/";
      const contentType = request.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        try {
          const json = (await request.json()) as { password?: unknown; next?: unknown };
          submittedPassword = typeof json.password === "string" ? json.password : "";
          rawNext = typeof json.next === "string" ? json.next : "/";
        } catch {
          submittedPassword = "";
        }
      } else {
        try {
          const form = await request.formData();
          const pw = form.get("password");
          const nx = form.get("next");
          submittedPassword = typeof pw === "string" ? pw : "";
          rawNext = typeof nx === "string" ? nx : "/";
        } catch {
          submittedPassword = "";
        }
      }

      const safeNext = sanitizePreviewReturnPath(rawNext);

      if (await isRateLimited(ip)) {
        const rateMsg = "Demasiados intentos. Esperá unos minutos e intentá nuevamente.";
        if (wantsJson) {
          return withPrivatePreviewHeaders(
            new Response(JSON.stringify({ ok: false, error: rateMsg }), {
              status: 429,
              headers: {
                "content-type": "application/json",
                "Retry-After": "900",
              },
            }),
          );
        }
        return withPrivatePreviewHeaders(
          new Response(renderPreviewGateHtml({ nextPath: safeNext, errorMessage: rateMsg }), {
            status: 429,
            headers: {
              "content-type": "text/html; charset=utf-8",
              "Retry-After": "900",
            },
          }),
        );
      }

      const isValid = await constantTimePasswordEquals(submittedPassword, configuredPassword);
      if (!isValid) {
        await recordFailedAttempt(ip);
        const errorMsg = "Contraseña incorrecta. Intentá nuevamente.";
        if (wantsJson) {
          return withPrivatePreviewHeaders(
            new Response(JSON.stringify({ ok: false, error: errorMsg }), {
              status: 401,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return withPrivatePreviewHeaders(
          new Response(renderPreviewGateHtml({ nextPath: safeNext, errorMessage: errorMsg }), {
            status: 401,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
      }

      await clearFailedAttempts(ip);
      const token = await createPreviewSessionToken(signingSecret);
      const cookieHeader = buildPreviewSessionCookie(request, token);

      if (wantsJson) {
        return withPrivatePreviewHeaders(
          new Response(JSON.stringify({ ok: true, redirectTo: safeNext }), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "Set-Cookie": cookieHeader,
            },
          }),
        );
      }

      return withPrivatePreviewHeaders(
        new Response(null, {
          status: 303,
          headers: {
            Location: safeNext,
            "Set-Cookie": cookieHeader,
          },
        }),
      );
    }

    return withPrivatePreviewHeaders(new Response("Method Not Allowed", { status: 405 }));
  }

  // All other routes require a valid preview session
  if (await hasValidPreviewSession(request)) {
    return null;
  }

  const isBrowserNavigation =
    (request.method === "GET" || request.method === "HEAD") &&
    !url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/_server");

  if (isBrowserNavigation) {
    const requestedPath = sanitizePreviewReturnPath(`${url.pathname}${url.search}`);
    return withPrivatePreviewHeaders(
      new Response(renderPreviewGateHtml({ nextPath: requestedPath }), {
        status: 401,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
  }

  return withPrivatePreviewHeaders(
    new Response(JSON.stringify({ error: "PRIVATE_PREVIEW_AUTH_REQUIRED" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  );
}
