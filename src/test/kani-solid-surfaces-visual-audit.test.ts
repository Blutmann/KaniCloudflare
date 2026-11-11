import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("KANI — Global Audit of Solid Surfaces, Opacity and Visual Accessibility (b733a0b2)", () => {
  const root = process.cwd();
  const v2Css = fs.readFileSync(path.resolve(root, "src/components/kani/v2/v2.css"), "utf8");
  const stylesCss = fs.readFileSync(path.resolve(root, "src/styles.css"), "utf8");
  const reservaV3Css = fs.readFileSync(path.resolve(root, "src/components/kani/experimental/reserva-v3.css"), "utf8");
  const clientCardsMobileCss = fs.readFileSync(path.resolve(root, "src/components/kani/v2/client-cards-mobile.css"), "utf8");
  const clientDialogCss = fs.readFileSync(path.resolve(root, "src/components/kani/v2/client-dialog.css"), "utf8");

  describe("1. Clientes — Superficies sólidas, contraste y jerarquía", () => {
    it("toolbar de clientes en desktop define superficie sólida (#1C1C1C oscuro / #FFFFFF claro), borde y sombra", () => {
      expect(v2Css).toMatch(/\.v2-client-toolbar-container\s*\{[^}]*background:\s*#1C1C1C;/);
      expect(v2Css).toMatch(/html\[data-theme="light"\]\s+\.v2-client-toolbar-container\s*\{[^}]*background:\s*#FFFFFF;/);
      expect(v2Css).toMatch(/\.v2-client-toolbar-container\s*\{[^}]*border:\s*1px solid var\(--border\);/);
      expect(v2Css).toMatch(/\.v2-client-toolbar-container\s*\{[^}]*box-shadow:\s*var\(--v2-shadow\);/);
    });

    it("buscador y selector de orden en clientes tienen fondo sólido #fff y texto contrastado #111", () => {
      expect(v2Css).toMatch(/\.v2-client-toolbar-container\s+:is\([\s\S]*?background:\s*#fff\s*!important;[\s\S]*?color:\s*#111\s*!important;/);
    });

    it("cards de clientes tienen fondo sólido (#fff en claro, #1c1c1c en oscuro)", () => {
      expect(v2Css).toMatch(/html\[data-theme="light"\]\s+\.v2-client-card\s*\{[^}]*background-color:\s*#fff\s*!important;/);
      expect(v2Css).toMatch(/html\[data-theme="dark"\]\s+\.v2-client-card\s*\{[^}]*background-color:\s*#1c1c1c\s*!important;/);
    });

    it("tarjetas móviles de clientes tienen layout de 3 filas compactas con botones de 36px", () => {
      expect(clientCardsMobileCss).toMatch(/--v2-client-btn-size:\s*36px;/);
      expect(clientCardsMobileCss).toMatch(/grid-template-rows:\s*auto\s+auto\s+auto;/);
      expect(clientCardsMobileCss).toMatch(/\.v2-client-mobile-name\s+h2\s*\{[^}]*font-size:\s*13px;[^}]*font-weight:\s*700;/);
    });

    it("modales de clientes tienen fondo sólido (#fff claro, #1c1c1c oscuro) y contención de viewport", () => {
      expect(clientDialogCss).toMatch(/html\[data-theme="light"\]\s+\.v2-dialog\.v2-client-modal\s*\{[^}]*background:\s*#fff;/);
      expect(clientDialogCss).toMatch(/html\[data-theme="dark"\]\s+\.v2-dialog\.v2-client-modal\s*\{[^}]*background:\s*#1c1c1c;/);
      expect(clientDialogCss).toMatch(/z-index:\s*200\s*!important;/);
    });
  });

  describe("2. Reserva de Turnos (/reservar-turno) — Superficies sólidas y accesibilidad", () => {
    it("inputs de contacto en reservas tienen fondo blanco sólido en modo claro", () => {
      expect(reservaV3Css).toMatch(/html\[data-theme='light'\]\s+\.booking-page:is\(\.booking-v2,\s*\.booking-v3\)\s+\.booking-contact-form\s+:is\([\s\S]*?background-color:\s*#fff\s*!important;/);
    });

    it("inputs de contacto en reservas tienen controles sólidos opacos (#f9f9f9) y texto oscuro (#1c1c1c) en modo oscuro", () => {
      expect(reservaV3Css).toMatch(/html\[data-theme='dark'\]\s+\.booking-page:is\(\.booking-v2,\s*\.booking-v3\)\s+\.booking-contact-form\s+:is\([\s\S]*?background:\s*#f9f9f9\s*!important;[\s\S]*?color:\s*#1c1c1c\s*!important;/);
    });

    it("reserva de celular elimina el artefacto de fondo sólido exterior manteniendo inputs centrados", () => {
      expect(reservaV3Css).toMatch(/\.booking-v3\s+\.phone-input-row\s*\{[\s\S]*?background:\s*transparent\s*!important;/);
      expect(stylesCss).toMatch(/\.booking-page\s+\.phone-input-row[\s\S]*?background:\s*transparent\s*!important;/);
    });

    it("cards de servicios y barberos tienen gap compacto de 3px y alineación vertical centrada", () => {
      expect(stylesCss).toMatch(/\.service-option\s+\.booking-option-copy\s*\{[^}]*row-gap:\s*3px;[^}]*column-gap:\s*16px;/);
      expect(stylesCss).toMatch(/\.service-option\s+\.booking-option-name\s*\{[^}]*line-height:\s*1\.2;/);
      expect(stylesCss).toMatch(/\.booking-page\s+\.booking-barber-options\s+\.booking-option-copy[\s\S]*?gap:\s*3px\s*!important;/);
    });
  });

  describe("3. Pagos y Cobros (/panel-administracion/pagos)", () => {
    it("los campos de registro y filtros de pagos en modo oscuro tienen fondo sólido #f9f9f9 y texto oscuro", () => {
      expect(v2Css).toMatch(/html\[data-theme="dark"\]\s+\.v2-payment-entry-field\s+:is\(input,\s*select\),[\s\S]*?background-color:\s*#f9f9f9f9\s*!important;[\s\S]*?color:\s*#1c1c1c;/);
      expect(v2Css).toMatch(/html\[data-theme="dark"\]\s+\.v2-payments-history-panel\s*>\s*\.v2-filters\s*>\s*\.v2-field\s*>\s*select\s*\{[\s\S]*?background-color:\s*#f9f9f9\s*!important;/);
    });
  });

  describe("4. Horarios (/panel-administracion/horarios)", () => {
    it("campos de horario manual tienen 44px de altura, fondo solido del tema y borde definido", () => {
      expect(stylesCss).toMatch(/\.admin-schedule-manual-fields\s+select\.select-control,[\s\S]*?height:\s*44px\s*!important;[\s\S]*?border:\s*1px solid var\(--border\)\s*!important;/);
    });
  });

  describe("5. Navegación administrativa y Header", () => {
    it("navbar administrativo en mobile utiliza 32px para Actualizar con pseudo-touch 44px garantizando una sola fila", () => {
      expect(v2Css).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.v2-nav\.admin-section-nav\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+1px\s+32px;/);
      expect(v2Css).toMatch(/\.v2-nav\s+\.admin-section-nav-refresh-btn::before\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/);
    });

    it("botones de control del header en modo claro tienen fondo blanco sólido", () => {
      expect(stylesCss).toMatch(/html\[data-theme='light'\]\s+\.site-header\s+\.header-controls\s+\.header-control-button[\s\S]*?background:\s*#fff\s*!important;/);
    });
  });
});
