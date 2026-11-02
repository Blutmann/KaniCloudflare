import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani — Panel Administrativo & Menú Visual Adjustments', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const stylesCss = fs.readFileSync(stylesPath, 'utf-8');

  const adminAccessPath = path.resolve(__dirname, '../components/kani/admin-access.tsx');
  const adminAccessCode = fs.readFileSync(adminAccessPath, 'utf-8');

  describe('1. Inicio de sesión — solo móvil', () => {
    it('oculta el footer en móvil bajo la pantalla de login sin dejar espacio residual', () => {
      // Verifica selector scoped a admin-login-page / data-admin-login
      expect(stylesCss).toContain(":is(.site-shell:has(.admin-login-page), body[data-admin-login='true'] .site-shell)");
      expect(stylesCss).toContain('display: none !important');
      expect(stylesCss).toContain('padding-bottom: 0 !important');
      expect(stylesCss).toContain('margin-bottom: 0 !important');
    });

    it('AdminAccess vincula data-admin-login al montar y lo limpia al desmontar', () => {
      expect(adminAccessCode).toContain("document.body.dataset.adminLogin = 'true'");
      expect(adminAccessCode).toContain('delete document.body.dataset.adminLogin');
    });

    it('no oculta el footer en escritorio', () => {
      // El display: none para el footer de login está acotado a @media (max-width: 767px)
      const mobileSection = stylesCss.substring(
        stylesCss.indexOf('@media (max-width: 767px)'),
        stylesCss.indexOf('/* Densidad visual acotada a los horarios')
      );
      expect(mobileSection).toContain("body[data-admin-login='true'] .site-footer");
      expect(mobileSection).toContain('display: none !important');
    });
  });

  describe('2. Botón "Iniciar sesión" — modo oscuro', () => {
    it('aplica fondo dorado y texto/ícono negros en modo oscuro para móvil y escritorio', () => {
      expect(stylesCss).toMatch(
        /html\[data-theme=['"]dark['"]\]\s+\.admin-login-submit:not\(:disabled\)\s*\{[^}]*background:\s*var\(--gold\)\s*!important/
      );
      expect(stylesCss).toMatch(
        /html\[data-theme=['"]dark['"]\]\s+\.admin-login-submit:not\(:disabled\)\s*\{[^}]*color:\s*#000000\s*!important/
      );
      expect(stylesCss).toMatch(
        /html\[data-theme=['"]dark['"]\]\s+\.admin-login-submit:not\(:disabled\)\s+svg\s*\{[^}]*color:\s*#000000\s*!important/
      );
      expect(stylesCss).toMatch(
        /html\[data-theme=['"]dark['"]\]\s+\.admin-login-submit:not\(:disabled\)\s+svg\s*\{[^}]*stroke:\s*#000000\s*!important/
      );
    });

    it('define estados diferenciados de hover, foco, active, carga y deshabilitado', () => {
      // Hover
      expect(stylesCss).toMatch(/html\[data-theme=['"]dark['"]\]\s+\.admin-login-submit:hover:not\(:disabled\)/);
      // Active
      expect(stylesCss).toMatch(/html\[data-theme=['"]dark['"]\]\s+\.admin-login-submit:active:not\(:disabled\)/);
      // Focus-visible
      expect(stylesCss).toMatch(/html\[data-theme=['"]dark['"]\]\s+\.admin-login-submit:focus-visible/);
      // Carga / busy
      expect(stylesCss).toMatch(/html\[data-theme=['"]dark['"]\]\s+\.admin-login-submit\[aria-busy=['"]true['"]\]/);
      // Disabled (no carga)
      expect(stylesCss).toMatch(/html\[data-theme=['"]dark['"]\]\s+\.admin-login-submit:disabled:not\(\[aria-busy=['"]true['"]\]\)/);
    });

    it('el componente AdminAccess propaga atributos de accesibilidad de carga aria-busy y data-busy', () => {
      expect(adminAccessCode).toContain('aria-busy={busy}');
      expect(adminAccessCode).toContain('data-busy={busy}');
    });
  });

  describe('3. Menú desplegable — modo oscuro: Volver a la reserva vs Cerrar sesión', () => {
    it('botón "Volver a la reserva" usa fondo dorado y texto/ícono negros en modo oscuro', () => {
      expect(stylesCss).toMatch(
        /html\[data-theme=['"]dark['"]\]\s+\.booking-menu-return:not\(:disabled\)\s*\{[^}]*background:\s*var\(--gold\)\s*!important/
      );
      expect(stylesCss).toMatch(
        /html\[data-theme=['"]dark['"]\]\s+\.booking-menu-return:not\(:disabled\)\s*\{[^}]*color:\s*#000000\s*!important/
      );
      expect(stylesCss).toMatch(
        /html\[data-theme=['"]dark['"]\]\s+\.booking-menu-return:not\(:disabled\)\s+svg\s*\{[^}]*color:\s*#000000\s*!important/
      );
      expect(stylesCss).toMatch(
        /html\[data-theme=['"]dark['"]\]\s+\.booking-menu-return:not\(:disabled\)\s+svg\s*\{[^}]*stroke:\s*#000000\s*!important/
      );
    });

    it('botón "Volver a la reserva" tiene estados hover, active y focus-visible', () => {
      expect(stylesCss).toMatch(/html\[data-theme=['"]dark['"]\]\s+\.booking-menu-return:hover:not\(:disabled\)/);
      expect(stylesCss).toMatch(/html\[data-theme=['"]dark['"]\]\s+\.booking-menu-return:active:not\(:disabled\)/);
      expect(stylesCss).toMatch(/html\[data-theme=['"]dark['"]\]\s+\.booking-menu-return:focus-visible/);
    });

    it('botón "Cerrar sesión" conserva estrictamente su color bordó institucional (#762936) con texto blanco', () => {
      expect(stylesCss).toMatch(/\.mobile-menu-signout\s*\{[^}]*background-color:\s*var\(--button-primary-bg,\s*#762936\)/);
      expect(stylesCss).toMatch(/\.mobile-menu-signout\s*\{[^}]*color:\s*#FFFFFF\s*!important/);
      expect(stylesCss).toMatch(/\.mobile-menu-signout svg\s*\{[^}]*color:\s*#FFFFFF\s*!important/);
    });

    it('modo claro no se ve afectado para ninguno de los botones', () => {
      expect(stylesCss).toContain("html[data-theme='light'] .booking-menu-return");
      expect(stylesCss).toContain("--button-primary-bg: #762936");
    });
  });
});
