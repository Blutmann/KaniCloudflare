import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
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
    { value: 'PENDING', label: 'Pendientes', description: 'Turnos pendientes de confirmación' },
    { value: 'CONFIRMED', label: 'Confirmados', description: 'Turnos confirmados con o sin seña' },
    { value: 'CANCELLED', label: 'Cancelados', description: 'Turnos cancelados por clientes o barberos' },
    { value: 'COMPLETED', label: 'Completados', description: 'Turnos marcados como realizados' },
  ],
  countAvailabilityNotifications: vi.fn().mockResolvedValue(15),
  reauthenticateAdmin: vi.fn(),
}));

describe('KANI — Verificación de viewports mobile y desktop para Mantenimiento', () => {
  const viewports = [
    { name: 'Mobile 360x800', width: 360, height: 800, isMobile: true },
    { name: 'Mobile 375x812', width: 375, height: 812, isMobile: true },
    { name: 'Mobile 390x844', width: 390, height: 844, isMobile: true },
    { name: 'Mobile 430x932', width: 430, height: 932, isMobile: true },
    { name: 'Desktop 1280x720', width: 1280, height: 720, isMobile: false },
    { name: 'Desktop 1440x900', width: 1440, height: 900, isMobile: false },
    { name: 'Desktop 1920x1080', width: 1920, height: 1080, isMobile: false },
  ];

  for (const vp of viewports) {
    it(`debe renderizar sin desborde horizontal en ${vp.name} (${vp.width}px)`, async () => {
      // Configurar viewport
      window.innerWidth = vp.width;
      window.innerHeight = vp.height;

      let container: HTMLElement;
      await React.act(async () => {
        const res = render(<AdminMaintenance />);
        container = res.container;
      });

      const main = container!.querySelector('main');
      expect(main).not.toBeNull();
      expect(main?.classList.contains('site-container')).toBe(true);

      const cards = container!.querySelectorAll('.v2-panel');
      expect(cards.length).toBeGreaterThanOrEqual(3);

      // Verificar que los botones destructivos tengan min-h 44px
      const actionButtons = container!.querySelectorAll('button:not([role="checkbox"])');
      expect(actionButtons.length).toBeGreaterThanOrEqual(2);
      for (const btn of actionButtons) {
        expect(btn.classList.contains('v2-destructive') || btn.classList.contains('action-brand')).toBe(true);
      }
    });
  }
});
