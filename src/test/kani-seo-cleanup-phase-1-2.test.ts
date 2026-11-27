import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildKaniLocalBusinessJsonLd,
  KANI_DEFAULT_OG_IMAGE,
  KANI_SITE_ORIGIN,
  pageHead,
} from "../lib/kani-head";
import {
  getLegacyRouteRedirectUrl,
  shouldApplyNoIndexHeader,
  withSeoRobotsHeader,
} from "../lib/kani-seo-routing.server";
import server from "../server";

const rootDir = path.resolve(__dirname, "../..");

describe("SEO Técnico & Consolidación de Redirects (Fase 1 + Fase 2)", () => {
  describe("1. Canonical único, metadata social y JSON-LD", () => {
    it("__root.tsx ya no inyecta un <link rel='canonical'> global", () => {
      const rootCode = fs.readFileSync(path.join(rootDir, "src/routes/__root.tsx"), "utf-8");
      expect(rootCode).not.toContain('rel: "canonical"');
      expect(rootCode).not.toContain("rel: 'canonical'");
    });

    it("pageHead genera canonical único, og:url, og:locale, og:image, twitter y JSON-LD", () => {
      const head = pageHead("Reservá tu turno", "Descripción", "Kani Barber Studio - Reservar turno", {
        canonicalPath: "/reservar",
        jsonLd: buildKaniLocalBusinessJsonLd(`${KANI_SITE_ORIGIN}/reservar`),
      });

      expect(head.links).toEqual([{ rel: "canonical", href: "https://www.kanibarber.com/reservar" }]);
      expect(head.meta).toContainEqual({ property: "og:url", content: "https://www.kanibarber.com/reservar" });
      expect(head.meta).toContainEqual({ property: "og:site_name", content: "Kani Barber Studio" });
      expect(head.meta).toContainEqual({ property: "og:locale", content: "es_AR" });
      expect(head.meta).toContainEqual({ property: "og:image", content: KANI_DEFAULT_OG_IMAGE });
      expect(head.meta).toContainEqual({ name: "twitter:image", content: KANI_DEFAULT_OG_IMAGE });
      expect(head.meta.some((m) => m.name === "robots")).toBe(false);

      expect(head.scripts).toHaveLength(1);
      expect(head.scripts?.[0]?.type).toBe("application/ld+json");
      const parsedLd = JSON.parse(head.scripts?.[0]?.children ?? "{}");
      expect(parsedLd["@type"]).toBe("BarberShop");
      expect(parsedLd.address.streetAddress).toBe("San Isidro Labrador 7");
    });

    it("pageHead soporta noindex: true sin emitir canonical si no se indica", () => {
      const head = pageHead("Pago", "Detalle", "Pago", { noindex: true });
      expect(head.meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
      expect(head.links).toBeUndefined();
    });

    it("rutas públicas canónicas declaran su canonical propio y /reservar + /contacto incluyen JSON-LD", () => {
      const reservarCode = fs.readFileSync(path.join(rootDir, "src/routes/reservar.tsx"), "utf-8");
      const contactoCode = fs.readFileSync(path.join(rootDir, "src/routes/contacto.tsx"), "utf-8");
      const privacidadCode = fs.readFileSync(path.join(rootDir, "src/routes/politica-de-privacidad.tsx"), "utf-8");
      const terminosCode = fs.readFileSync(path.join(rootDir, "src/routes/terminos-y-condiciones.tsx"), "utf-8");

      expect(reservarCode).toContain("canonicalPath: '/reservar'");
      expect(reservarCode).toContain("buildKaniLocalBusinessJsonLd");

      expect(contactoCode).toContain('canonicalPath: "https://www.kanibarber.com/contacto"');
      expect(contactoCode).toContain("buildKaniLocalBusinessJsonLd");
      expect(contactoCode).not.toContain("links: [");

      expect(privacidadCode).toContain("canonicalPath: '/politica-de-privacidad'");
      expect(terminosCode).toContain("canonicalPath: '/terminos-y-condiciones'");
    });

    it("rutas transaccionales y legacy requeridas declaran noindex, nofollow", () => {
      const noindexRoutes = [
        "src/routes/pago.exito.tsx",
        "src/routes/pago.error.tsx",
        "src/routes/pago.pendiente.tsx",
        "src/routes/case-study.tsx",
        "src/routes/cancelar-turno-old.tsx",
      ];
      for (const relPath of noindexRoutes) {
        const code = fs.readFileSync(path.join(rootDir, relPath), "utf-8");
        expect(code, `${relPath} debe declarar noindex: true`).toContain("noindex: true");
      }

      const adminCode = fs.readFileSync(path.join(rootDir, "src/routes/admin.tsx"), "utf-8");
      expect(adminCode).toContain("noindex, nofollow");

      const cancelarCode = fs.readFileSync(path.join(rootDir, "src/routes/cancelar-turno.tsx"), "utf-8");
      expect(cancelarCode).toContain("canonicalPath: '/cancelar-turno'");
      expect(cancelarCode).toContain("noindex: hasTokenParams");
    });
  });

  describe("2. robots.txt, sitemap.xml y eliminación de manus-routes.json", () => {
    it("public/manus-routes.json fue eliminado", () => {
      expect(fs.existsSync(path.join(rootDir, "public/manus-routes.json"))).toBe(false);
    });

    it("public/sitemap.xml incluye solo las 4 URLs públicas canónicas y excluye /case-study y privadas", () => {
      const sitemap = fs.readFileSync(path.join(rootDir, "public/sitemap.xml"), "utf-8");
      expect(sitemap).toContain("<loc>https://www.kanibarber.com/reservar</loc>");
      expect(sitemap).toContain("<loc>https://www.kanibarber.com/contacto</loc>");
      expect(sitemap).toContain("<loc>https://www.kanibarber.com/politica-de-privacidad</loc>");
      expect(sitemap).toContain("<loc>https://www.kanibarber.com/terminos-y-condiciones</loc>");
      expect(sitemap).not.toContain("/case-study");
      expect(sitemap).not.toContain("/panel-");
      expect(sitemap).not.toContain("/admin");
      expect(sitemap).not.toContain("/pago/");
    });

    it("public/robots.txt bloquea rutas privadas/API y enlaza al sitemap oficial", () => {
      const robots = fs.readFileSync(path.join(rootDir, "public/robots.txt"), "utf-8");
      expect(robots).toContain("Disallow: /panel-administracion");
      expect(robots).toContain("Disallow: /admin");
      expect(robots).toContain("Disallow: /pago/");
      expect(robots).toContain("Disallow: /membresia/");
      expect(robots).toContain("Disallow: /verificar-membresia/");
      expect(robots).toContain("Disallow: /activar-cuenta");
      expect(robots).toContain("Disallow: /restablecer-contrasena");
      expect(robots).toContain("Disallow: /api/");
      expect(robots).toContain("Sitemap: https://www.kanibarber.com/sitemap.xml");
    });
  });

  describe("3. X-Robots-Tag en *.workers.dev y rutas privadas", () => {
    it("aplica X-Robots-Tag: noindex, nofollow, noarchive en cualquier host *.workers.dev", () => {
      expect(shouldApplyNoIndexHeader("https://kanibarberstudio-cloudflare.kanibarber.workers.dev/reservar")).toBe(true);
      expect(shouldApplyNoIndexHeader("https://abc123-kanibarberstudio-cloudflare.kanibarber.workers.dev/contacto")).toBe(true);

      const req = new Request("https://kanibarberstudio-cloudflare.kanibarber.workers.dev/reservar");
      const res = withSeoRobotsHeader(req, new Response("ok", { status: 200 }));
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive");
    });

    it("aplica X-Robots-Tag en rutas privadas/transaccionales de www.kanibarber.com y NO en públicas", () => {
      const privateUrls = [
        "https://www.kanibarber.com/panel-administracion",
        "https://www.kanibarber.com/panel-administracion/turnos",
        "https://www.kanibarber.com/panel-descuentos",
        "https://www.kanibarber.com/admin/datos",
        "https://www.kanibarber.com/pago/exito?appointment_id=123",
        "https://www.kanibarber.com/membresia/token123",
        "https://www.kanibarber.com/verificar-membresia/token123",
        "https://www.kanibarber.com/activar-cuenta",
        "https://www.kanibarber.com/restablecer-contrasena",
        "https://www.kanibarber.com/case-study",
        "https://www.kanibarber.com/cancelar-turno?id=1&token=abc",
      ];
      for (const u of privateUrls) {
        expect(shouldApplyNoIndexHeader(u), `${u} debe llevar X-Robots-Tag`).toBe(true);
      }

      const publicUrls = [
        "https://www.kanibarber.com/reservar",
        "https://www.kanibarber.com/contacto",
        "https://www.kanibarber.com/politica-de-privacidad",
        "https://www.kanibarber.com/terminos-y-condiciones",
        "https://www.kanibarber.com/cancelar-turno",
      ];
      for (const u of publicUrls) {
        expect(shouldApplyNoIndexHeader(u), `${u} NO debe llevar X-Robots-Tag`).toBe(false);
      }
    });
  });

  describe("4. Fase 2 — Redirects HTTP 301 server-side sin cadenas y preservando query params", () => {
    const cases: Array<[string, string]> = [
      ["https://www.kanibarber.com/?utm_source=ig", "https://www.kanibarber.com/reservar?utm_source=ig"],
      ["https://www.kanibarber.com/reservar-turno?barber=Gonzalo", "https://www.kanibarber.com/reservar?barber=Gonzalo"],
      ["https://www.kanibarber.com/reservar-turno-liquid", "https://www.kanibarber.com/reservar"],
      ["https://www.kanibarber.com/reserva-v4", "https://www.kanibarber.com/reservar"],
      ["https://www.kanibarber.com/reservar-mercadopago", "https://www.kanibarber.com/reservar"],
      ["https://www.kanibarber.com/reservar-turno-mercadopago", "https://www.kanibarber.com/reservar"],
      ["https://www.kanibarber.com/contacto-liquid", "https://www.kanibarber.com/contacto"],
      ["https://www.kanibarber.com/estudio/", "https://www.kanibarber.com/contacto"],
      ["https://www.kanibarber.com/cancelar?id=1&token=abc", "https://www.kanibarber.com/cancelar-turno?id=1&token=abc"],
      ["https://www.kanibarber.com/cancelar-turno-old?id=1&token=abc", "https://www.kanibarber.com/cancelar-turno?id=1&token=abc"],
      ["https://www.kanibarber.com/politica-de-privacidad-liquid", "https://www.kanibarber.com/politica-de-privacidad"],
      ["https://www.kanibarber.com/terminos-y-condiciones-liquid", "https://www.kanibarber.com/terminos-y-condiciones"],
      ["https://www.kanibarber.com/admin", "https://www.kanibarber.com/panel-administracion"],
      ["https://www.kanibarber.com/admin/", "https://www.kanibarber.com/panel-administracion"],
      ["https://www.kanibarber.com/admin/mantenimiento", "https://www.kanibarber.com/panel-administracion/mantenimiento"],
      ["https://www.kanibarber.com/admin/estadisticas", "https://www.kanibarber.com/panel-administracion/datos"],
      ["https://www.kanibarber.com/admin-liquid", "https://www.kanibarber.com/panel-administracion"],
      ["https://www.kanibarber.com/admin-liquid/turnos?date=2026-12-01", "https://www.kanibarber.com/panel-administracion/turnos?date=2026-12-01"],
      ["https://www.kanibarber.com/admin-v2", "https://www.kanibarber.com/panel-administracion/inicio"],
      ["https://www.kanibarber.com/admin-v2/pagos?period=TODAY", "https://www.kanibarber.com/panel-administracion/pagos?period=TODAY"],
    ];

    it.each(cases)("redirige %s → %s", (input, expected) => {
      expect(getLegacyRouteRedirectUrl(input)).toBe(expected);
      // Verificar que no existan cadenas de redirect
      expect(getLegacyRouteRedirectUrl(expected)).toBeNull();
    });

    it("no redirige rutas canónicas ni /case-study", () => {
      expect(getLegacyRouteRedirectUrl("https://www.kanibarber.com/reservar")).toBeNull();
      expect(getLegacyRouteRedirectUrl("https://www.kanibarber.com/contacto")).toBeNull();
      expect(getLegacyRouteRedirectUrl("https://www.kanibarber.com/panel-administracion/turnos")).toBeNull();
      expect(getLegacyRouteRedirectUrl("https://www.kanibarber.com/case-study")).toBeNull();
    });

    it("server.fetch devuelve HTTP 301 real para / y rutas legacy preservando query params", async () => {
      const resRoot = await server.fetch(
        new Request("https://www.kanibarber.com/?ref=google", { method: "GET" }),
        { KANI_CANONICAL_HOST: "www.kanibarber.com", KANI_PRIVATE_PREVIEW_ENABLED: "false" },
        {},
      );
      expect(resRoot.status).toBe(301);
      expect(resRoot.headers.get("location")).toBe("https://www.kanibarber.com/reservar?ref=google");

      const resMp = await server.fetch(
        new Request("https://www.kanibarber.com/reservar-mercadopago?barber=Gonzalo", { method: "GET" }),
        { KANI_CANONICAL_HOST: "www.kanibarber.com", KANI_PRIVATE_PREVIEW_ENABLED: "false" },
        {},
      );
      expect(resMp.status).toBe(301);
      expect(resMp.headers.get("location")).toBe("https://www.kanibarber.com/reservar?barber=Gonzalo");

      const resWorker = await server.fetch(
        new Request("https://kanibarberstudio-cloudflare.kanibarber.workers.dev/", { method: "GET" }),
        { KANI_CANONICAL_HOST: "www.kanibarber.com", KANI_PRIVATE_PREVIEW_ENABLED: "false" },
        {},
      );
      expect(resWorker.status).toBe(301);
      expect(resWorker.headers.get("location")).toBe(
        "https://kanibarberstudio-cloudflare.kanibarber.workers.dev/reservar",
      );
      expect(resWorker.headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive");
    });
  });
});
