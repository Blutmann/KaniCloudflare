export const CANONICAL_PRODUCTION_ORIGIN = "https://www.kanibarber.com";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

const PRODUCTION_WORKER_HOSTS = new Set([
  "kanibarberstudio-cloudflare.kanibarber.workers.dev",
  "kanibarberstudio-cloudflare.tomasblutmannliriumprive.workers.dev",
]);

/**
 * Devuelve el origen canónico para generar enlaces y códigos QR de membresías.
 * En producción (incluyendo dominios personalizados y workers.dev) siempre usa
 * https://www.kanibarber.com. Solo conserva window.location.origin en localhost.
 */
export function getMembershipCanonicalOrigin(): string {
  if (typeof window !== "undefined" && window.location) {
    const hostname = (window.location.hostname || "").trim().toLowerCase();
    if (LOCAL_HOSTS.has(hostname) && window.location.origin) {
      return window.location.origin;
    }
  }
  return CANONICAL_PRODUCTION_ORIGIN;
}

export function buildMembershipCardUrl(token: string): string {
  const cleanToken = encodeURIComponent((token || "").trim());
  return `${getMembershipCanonicalOrigin()}/membresia/${cleanToken}`;
}

export function buildMembershipVerificationUrl(token: string): string {
  const cleanToken = encodeURIComponent((token || "").trim());
  return `${getMembershipCanonicalOrigin()}/verificar-membresia/${cleanToken}`;
}

/**
 * Valida que una ruta de retorno sea interna y pertenezca exclusivamente a las
 * vistas de membresía o verificación QR, previniendo redirecciones abiertas.
 */
export function isSafeInternalMembershipReturnPath(rawPath: string | null | undefined): boolean {
  if (!rawPath || typeof rawPath !== "string") return false;
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return false;
  if (/[\r\n\0\\]/.test(trimmed)) return false;

  try {
    const parsed = new URL(trimmed, CANONICAL_PRODUCTION_ORIGIN);
    if (parsed.origin !== CANONICAL_PRODUCTION_ORIGIN) return false;
    return (
      /^\/membresia\/[A-Za-z0-9_-]{16,128}$/.test(parsed.pathname) ||
      /^\/verificar-membresia\/[A-Za-z0-9_-]{16,128}$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export function sanitizeInternalMembershipReturnPath(rawPath: string | null | undefined): string | null {
  if (!isSafeInternalMembershipReturnPath(rawPath)) return null;
  const parsed = new URL(rawPath!.trim(), CANONICAL_PRODUCTION_ORIGIN);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Redirige enlaces antiguos de membresía / verificación QR servidos desde
 * workers.dev hacia el dominio canónico de producción (sin transferir tokens
 * de sesión por URL).
 */
export function getMembershipWorkerRedirectUrl(
  rawUrl: string,
  canonicalHost = "www.kanibarber.com",
): string | null {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.trim().toLowerCase();
    const isMembershipRoute =
      url.pathname.startsWith("/membresia/") || url.pathname.startsWith("/verificar-membresia/");

    if (!isMembershipRoute) return null;
    if (!PRODUCTION_WORKER_HOSTS.has(hostname)) return null;

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
