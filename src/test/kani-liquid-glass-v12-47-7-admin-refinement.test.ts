import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("KANI BARBER STUDIO — V12.47.7 Refinamiento Liquid Glass (Navegación administrativa y Clientes)", () => {
  const root = process.cwd();
  const adminCss = fs.readFileSync(
    path.resolve(root, "src/components/kani/experimental/liquid-glass-admin.css"),
    "utf8"
  );
  const layoutTsx = fs.readFileSync(
    path.resolve(root, "src/components/kani/v2/layout.tsx"),
    "utf8"
  );
  const clientsTsx = fs.readFileSync(
    path.resolve(root, "src/components/kani/v2/clients.tsx"),
    "utf8"
  );

  describe("1. Navegación administrativa — Altura y proporciones en Desktop, Laptop y Tablet", () => {
    it("en desktop/tablet (min-width: 768px), la cápsula administrativa tiene altura homologada con el stepper de Reservar (clamp(54px, 5.8dvh, 62px))", () => {
      expect(adminCss).toMatch(
        /@media\s*\(min-width:\s*768px\)[\s\S]*?\.v2-navigation\s+\.v2-nav\.admin-section-nav[\s\S]*?height:\s*clamp\(54px,\s*5\.8dvh,\s*62px\)\s*!important;/
      );
      expect(adminCss).toMatch(
        /@media\s*\(min-width:\s*768px\)[\s\S]*?\.v2-navigation\s+\.v2-nav\.admin-section-nav[\s\S]*?min-height:\s*clamp\(54px,\s*5\.8dvh,\s*62px\)\s*!important;/
      );
      expect(adminCss).toMatch(
        /@media\s*\(min-width:\s*768px\)[\s\S]*?\.v2-navigation\s+\.v2-nav\.admin-section-nav[\s\S]*?border-radius:\s*9999px\s*!important;/
      );
    });

    it("en desktop/tablet, los enlaces de navegación (.admin-section-nav-link) ocupan el 100% de altura con min-height responsive y border-radius 9999px", () => {
      expect(adminCss).toMatch(
        /@media\s*\(min-width:\s*768px\)[\s\S]*?\.v2-navigation\s+\.admin-section-nav-link[\s\S]*?min-height:\s*clamp\(46px,\s*4\.8dvh,\s*52px\)\s*!important;/
      );
      expect(adminCss).toMatch(
        /@media\s*\(min-width:\s*768px\)[\s\S]*?\.v2-navigation\s+\.admin-section-nav-link[\s\S]*?border-radius:\s*9999px\s*!important;/
      );
    });

    it("el pill activo (.lg-admin-nav-pill) en desktop tiene border-radius 9999px", () => {
      expect(adminCss).toMatch(
        /@media\s*\(min-width:\s*768px\)[\s\S]*?\.v2-navigation\s+\.lg-admin-nav-pill[\s\S]*?border-radius:\s*9999px\s*!important;/
      );
    });
  });

  describe("2. Navegación administrativa — Conservación estricta de dimensiones en Mobile", () => {
    it("en mobile (max-width: 767px), la barra conserva la altura fija de 48px y 6 columnas para administración general", () => {
      expect(adminCss).toMatch(
        /@media\s*\(max-width:\s*767px\)[\s\S]*?\.v2-navigation\s+\.admin-section-nav-link[\s\S]*?height:\s*48px\s*!important;/
      );
      expect(adminCss).toMatch(
        /@media\s*\(max-width:\s*767px\)[\s\S]*?\.v2-navigation\s+\.admin-section-nav-items[\s\S]*?grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)\s*!important;/
      );
    });

    it("en mobile (max-width: 767px), la barra de membresías/descuentos conserva la altura fija de 48px y 3 columnas", () => {
      expect(adminCss).toMatch(
        /\.v2-navigation\s+\.v2-nav\.admin-section-nav\.lg-memberships-nav\s+\.admin-section-nav-items[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)\s*!important;/
      );
      expect(adminCss).toMatch(
        /\.v2-navigation\s+\.v2-nav\.admin-section-nav\.lg-memberships-nav\s+\.admin-section-nav-link[\s\S]*?height:\s*48px\s*!important;/
      );
    });
  });

  describe("3. Navegación administrativa — Auténtico Optical Glass", () => {
    it("define blur de 20px, saturación 145% y contraste 1.02 con prefijo -webkit para compatibilidad completa", () => {
      expect(adminCss).toMatch(
        /backdrop-filter:\s*blur\(20px\)\s+saturate\(145%\)\s+contrast\(1\.02\)\s*!important;/
      );
      expect(adminCss).toMatch(
        /-webkit-backdrop-filter:\s*blur\(20px\)\s+saturate\(145%\)\s+contrast\(1\.02\)\s*!important;/
      );
    });

    it("la superficie en Light Mode es translúcida con bisel especular y borde fino", () => {
      expect(adminCss).toMatch(
        /html\[data-theme="light"\]\s+body\[data-lg-admin="true"\]\s+\.v2-navigation\s+\.v2-nav\.admin-section-nav[\s\S]*?background:\s*linear-gradient\([\s\S]*?rgba\(255,\s*255,\s*255,\s*0\.58\)[\s\S]*?rgba\(246,\s*244,\s*240,\s*0\.36\)[\s\S]*?rgba\(255,\s*255,\s*255,\s*0\.50\)[\s\S]*?\)\s*!important;/
      );
      expect(adminCss).toMatch(
        /html\[data-theme="light"\]\s+body\[data-lg-admin="true"\]\s+\.v2-navigation\s+\.v2-nav\.admin-section-nav[\s\S]*?border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.88\)\s*!important;/
      );
    });

    it("la superficie en Dark Mode es translúcida con tono obsidiana y bisel sutil", () => {
      expect(adminCss).toMatch(
        /html\[data-theme="dark"\]\s+body\[data-lg-admin="true"\]\s+\.v2-navigation\s+\.v2-nav\.admin-section-nav[\s\S]*?background:\s*linear-gradient\([\s\S]*?rgba\(32,\s*33,\s*40,\s*0\.58\)[\s\S]*?rgba\(20,\s*20,\s*26,\s*0\.46\)[\s\S]*?rgba\(26,\s*26,\s*34,\s*0\.54\)[\s\S]*?\)\s*!important;/
      );
      expect(adminCss).toMatch(
        /html\[data-theme="dark"\]\s+body\[data-lg-admin="true"\]\s+\.v2-navigation\s+\.v2-nav\.admin-section-nav[\s\S]*?border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.16\)\s*!important;/
      );
    });

    it("el pill activo (.lg-admin-nav-pill) es translúcido con borde champagne discreto sin bloques plásticos sólidos", () => {
      expect(adminCss).toMatch(
        /html\[data-theme="light"\]\s+body\[data-lg-admin="true"\]\s+\.v2-navigation\s+\.lg-admin-nav-pill[\s\S]*?border:\s*1px solid rgba\(196,\s*164,\s*102,\s*0\.55\)\s*!important;/
      );
      expect(adminCss).toMatch(
        /html\[data-theme="dark"\]\s+body\[data-lg-admin="true"\]\s+\.v2-navigation\s+\.lg-admin-nav-pill[\s\S]*?border:\s*1px solid rgba\(218,\s*186,\s*122,\s*0\.48\)\s*!important;/
      );
    });
  });

  describe("4. Clientes — Tarjetas Liquid Glass (.v2-client-card)", () => {
    it("las tarjetas de clientes reemplazan fondos sólidos por superficies translúcidas con blur real de 18px", () => {
      expect(adminCss).toMatch(
        /html\[data-theme="light"\]\s+body\[data-lg-admin="true"\]\s+\.v2-client-card[\s\S]*?backdrop-filter:\s*blur\(18px\)\s+saturate\(145%\)\s+contrast\(1\.02\)\s*!important;/
      );
      expect(adminCss).toMatch(
        /html\[data-theme="dark"\]\s+body\[data-lg-admin="true"\]\s+\.v2-client-card[\s\S]*?backdrop-filter:\s*blur\(18px\)\s+saturate\(145%\)\s+contrast\(1\.02\)\s*!important;/
      );
    });

    it("las tarjetas de clientes tienen fondos de cristal óptico en Light Mode y Dark Mode con bordes definidos", () => {
      expect(adminCss).toMatch(
        /html\[data-theme="light"\]\s+body\[data-lg-admin="true"\]\s+\.v2-client-card[\s\S]*?background:\s*linear-gradient\([\s\S]*?rgba\(255,\s*255,\s*255,\s*0\.64\)[\s\S]*?rgba\(248,\s*246,\s*242,\s*0\.42\)[\s\S]*?rgba\(255,\s*255,\s*255,\s*0\.54\)[\s\S]*?\)\s*!important;/
      );
      expect(adminCss).toMatch(
        /html\[data-theme="dark"\]\s+body\[data-lg-admin="true"\]\s+\.v2-client-card[\s\S]*?background:\s*linear-gradient\([\s\S]*?rgba\(34,\s*34,\s*42,\s*0\.52\)[\s\S]*?rgba\(20,\s*20,\s*26,\s*0\.42\)[\s\S]*?rgba\(28,\s*28,\s*36,\s*0\.48\)[\s\S]*?\)\s*!important;/
      );
    });

    it("el hover eleva sutilmente la tarjeta (-1.5px) con borde champagne y resplandor óptico", () => {
      expect(adminCss).toMatch(
        /html\[data-theme="light"\]\s+body\[data-lg-admin="true"\]\s+\.v2-client-card:hover[\s\S]*?transform:\s*translateY\(-1\.5px\)\s*!important;/
      );
      expect(adminCss).toMatch(
        /html\[data-theme="dark"\]\s+body\[data-lg-admin="true"\]\s+\.v2-client-card:hover[\s\S]*?transform:\s*translateY\(-1\.5px\)\s*!important;/
      );
    });

    it("la tarjeta móvil anidada (.client-card-mobile) dentro de .v2-client-card tiene fondo transparente sin efecto tarjeta dentro de tarjeta", () => {
      expect(adminCss).toMatch(
        /\.v2-client-card\s+\.client-card-mobile[\s\S]*?background:\s*transparent\s*!important;/
      );
      expect(adminCss).toMatch(
        /\.v2-client-card\s+\.client-card-mobile[\s\S]*?backdrop-filter:\s*none\s*!important;/
      );
    });

    it("el chip 'Ficha existente' (.v2-client-tag) tiene acento champagne y contraste legible", () => {
      expect(adminCss).toMatch(
        /html\[data-theme="light"\]\s+body\[data-lg-admin="true"\]\s+\.v2-client-tag[\s\S]*?color:\s*#7a581e\s*!important;/
      );
      expect(adminCss).toMatch(
        /html\[data-theme="dark"\]\s+body\[data-lg-admin="true"\]\s+\.v2-client-tag[\s\S]*?color:\s*#e4c98f\s*!important;/
      );
    });

    it("los componentes JSX de clientes preservan nombre, teléfono, email, visitas verificadas, chip y botones intactos", () => {
      expect(clientsTsx).toContain("v2-client-card");
      expect(clientsTsx).toContain("v2-client-name");
      expect(clientsTsx).toContain("v2-client-phone");
      expect(clientsTsx).toContain("v2-client-email");
      expect(clientsTsx).toContain("v2-client-visits");
      expect(clientsTsx).toContain("v2-client-tag");
      expect(clientsTsx).toContain("v2-client-action-btn edit");
      expect(clientsTsx).toContain("v2-client-action-btn delete");
      expect(clientsTsx).toContain("v2-client-details-btn");
      expect(clientsTsx).toContain("ClientCardMobile");
    });
  });

  describe("5. Alcance global de navegación y accesibilidad", () => {
    it("layout administrativo unifica todas las rutas bajo V2Layout con MotionConfig y soporte de data-lg-admin", () => {
      expect(layoutTsx).toContain('document.body.dataset.lgAdmin = "true"');
      expect(layoutTsx).toContain('<LiquidGlassShell section="admin">');
      expect(layoutTsx).toContain('className="v2-navigation"');
      expect(layoutTsx).toContain('admin-section-nav v2-nav');
      expect(layoutTsx).toContain('lg-memberships-nav');
    });

    it("define fallback visual para prefers-reduced-transparency", () => {
      expect(adminCss).toMatch(
        /@media\s*\(prefers-reduced-transparency:\s*reduce\)[\s\S]*?html\[data-theme="light"\][\s\S]*?backdrop-filter:\s*none\s*!important;/
      );
      expect(adminCss).toMatch(
        /@media\s*\(prefers-reduced-transparency:\s*reduce\)[\s\S]*?html\[data-theme="dark"\][\s\S]*?backdrop-filter:\s*none\s*!important;/
      );
    });
  });
});
