import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { businessDateToday } from '@/lib/kani-mobile-appointments';
import { PERIOD_LABELS } from '@/lib/kani-appointments';

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    barbers: [
      { id: 'b1', name: 'Lautaro' },
      { id: 'b2', name: 'Gonzalo' },
    ],
    profile: { role: 'ADMIN', barber_id: null },
  }),
}));

vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => ({
    barberId: 'ALL',
    setBarberId: vi.fn(),
    barbers: [
      { id: 'b1', name: 'Lautaro' },
      { id: 'b2', name: 'Gonzalo' },
    ],
    services: [
      { id: 'corte', dbId: 's1', name: 'Corte', price: 25000, duration: 45 },
      { id: 'barba', dbId: 's2', name: 'Barba', price: 15000, duration: 30 },
    ],
    depositSupported: true,
    refresh: vi.fn(),
    appointments: [],
    clients: [
      { id: 'c1', name: 'Lucas Gómez', phone: '+5491122334455', email: 'lucas@test.com' },
    ],
  }),
}));

vi.mock('@/lib/kani-appointments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kani-appointments')>();
  return {
    ...actual,
    createManualAppointment: vi.fn().mockResolvedValue({ id: 'new-apt-id' }),
    updateManualAppointment: vi.fn().mockResolvedValue({ id: 'updated-apt-id' }),
  };
});

import { ManualAppointmentDialog } from '@/components/kani/v2/manual-appointment-dialog';

afterEach(() => {
  cleanup();
});

describe('ManualAppointmentDialog Fullscreen & UX Mobile Redesign', () => {
  it('renders exact header with title "Generar turno manual" and formatted X button', () => {
    const handleClose = vi.fn();
    const { container } = render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={handleClose}
        onSuccess={vi.fn()}
      />
    );

    // Title must be "Generar turno manual"
    expect(
      screen.getByRole('heading', { name: 'Generar turno manual', level: 2 }),
    ).toBeInTheDocument();

    // Close button must be present in header with header-control-button class
    const closeBtn = screen.getByRole('button', { name: 'Cerrar' });
    expect(closeBtn).toBeInTheDocument();
    expect(closeBtn).toHaveClass('header-control-button');
    expect(closeBtn).toHaveClass('v2-manual-close-btn');

    // Clicking X fires onClose cleanly
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Does NOT render old barber tag in the header
    const header = document.body.querySelector('.v2-manual-dialog-header');
    expect(header).toBeInTheDocument();
    expect(header?.querySelector('.v2-barber-tag')).toBeNull();
  });

  it('eliminates Notas (opcional) completely and renders Email (opcional)', () => {
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    // Notas field must NOT exist anywhere
    expect(screen.queryByLabelText(/Notas/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/Corte clásico/i)).toBeNull();

    // Email (opcional) must be present
    expect(screen.getByLabelText(/Email \(opcional\)/i)).toBeInTheDocument();
  });

  it('uses exact new range labels for time slots without words Comercial, Antes, Después, Todos', () => {
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    // Verify PERIOD_LABELS mapping
    expect(PERIOD_LABELS).toEqual({
      COMERCIAL: '10:00 a 19:00 hs',
      ANTES: '00:00 a 09:45 hs',
      DESPUES: '19:15 a 23:45 hs',
      TODOS: '00:00 a 23:59 hs',
    });

    // Check visible buttons on screen
    expect(screen.getByRole('tab', { name: '10:00 a 19:00 hs' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '00:00 a 09:45 hs' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '19:15 a 23:45 hs' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '00:00 a 23:59 hs' })).toBeInTheDocument();

    // Verify old labels do not exist
    expect(screen.queryByText(/Comercial \(10:00 - 19:00\)/i)).toBeNull();
    expect(screen.queryByText(/Todos \(00:00 - 23:45\)/i)).toBeNull();
  });

  it('CSS validates mobile fullscreen rules, hidden site-header and single scroll', () => {
    const cssPath = path.resolve(__dirname, '../components/kani/v2/v2.css');
    const css = fs.readFileSync(cssPath, 'utf-8');

    // 1. Hide site-header while manual dialog is open
    expect(css).toContain('body:has(.v2-manual-dialog) .site-header');
    expect(css).toMatch(/display:\s*none\s*!important/);

    // 2. Fullscreen covering 100% of viewport with 100dvh and translate: none
    expect(css).toMatch(/\.v2-dialog\.v2-manual-dialog\s*\{[^}]*position:\s*fixed\s*!important/);
    expect(css).toMatch(/width:\s*100%\s*!important/);
    expect(css).toMatch(/translate:\s*none\s*!important/);
    expect(css).toMatch(/transform:\s*none\s*!important/);
    expect(css).toMatch(/height:\s*100(vh|dvh)\s*!important/);
    expect(css).toMatch(/max-height:\s*none\s*!important/);
    expect(css).toMatch(/z-index:\s*200\s*!important/);

    // 3. No rounded corners or external borders on mobile
    expect(css).toMatch(/border-radius:\s*0\s*!important/);
    expect(css).toMatch(/border:\s*none\s*!important/);

    // 4. Desktop preserves centered modal with transform translate(-50%, -50%)
    expect(css).toMatch(/@media\s*\(min-width:\s*768px\)\s*\{[^}]*\.v2-dialog\.v2-manual-dialog\s*\{[^}]*transform:\s*translate\(-50%,\s*-50%\)\s*!important/);

    // 5. No internal scrollbar in capsules container
    expect(css).toMatch(/\.v2-capsules-container\s*\{[^}]*overflow:\s*visible/);

    // 6. Capsules in 4 columns
    expect(css).toMatch(/grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)\s*!important/);

    // 7. Safe area in actions
    expect(css).toMatch(/padding-bottom:\s*calc\([^)]*safe-area-inset-bottom/);
  });
});
