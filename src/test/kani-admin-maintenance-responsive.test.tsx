import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { AdminMaintenance } from '@/components/kani/admin-maintenance';

// Mocks
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
    { value: 'PENDING', label: 'Pendientes', description: 'Turnos pendientes de confirmación' },
    { value: 'CONFIRMED', label: 'Confirmados', description: 'Turnos confirmados con o sin seña' },
    { value: 'CANCELLED', label: 'Cancelados', description: 'Turnos cancelados por clientes o barberos' },
    { value: 'COMPLETED', label: 'Completados', description: 'Turnos marcados como realizados' },
  ],
  countAvailabilityNotifications: vi.fn().mockResolvedValue(42),
  reauthenticateAdmin: vi.fn(),
}));

describe('KANI BARBER STUDIO — Optimización responsive de Mantenimiento', () => {
  const stylesCss = fs.readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf-8');

  it('1. Contenedor principal utiliza exactamente el mismo sistema que Admin V2 (site-container, v2-page, admin-maintenance-page)', async () => {
    let container: HTMLElement;
    await React.act(async () => {
      const rendered = render(<AdminMaintenance />);
      container = rendered.container;
    });
    const main = container!.querySelector('main');
    expect(main).not.toBeNull();
    expect(main?.classList.contains('site-container')).toBe(true);
    expect(main?.classList.contains('v2-page')).toBe(true);
    expect(main?.classList.contains('admin-maintenance-page')).toBe(true);
  });

  it('2. El contenedor padre y elementos internos tienen width: 100%, max-width: 100% y min-width: 0 para evitar desbordes', () => {
    expect(stylesCss).toMatch(/\.admin-maintenance-page\s*\{[\s\S]*?width:\s*100%/);
    expect(stylesCss).toMatch(/\.admin-maintenance-page\s*\{[\s\S]*?max-width:\s*100%/);
    expect(stylesCss).toMatch(/\.admin-maintenance-page\s*\{[\s\S]*?min-width:\s*0/);
    expect(stylesCss).toMatch(/\.admin-maintenance-page\s*\{[\s\S]*?box-sizing:\s*border-box/);
  });

  it('3. Cuando está anidado en el panel V2, anula márgenes dobles y se adapta al contenedor padre', () => {
    expect(stylesCss).toMatch(/\.v2-shell\s+\.admin-maintenance-page\.site-container[\s\S]*?width:\s*100%/);
    expect(stylesCss).toMatch(/\.v2-shell\s+\.admin-maintenance-page\.site-container[\s\S]*?margin-inline:\s*0/);
  });

  it('4. Grid de mantenimiento usa 2 columnas en desktop (>=1024px) y 1 columna en mobile (<1024px)', () => {
    expect(stylesCss).toMatch(/\.maintenance-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
    expect(stylesCss).toMatch(/@media\s*\(min-width:\s*1024px\)[\s\S]*?\.maintenance-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1\.25fr\)\s*minmax\(0,\s*1fr\)/);
  });

  it('5. Las tarjetas unifican bordes, radios y efectos visuales con Admin V2', () => {
    expect(stylesCss).toMatch(/\.maintenance-card,\s*\.maintenance-preserve-card,\s*\.maintenance-availability-card\s*\{[\s\S]*?border-radius:\s*var\(--radius-card/);
    expect(stylesCss).toMatch(/\.maintenance-card,\s*\.maintenance-preserve-card,\s*\.maintenance-availability-card\s*\{[\s\S]*?background:\s*var\(--surface\)/);
    expect(stylesCss).toMatch(/\.maintenance-card,\s*\.maintenance-preserve-card,\s*\.maintenance-availability-card\s*\{[\s\S]*?box-sizing:\s*border-box/);
  });

  it('6. Opciones de estado tienen padding adecuado, min-width: 0 y ajuste tipográfico para pantallas pequeñas (360px a 430px)', () => {
    expect(stylesCss).toMatch(/\.maintenance-status-option\s*\{[\s\S]*?min-width:\s*0/);
    expect(stylesCss).toMatch(/\.maintenance-status-option\s*\{[\s\S]*?width:\s*100%/);
    expect(stylesCss).toMatch(/\.maintenance-status-text\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
    expect(stylesCss).toMatch(/\.maintenance-status-text\s*\{[\s\S]*?word-break:\s*break-word/);
  });

  it('7. Botones tienen altura mínima de 44px, no se desbordan horizontalmente y permiten salto de línea si es necesario', () => {
    expect(stylesCss).toMatch(/\.admin-maintenance-page\s+\.v2-destructive[\s\S]*?min-height:\s*44px/);
    expect(stylesCss).toMatch(/\.admin-maintenance-page\s+\.v2-destructive[\s\S]*?white-space:\s*normal/);
    expect(stylesCss).toMatch(/\.admin-maintenance-page\s+\.v2-destructive[\s\S]*?max-width:\s*100%/);
  });

  it('8. Los diálogos y modales respetan el ancho del viewport en mobile (max-w-[calc(100vw-32px)])', () => {
    const maintenanceComponent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/kani/admin-maintenance.tsx'), 'utf-8');
    expect(maintenanceComponent).toMatch(/max-w-\[calc\(100vw-32px\)\]/);
    expect(maintenanceComponent).toContain('maintenance-input');
    expect(stylesCss).toMatch(/\.maintenance-input\s*\{[\s\S]*?min-height:\s*44px/);
    expect(stylesCss).toMatch(/\.maintenance-input\s*\{[\s\S]*?width:\s*100%/);
  });

  it('9. Preserva validación de rol ADMIN y bloquea acceso no autorizado sin disparar mutaciones', () => {
    const maintenanceComponent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/kani/admin-maintenance.tsx'), 'utf-8');
    expect(maintenanceComponent).toContain("const staff = useAdminStaff();");
    expect(maintenanceComponent).toContain("const isAdmin = staff.profile.role === 'ADMIN';");
    expect(maintenanceComponent).toContain("ACCESO RESTRINGIDO");
    expect(maintenanceComponent).toContain("Solo administradores");
    expect(maintenanceComponent).toContain("if (!isAdmin) return;");
  });
});
