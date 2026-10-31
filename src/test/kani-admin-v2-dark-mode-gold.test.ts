import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Admin V2 — Dark Mode Visual Palette (Gold Active Elements & Primary CTAs)', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const stylesCss = fs.readFileSync(stylesPath, 'utf-8');

  const v2CssPath = path.resolve(__dirname, '../components/kani/v2/v2.css');
  const v2Css = fs.readFileSync(v2CssPath, 'utf-8');

  describe('1. Navegación superior / tabs activos del panel en modo oscuro', () => {
    it('en modo oscuro, el link activo de navegación usa dorado de Kani y texto oscuro', () => {
      // styles.css define gold para data-theme="dark" en admin-section-nav-link.is-active
      expect(stylesCss).toMatch(
        /html\[data-theme=['"]dark['"]\]\s+\.admin-section-nav-link\.is-active[^}]*background:\s*var\(--gold\)\s*!important/
      );
      expect(stylesCss).toMatch(
        /html\[data-theme=['"]dark['"]\]\s+\.admin-section-nav-link\.is-active[^}]*color:\s*#121212\s*!important/
      );
      expect(stylesCss).toMatch(
        /html\[data-theme=['"]dark['"]\]\s+\.admin-section-nav-link\.is-active\s+svg\s*\{[^}]*color:\s*#121212\s*!important/
      );
    });

    it('en v2.css se refuerza el tab activo en modo oscuro con dorado y contraste correcto', () => {
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+\.v2-nav\s+\.admin-section-nav-link\.is-active[^}]*background:\s*var\(--gold\)\s*!important/
      );
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+\.v2-nav\s+\.admin-section-nav-link\.is-active[^}]*color:\s*#121212\s*!important/
      );
    });

    it('los ítems inactivos se mantienen sobrios y oscuros', () => {
      expect(stylesCss).toMatch(/\.admin-section-nav-link\s*\{[^}]*color:\s*var\(--muted-foreground\)/);
      expect(stylesCss).toMatch(/\.admin-section-nav-link:hover\s*\{[^}]*color:\s*var\(--foreground\)/);
    });
  });

  describe('2. CTAs principales y acciones en modo oscuro', () => {
    it('los botones primarios y CTAs destacados usan fondo dorado de Kani en modo oscuro', () => {
      // .v2-primary, .v2-toolbar-action, .v2-add-manual-btn, .v2-client-add-btn, .v2-payment-submit-btn, .v2-cobrar-btn
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+:is\(\.v2-shell,\s*\.v2-dialog\)\s+\.v2-primary:not\(:disabled\)[^}]*background:\s*var\(--gold\)\s*!important/
      );
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+:is\(\.v2-shell,\s*\.v2-dialog\)\s+\.v2-primary:not\(:disabled\)[^}]*color:\s*#121212\s*!important/
      );
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+\.v2-shell\s+\.v2-cobrar-btn:not\(:disabled\)[^}]*background:\s*var\(--gold\)\s*!important/
      );
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+\.v2-shell\s+\.v2-cobrar-btn:not\(:disabled\)[^}]*color:\s*#121212\s*!important/
      );
    });

    it('los estados hover y active de CTAs ofrecen feedback sutil en modo oscuro', () => {
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+:is\(\.v2-shell,\s*\.v2-dialog\)\s+\.v2-primary:hover:not\(:disabled\)[^}]*background:\s*#cbb075\s*!important/
      );
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+:is\(\.v2-shell,\s*\.v2-dialog\)\s+\.v2-primary:active:not\(:disabled\)[^}]*background:\s*#a88849\s*!important/
      );
    });

    it('los botones deshabilitados NUNCA son dorados', () => {
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+:is\(\.v2-shell,\s*\.v2-dialog\)\s+\.v2-primary:disabled[^}]*background:\s*var\(--button-primary-disabled-bg,\s*#222222\)\s*!important/
      );
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+:is\(\.v2-shell,\s*\.v2-dialog\)\s+\.v2-primary:disabled[^}]*cursor:\s*not-allowed\s*!important/
      );
    });
  });

  describe('3. Controles segmentados y toggles activos en modo oscuro', () => {
    it('el control segmentado activo (Sin turno / Con turno) se muestra en dorado', () => {
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+\.v2-segmented\s+button\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--gold\)\s*!important/
      );
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+\.v2-segmented\s+button\[aria-pressed="true"\]\s*\{[^}]*color:\s*#121212\s*!important/
      );
    });

    it('los toggles activos de pagos (Agregar descuento / Asociar cliente) se muestran en dorado', () => {
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+\.v2-payment-toggle-btn\.active[^}]*background:\s*var\(--gold\)\s*!important/
      );
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+\.v2-payment-toggle-btn\.active[^}]*color:\s*#121212\s*!important/
      );
      expect(v2Css).toMatch(
        /html\[data-theme="dark"\]\s+\.v2-payment-action-btn\.active[^}]*background:\s*var\(--gold\)\s*!important/
      );
    });
  });

  describe('4. Modo claro permanece 100% intacto', () => {
    it('en modo claro la navegación activa conserva el bordó (#702B3A)', () => {
      expect(stylesCss).toMatch(
        /html\[data-theme="light"\]\s+\.admin-section-nav-link\.is-active[^}]*background:\s*#702B3A/
      );
      expect(stylesCss).toMatch(
        /html\[data-theme="light"\]\s+\.admin-section-nav-link\.is-active[^}]*color:\s*#FFFFFF/
      );
    });

    it('la definición base de botones primarios en modo claro conserva --button-primary-bg (#762936)', () => {
      expect(stylesCss).toMatch(/--button-primary-bg:\s*#762936/);
    });
  });
});
