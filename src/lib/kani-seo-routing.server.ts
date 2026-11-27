import { isWorkerDevHost } from "./kani-preview-gate.server";

const EXACT_REDIRECTS: Record<string, string> = {
  "/": "/reservar",
  "/reservar-turno": "/reservar",
  "/reservar-turno-liquid": "/reservar",
  "/reserva-v4": "/reservar",
  "/reservar-mercadopago": "/reservar",
  "/reservar-turno-mercadopago": "/reservar",
  "/contacto-liquid": "/contacto",
  "/estudio": "/contacto",
  "/cancelar": "/cancelar-turno",
  "/cancelar-turno-old": "/cancelar-turno",
  "/politica-de-privacidad-liquid": "/politica-de-privacidad",
  "/terminos-y-condiciones-liquid": "/terminos-y-condiciones",
  "/admin": "/panel-administracion",
  "/admin/mantenimiento": "/panel-administracion/mantenimiento",
  "/admin/estadisticas": "/panel-administracion/datos",
  "/admin-liquid": "/panel-administracion",
  "/admin-v2": "/panel-administracion/inicio",
};

const ADMIN_LIQUID_SUBPATHS = new Set([
  "inicio",
  "turnos",
  "pagos",
  "clientes",
  "horarios",
  "datos",
  "descuentos",
  "membresias",
  "mantenimiento",
]);

const ADMIN_V2_SUBPATHS = new Set([
  "inicio",
  "turnos",
  "pagos",
  "clientes",
  "horarios",
  "datos",
  "mantenimiento",
]);

const NOINDEX_PREFIXES = [
  "/panel-administracion",
  "/panel-administracion-old",
  "/panel-v2",
  "/panel-descuentos",
  "/panel-horarios",
  "/panel-membresias",
  "/panel-turnos",
  "/admin",
  "/admin-liquid",
  "/admin-v2",
  "/admin-v2-liquid",
  "/pago",
  "/membresia",
  "/verificar-membresia",
  "/activar-cuenta",
  "/restablecer-contrasena",
  "/acceso-privado",
  "/case-study",
];

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

function matchesPrefix(normalizedPath: string, prefix: string): boolean {
  return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
}

/**
 * Resolves Phase 2 server-side HTTP 301 redirects for root and legacy aliases.
 * Preserves query parameters and hash fragments, and avoids redirect chains.
 */
export function getLegacyRouteRedirectUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const normalized = normalizePathname(url.pathname);

    const exactTarget = EXACT_REDIRECTS[normalized];
    if (exactTarget) {
      url.pathname = exactTarget;
      return url.toString();
    }

    if (normalized.startsWith("/admin-liquid/")) {
      const rest = normalized.slice("/admin-liquid/".length);
      if (ADMIN_LIQUID_SUBPATHS.has(rest)) {
        url.pathname = `/panel-administracion/${rest}`;
        return url.toString();
      }
    }

    if (normalized.startsWith("/admin-v2/")) {
      const rest = normalized.slice("/admin-v2/".length);
      if (ADMIN_V2_SUBPATHS.has(rest)) {
        url.pathname = `/panel-administracion/${rest}`;
        return url.toString();
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Determines whether a response should carry `X-Robots-Tag: noindex, nofollow, noarchive`.
 * Always true on `*.workers.dev` hosts (even when Private Preview is off) and on
 * private, transactional, or tokenized routes.
 */
export function shouldApplyNoIndexHeader(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (isWorkerDevHost(url.hostname)) {
      return true;
    }

    const normalized = normalizePathname(url.pathname);
    if (NOINDEX_PREFIXES.some((prefix) => matchesPrefix(normalized, prefix))) {
      return true;
    }

    if (
      normalized === "/cancelar-turno" &&
      (url.searchParams.has("id") || url.searchParams.has("token"))
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function withSeoRobotsHeader(request: Request, response: Response): Response {
  if (!shouldApplyNoIndexHeader(request.url)) {
    return response;
  }
  if (response.headers.has("X-Robots-Tag")) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
