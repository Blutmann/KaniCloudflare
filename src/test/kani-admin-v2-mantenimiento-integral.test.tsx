import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { AdminMaintenance } from '@/components/kani/admin-maintenance';

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    profile: { role: 'ADMIN', barber_id: null, display_name: 'KANI Admin' },
    triggerRefresh: vi.fn(),
    isRefreshing: false,
  }),
}));

vi.mock('@/lib/kani-maintenance', () => ({
  cleanupAppointmentRecords: vi.fn(),
  cleanupAvailabilityNotifications: vi.fn(),
  cleanupStatusOptions: [
    { value: 'PENDING', label: 'Pendientes', description: 'Reservas pendientes de confirmación de pago.' },
    { value: 'CONFIRMED', label: 'Confirmados', description: 'Reservas confirmadas con seña abonada.' },
    { value: 'CANCELLED', label: 'Cancelados', description: 'Reservas canceladas o no concretadas.' },
  ],
  countAvailabilityNotifications: vi.fn().mockResolvedValue(12),
  reauthenticateAdmin: vi.fn(),
}));

describe('KANI BARBER STUDIO — Corrección Integral de la Interfaz de Mantenimiento en Admin V2', () => {
  const stylesCss = fs.readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf-8');
  const siteHeaderCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/kani/site-header.tsx'), 'utf-8');
  const maintenanceComponentCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/kani/admin-maintenance.tsx'), 'utf-8');

  afterEach(() => {
    cleanup();
  });

  describe('1. Unificación de Navegación y Rutas canónicas', () => {
    it('el menú principal de SiteHeader enlaza a /panel-administracion/mantenimiento para rol ADMIN', () => {
      expect(siteHeaderCode).toContain("const adminBase = '/panel-administracion';");
      expect(siteHeaderCode).toContain('to={`${adminBase}/mantenimiento`}');
      expect(siteHeaderCode).not.toContain('to="/admin/mantenimiento"');
    });

    it('la ruta heredada /admin/mantenimiento redirige 301 a /panel-administracion/mantenimiento', async () => {
      const { getLegacyRouteRedirectUrl } = await import('@/lib/kani-seo-routing.server');
      expect(getLegacyRouteRedirectUrl('https://www.kanibarber.com/admin/mantenimiento')).toBe(
        'https://www.kanibarber.com/panel-administracion/mantenimiento',
      );
    });

    it('la ruta /admin-v2/mantenimiento redirige 301 a /panel-administracion/mantenimiento', async () => {
      const { getLegacyRouteRedirectUrl } = await import('@/lib/kani-seo-routing.server');
      expect(getLegacyRouteRedirectUrl('https://www.kanibarber.com/admin-v2/mantenimiento')).toBe(
        'https://www.kanibarber.com/panel-administracion/mantenimiento',
      );
    });
  });

  describe('2. Contenedor y Escala de Admin V2', () => {
    it('anula padding superior extra dentro de .v2-shell para heredar la separación unificada de .v2-page (20px desktop, 16px mobile)', () => {
      expect(stylesCss).toMatch(/\.v2-shell\s+\.admin-maintenance-page\.site-container,\s*\.v2-workspace\s*>\s*\.admin-maintenance-page\s*\{[^}]*padding-top:\s*0\s*!important/);
    });

    it('la grilla define 2 columnas proporcionales en desktop (>=1024px) y 1 columna en mobile (<1024px)', () => {
      expect(stylesCss).toMatch(/\.maintenance-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
      expect(stylesCss).toMatch(/@media\s*\(min-width:\s*1024px\)\s*\{[^}]*\.maintenance-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.25fr\)\s*minmax\(0,\s*1fr\)/);
    });

    it('las tarjetas utilizan el sistema de paneles unificado con padding de 18px en desktop y 14px en mobile', () => {
      expect(stylesCss).toMatch(/\.maintenance-card,\s*\.maintenance-preserve-card,\s*\.maintenance-availability-card\s*\{[^}]*padding:\s*18px;/);
      expect(stylesCss).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[^}]*\.maintenance-card,\s*\.maintenance-preserve-card,\s*\.maintenance-availability-card\s*\{[^}]*padding:\s*14px;/);
    });
  });

  describe('3. Estructura visual y Orden de secciones', () => {
    it('renderiza título de página V2 y tarjetas principales con encabezado y descripción', async () => {
      let container: HTMLElement;
      await React.act(async () => {
        const res = render(<AdminMaintenance />);
        container = res.container;
      });
      expect(container!.querySelector('.v2-page-title')).not.toBeNull();
      expect(container!.querySelector('h1#maintenance-title')?.textContent).toBe('Mantenimiento.');
      expect(container!.querySelector('.v2-page-title p')).toBeNull();
    });

    it('organiza la segunda columna colocando Historial de disponibilidad antes que la tarjeta de preservación', async () => {
      let container: HTMLElement;
      await React.act(async () => {
        const res = render(<AdminMaintenance />);
        container = res.container;
      });
      const sideCol = container!.querySelector('.maintenance-side-col');
      expect(sideCol).not.toBeNull();
      const sections = sideCol?.querySelectorAll('section.v2-panel');
      expect(sections?.length).toBe(2);
      expect(sections?.[0].classList.contains('maintenance-availability-card')).toBe(true);
      expect(sections?.[1].classList.contains('maintenance-preserve-card')).toBe(true);
    });

    it('utiliza terminología moderna de reservas en lugar de solicitudes de turnos', async () => {
      let container: HTMLElement;
      await React.act(async () => {
        const res = render(<AdminMaintenance />);
        container = res.container;
      });
      const statusTexts = Array.from(container!.querySelectorAll('.maintenance-status-text small')).map(el => el.textContent);
      expect(statusTexts.some(t => t?.includes('Reservas pendientes de confirmación de pago'))).toBe(true);
      expect(statusTexts.some(t => t?.includes('Reservas confirmadas con seña abonada'))).toBe(true);
      expect(statusTexts.some(t => t?.includes('Reservas canceladas o no concretadas'))).toBe(true);
    });
  });

  describe('4. Verificación de Viewports Mobile y Desktop', () => {
    const viewports = [
      { name: 'Mobile 360x800', width: 360, height: 800 },
      { name: 'Mobile 375x812', width: 375, height: 812 },
      { name: 'Mobile 390x844', width: 390, height: 844 },
      { name: 'Mobile 430x932', width: 430, height: 932 },
      { name: 'Desktop 1280x720', width: 1280, height: 720 },
      { name: 'Desktop 1440x900', width: 1440, height: 900 },
      { name: 'Desktop 1920x1080', width: 1920, height: 1080 },
    ];

    for (const vp of viewports) {
      it(`mantiene coherencia y altura táctil mínima de 44px en ${vp.name}`, async () => {
        window.innerWidth = vp.width;
        window.innerHeight = vp.height;
        let container: HTMLElement;
        await React.act(async () => {
          const res = render(<AdminMaintenance />);
          container = res.container;
        });
        const main = container!.querySelector('main');
        expect(main).not.toBeNull();
        expect(main?.classList.contains('admin-maintenance-page')).toBe(true);

        const destructiveBtns = container!.querySelectorAll('.v2-destructive');
        expect(destructiveBtns.length).toBeGreaterThanOrEqual(2);
      });
    }
  });

  describe('5. Modales contenidos en 100dvh y ARIA en reautenticación', () => {
    it('los 3 DialogContent incluyen max-h-[calc(100dvh-32px)] overflow-y-auto', () => {
      const matches = maintenanceComponentCode.match(/max-h-\[calc\(100dvh-32px\)\] overflow-y-auto/g) ?? [];
      expect(matches).toHaveLength(3);
    });

    it('el input #maintenance-password expone aria-invalid y aria-describedby al fallar la reautenticación', async () => {
      const { fireEvent, screen, waitFor } = await import('@testing-library/react');
      const { reauthenticateAdmin } = await import('@/lib/kani-maintenance');
      vi.mocked(reauthenticateAdmin).mockRejectedValueOnce(new Error('Contraseña incorrecta.'));

      await React.act(async () => {
        render(<AdminMaintenance />);
      });

      fireEvent.click(screen.getByLabelText('Seleccionar Pendientes'));
      fireEvent.click(screen.getByRole('button', { name: 'Eliminar registros' }));

      const passwordInput = await screen.findByLabelText('Contraseña actual');
      expect(passwordInput).toHaveAttribute('aria-invalid', 'false');
      expect(passwordInput).not.toHaveAttribute('aria-describedby');

      fireEvent.change(passwordInput, { target: { value: 'wrong-pass' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

      await waitFor(() => {
        expect(passwordInput).toHaveAttribute('aria-invalid', 'true');
        expect(passwordInput).toHaveAttribute('aria-describedby', 'maintenance-cleanup-error');
        expect(document.getElementById('maintenance-cleanup-error')).toHaveAttribute('role', 'alert');
      });
    });
  });
});
