import { isWorkerDevHost } from "./kani-preview-gate.server";

const EXACT_REDIRECTS: Record<string, string> = {
  "/": "/reservar",
  "/reservar-turno": "/reservar",
  "/reservar-turno-liquid": "/reservar",
  "/reservar-turno-old": "/reservar",
  "/reserva-v2": "/reservar",
  "/reserva-v3": "/reservar",
  "/reserva-v4": "/reservar",
  "/reserva-v5": "/reservar",
  "/reservar-mercadopago": "/reservar",
  "/reservar-turno-mercadopago": "/reservar",
  "/contacto-liquid": "/contacto",
  "/contacto-old": "/contacto",
  "/estudio": "/contacto",
  "/cancelar": "/cancelar-turno",
  "/cancelar-turno-old": "/cancelar-turno",
  "/politica-de-privacidad-liquid": "/politica-de-privacidad",
  "/politica-de-privacidad-old": "/politica-de-privacidad",
  "/terminos-y-condiciones-liquid": "/terminos-y-condiciones",
  "/terminos-y-condiciones-old": "/terminos-y-condiciones",
  "/admin": "/panel-administracion",
  "/admin/datos": "/panel-administracion/datos",
  "/admin/estadisticas": "/panel-administracion/datos",
  "/admin/horarios": "/panel-administracion/horarios",
  "/admin/mantenimiento": "/panel-administracion/mantenimiento",
  "/admin/movil": "/panel-administracion/turnos",
  "/admin/pagos": "/panel-administracion/pagos",
  "/admin/turnos": "/panel-administracion/turnos",
  "/admin-liquid": "/panel-administracion",
  "/admin-v2": "/panel-administracion/inicio",
  "/admin-v2-liquid": "/panel-administracion",
  "/panel-v2": "/panel-administracion",
  "/panel-administracion-old": "/panel-administracion",
};

const PANEL_ADMIN_SUBPATHS = new Set([
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

const PANEL_V2_SUBPATH_MAP: Record<string, string> = {
  estadisticas: "/panel-administracion/datos",
  negocio: "/panel-administracion/pagos",
  "negocio/pagos": "/panel-administracion/pagos",
  "negocio/descuentos": "/panel-administracion/descuentos",
  "negocio/membresias": "/panel-administracion/membresias",
  operacion: "/panel-administracion/turnos",
  "operacion/turnos": "/panel-administracion/turnos",
  "operacion/horarios": "/panel-administracion/horarios",
  "operacion/clientes": "/panel-administracion/clientes",
};

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
 * Resolves Phase 2/3 server-side HTTP 301 redirects for root and legacy aliases.
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
      if (PANEL_ADMIN_SUBPATHS.has(rest)) {
        url.pathname = `/panel-administracion/${rest}`;
        return url.toString();
      }
    }

    if (normalized.startsWith("/panel-administracion-old/")) {
      const rest = normalized.slice("/panel-administracion-old/".length);
      if (PANEL_ADMIN_SUBPATHS.has(rest)) {
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

    if (normalized.startsWith("/panel-v2/")) {
      const rest = normalized.slice("/panel-v2/".length);
      const target = PANEL_V2_SUBPATH_MAP[rest];
      if (target) {
        url.pathname = target;
        return url.toString();
      }
    }

    if (normalized.startsWith("/admin-v2-liquid/")) {
      const rest = normalized.slice("/admin-v2-liquid/".length);
      const target = PANEL_V2_SUBPATH_MAP[rest];
      if (target) {
        url.pathname = target;
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
