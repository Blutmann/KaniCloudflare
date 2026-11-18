import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PREVIEW_ACCESS_COOKIE_HOST,
  PREVIEW_ACCESS_PATH,
  PREVIEW_SESSION_TTL_SECONDS,
  createPreviewSessionToken,
  getWorkerCanonicalRedirectUrl,
  handlePrivatePreviewGate,
  isPreviewExcludedPath,
  resetPreviewRateLimitForTests,
  sanitizePreviewReturnPath,
  verifyPreviewSessionToken,
} from "@/lib/kani-preview-gate.server";

const originalEnv = { ...process.env };
const originalCaches = (globalThis as { caches?: unknown }).caches;

function setPreviewEnv(enabled: string, password = "kani-secret-preview-2026") {
  process.env.KANI_PRIVATE_PREVIEW_ENABLED = enabled;
  process.env.KANI_PREVIEW_ACCESS_PASSWORD = password;
  delete process.env.KANI_PREVIEW_SESSION_SECRET;
}

function createMockEdgeCache() {
  const store = new Map<string, { body: string; headers: HeadersInit }>();
  return {
    async match(req: Request) {
      const hit = store.get(req.url);
      if (!hit) return undefined;
      return new Response(hit.body, { headers: hit.headers });
    },
    async put(req: Request, res: Response) {
      const body = await res.clone().text();
      store.set(req.url, { body, headers: res.headers });
    },
    async delete(req: Request) {
      return store.delete(req.url);
    },
  };
}

describe("KANI — Modo privado de pruebas con contraseña general", () => {
  beforeEach(() => {
    resetPreviewRateLimitForTests();
    setPreviewEnv("true");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    (globalThis as { caches?: unknown }).caches = originalCaches;
    resetPreviewRateLimitForTests();
  });

  it("sirve la pantalla de acceso in-place (401 HTML sin 302) en /, /reservar, /panel-administracion, membresías, QR, activación y recuperación", async () => {
    const routes = [
      "/",
      "/reservar",
      "/panel-administracion",
      "/contacto",
      "/panel-membresias",
      "/panel-descuentos",
      "/membresia/tok_abc1234567890123",
      "/verificar-membresia/tok_abc1234567890123",
      "/activar-cuenta?token_hash=invite_123&type=invite",
      "/restablecer-contrasena",
    ];

    for (const route of routes) {
      const res = await handlePrivatePreviewGate(
        new Request(`https://www.kanibarber.com${route}`, { method: "GET" }),
      );
      expect(res).not.toBeNull();
      expect(res!.status).toBe(401);
      expect(res!.headers.get("content-type")).toContain("text/html");
      expect(res!.headers.get("x-robots-tag")).toContain("noindex");
      expect(res!.headers.get("cache-control")).toContain("no-store");
      const html = await res!.text();
      expect(html).toContain("Acceso privado");
      expect(html).toContain(`value="${route.replaceAll("&", "&amp;")}"`);
    }
  });

  it("flujo realista Supabase Auth con fragmento #token_hash=...&type=recovery e invite: nunca pierde ni filtra el fragmento", async () => {
    // 1. El navegador abre https://www.kanibarber.com/restablecer-contrasena#token_hash=secret_hash&type=recovery
    //    El fragmento queda en el navegador; el servidor recibe GET /restablecer-contrasena.
    const gateRes = await handlePrivatePreviewGate(
      new Request("https://www.kanibarber.com/restablecer-contrasena", { method: "GET" }),
    );
    expect(gateRes!.status).toBe(401);
    const gateHtml = await gateRes!.text();
    // Sin redirección 302 y con reload in-place para conservar window.location.hash en Safari iOS / Chrome
    expect(gateHtml).toContain("window.location.reload()");
    expect(gateHtml).not.toContain("secret_hash");

    // 2. El usuario ingresa la contraseña general de acceso privado (solo se envía password + next)
    const unlockRes = await handlePrivatePreviewGate(
      new Request("https://www.kanibarber.com/acceso-privado", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "cf-connecting-ip": "198.51.100.12",
        },
        body: JSON.stringify({
          password: "kani-secret-preview-2026",
          next: "/restablecer-contrasena",
        }),
      }),
    );
    expect(unlockRes!.status).toBe(200);
    const setCookie = unlockRes!.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${PREVIEW_ACCESS_COOKIE_HOST}=`);
    expect(setCookie).not.toContain("secret_hash");

    // 3. window.location.reload() vuelve a pedir /restablecer-contrasena con la cookie HttpOnly
    //    y mantiene #token_hash=secret_hash&type=recovery intacto en el navegador para supabase.auth.verifyOtp
    const cookiePair = setCookie.split(";")[0]!;
    const afterReload = await handlePrivatePreviewGate(
      new Request("https://www.kanibarber.com/restablecer-contrasena", {
        method: "GET",
        headers: { cookie: cookiePair },
      }),
    );
    expect(afterReload).toBeNull();

    // 4. Lo mismo aplica para enlaces de invitación/activación (/activar-cuenta)
    const inviteAfterReload = await handlePrivatePreviewGate(
      new Request("https://www.kanibarber.com/activar-cuenta", {
        method: "GET",
        headers: { cookie: cookiePair },
      }),
    );
    expect(inviteAfterReload).toBeNull();
  });

  it("bloquea /_server y /api/admin/* sin autorización con 401 JSON", async () => {
    for (const apiPath of ["/_server", "/api/admin/online-deposits", "/api/admin/calendar-sync/status"]) {
      const res = await handlePrivatePreviewGate(
        new Request(`https://www.kanibarber.com${apiPath}`, { method: "POST" }),
      );
      expect(res).not.toBeNull();
      expect(res!.status).toBe(401);
      const payload = (await res!.json()) as { error: string };
      expect(payload.error).toBe("PRIVATE_PREVIEW_AUTH_REQUIRED");
    }
  });

  it("falla cerrado (503) si KANI_PRIVATE_PREVIEW_ENABLED=true pero falta KANI_PREVIEW_ACCESS_PASSWORD", async () => {
    process.env.KANI_PREVIEW_ACCESS_PASSWORD = "";
    const res = await handlePrivatePreviewGate(
      new Request("https://www.kanibarber.com/", { method: "GET" }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    expect(res!.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("renderiza la pantalla de acceso privado con logo KANI, Liquid Glass, Light/Dark, textos exactos y toggle de contraseña", async () => {
    const res = await handlePrivatePreviewGate(
      new Request("https://www.kanibarber.com/acceso-privado?next=%2Freservar", {
        method: "GET",
      }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("x-robots-tag")).toContain("noindex");
    expect(res!.headers.get("cache-control")).toContain("no-store");

    const html = await res!.text();
    expect(html).toContain("Acceso privado");
    expect(html).toContain(
      "KANI Barber Studio se encuentra en una etapa de pruebas privadas. Ingresá la contraseña de acceso para continuar.",
    );
    expect(html).toContain("Contraseña de acceso");
    expect(html).toContain("Ingresar");
    expect(html).toContain('id="toggle-password"');
    expect(html).toContain('value="/reservar"');
    expect(html).toContain("kani-logo-light");
    expect(html).toContain("kani-logo-dark");
    expect(html).toContain('name="robots" content="noindex, nofollow, noarchive"');
    expect(html).not.toContain("kani-secret-preview-2026");
  });

  it("comparte el contador de rate limiting entre distintas instancias de Worker mediante Cloudflare Edge Cache (8 intentos / 15 min)", async () => {
    (globalThis as { caches?: unknown }).caches = { default: createMockEdgeCache() };

    // Instancia A registra 5 intentos fallidos
    for (let i = 0; i < 5; i += 1) {
      const res = await handlePrivatePreviewGate(
        new Request("https://www.kanibarber.com/acceso-privado", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "cf-connecting-ip": "203.0.113.50",
          },
          body: JSON.stringify({ password: "wrong-password", next: "/reservar" }),
        }),
      );
      expect(res!.status).toBe(401);
      const body = (await res!.json()) as { ok: boolean; error: string };
      expect(body.error).toBe("Contraseña incorrecta. Intentá nuevamente.");
    }

    // Simula cambio a Instancia B limpiando el Map en memoria local
    resetPreviewRateLimitForTests();

    // Instancia B registra 3 intentos fallidos más (total = 8)
    for (let i = 0; i < 3; i += 1) {
      const res = await handlePrivatePreviewGate(
        new Request("https://www.kanibarber.com/acceso-privado", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "cf-connecting-ip": "203.0.113.50",
          },
          body: JSON.stringify({ password: "wrong-password", next: "/reservar" }),
        }),
      );
      expect(res!.status).toBe(401);
    }

    // 9.º intento en Instancia B queda bloqueado con 429 aunque sea la contraseña correcta
    const blocked = await handlePrivatePreviewGate(
      new Request("https://www.kanibarber.com/acceso-privado", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "cf-connecting-ip": "203.0.113.50",
        },
        body: JSON.stringify({ password: "kani-secret-preview-2026", next: "/reservar" }),
      }),
    );
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get("retry-after")).toBe("900");
  });

  it("emite cookie HttpOnly/Secure/SameSite=Lax de 7 días sin exponer la contraseña, conserva URL y permite navegar", async () => {
    const loginRes = await handlePrivatePreviewGate(
      new Request("https://www.kanibarber.com/acceso-privado", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "cf-connecting-ip": "203.0.113.99",
        },
        body: JSON.stringify({
          password: "kani-secret-preview-2026",
          next: "/verificar-membresia/tok_abc1234567890123",
        }),
      }),
    );

    expect(loginRes!.status).toBe(200);
    const body = (await loginRes!.json()) as { ok: boolean; redirectTo: string };
    expect(body.ok).toBe(true);
    expect(body.redirectTo).toBe("/verificar-membresia/tok_abc1234567890123");

    const setCookie = loginRes!.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${PREVIEW_ACCESS_COOKIE_HOST}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain(`Max-Age=${PREVIEW_SESSION_TTL_SECONDS}`);
    expect(setCookie).not.toContain("kani-secret-preview-2026");

    const cookiePair = setCookie.split(";")[0]!;
    const followUp = await handlePrivatePreviewGate(
      new Request("https://www.kanibarber.com/reservar", {
        method: "GET",
        headers: { cookie: cookiePair },
      }),
    );
    expect(followUp).toBeNull();
  });

  it("invalida tokens expirados o manipulados", async () => {
    const expired = await createPreviewSessionToken(
      "kani-secret-preview-2026",
      Date.now() - (PREVIEW_SESSION_TTL_SECONDS + 60) * 1000,
    );
    expect(await verifyPreviewSessionToken(expired, "kani-secret-preview-2026")).toBeNull();

    const valid = await createPreviewSessionToken("kani-secret-preview-2026");
    const tampered = `${valid.slice(0, -2)}xx`;
    expect(await verifyPreviewSessionToken(tampered, "kani-secret-preview-2026")).toBeNull();

    const res = await handlePrivatePreviewGate(
      new Request("https://www.kanibarber.com/panel-administracion", {
        method: "GET",
        headers: { cookie: `${PREVIEW_ACCESS_COOKIE_HOST}=${expired}` },
      }),
    );
    expect(res!.status).toBe(401);
  });

  it("previene open redirects en el parámetro next", () => {
    expect(sanitizePreviewReturnPath("https://evil.com/phish")).toBe("/");
    expect(sanitizePreviewReturnPath("//evil.com/phish")).toBe("/");
    expect(sanitizePreviewReturnPath("/\\evil.com")).toBe("/");
    expect(sanitizePreviewReturnPath("/acceso-privado")).toBe("/");
    expect(sanitizePreviewReturnPath("/reservar?barber=valentin")).toBe(
      "/reservar?barber=valentin",
    );
  });

  it("mantiene exclusiones técnicas estrictas para webhooks, OAuth callback y .ics", async () => {
    const excluded = [
      "/api/webhook/mercadopago",
      "/api/webhook/whatsapp",
      "/api/webhook/pontiun",
      "/api/webhook/resend",
      "/api/integrations/google-calendar/callback",
      "/api/calendar/turno.ics",
    ];
    for (const path of excluded) {
      expect(isPreviewExcludedPath(path)).toBe(true);
      const res = await handlePrivatePreviewGate(
        new Request(`https://www.kanibarber.com${path}`, { method: "POST" }),
      );
      expect(res).toBeNull();
    }
    expect(isPreviewExcludedPath("/api/admin/online-deposits")).toBe(false);
    expect(isPreviewExcludedPath("/_server")).toBe(false);
  });

  it("evita bypass desde workers.dev normalizando hacia www.kanibarber.com", async () => {
    const redirect = getWorkerCanonicalRedirectUrl(
      "https://kanibarberstudio-cloudflare.kanibarber.workers.dev/reservar",
      "www.kanibarber.com",
    );
    expect(redirect).toBe("https://www.kanibarber.com/reservar");

    const res = await handlePrivatePreviewGate(
      new Request("https://kanibarberstudio-cloudflare.kanibarber.workers.dev/reservar", {
        method: "GET",
      }),
    );
    expect(res!.status).toBe(302);
    expect(res!.headers.get("location")).toBe("https://www.kanibarber.com/reservar");
  });

  it("restaura el acceso público normal cuando KANI_PRIVATE_PREVIEW_ENABLED=false", async () => {
    setPreviewEnv("false");
    const homeRes = await handlePrivatePreviewGate(
      new Request("https://www.kanibarber.com/", { method: "GET" }),
    );
    expect(homeRes).toBeNull();

    const gateRes = await handlePrivatePreviewGate(
      new Request("https://www.kanibarber.com/acceso-privado?next=%2Freservar", {
        method: "GET",
      }),
    );
    expect(gateRes!.status).toBe(302);
    expect(gateRes!.headers.get("location")).toBe("/reservar");
  });
});
