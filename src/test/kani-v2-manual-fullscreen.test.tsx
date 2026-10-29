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
    payments: [],
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
import { V2Insights } from '@/components/kani/v2/insights';

afterEach(() => {
  cleanup();
});

describe('ManualAppointmentDialog Responsive Viewport-Safe Modal & Datos Filter Order', () => {
  it('renders dialog header with title "Nuevo turno manual" and working Cancelar / Close button', () => {
    const handleClose = vi.fn();
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={handleClose}
        onSuccess={vi.fn()}
      />
    );

    expect(
      screen.getByRole('heading', { name: /Nuevo turno manual/i, level: 2 }),
    ).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: 'Cancelar' });
    expect(cancelBtn).toBeInTheDocument();
    fireEvent.click(cancelBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('eliminates Notas (opcional) completely and renders Email · opcional', () => {
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    expect(screen.queryByLabelText(/Notas/i)).toBeNull();
    expect(screen.getByLabelText(/Email · opcional/i)).toBeInTheDocument();
  });

  it('eliminates capsules grid and period range tabs in favor of compact Hora de inicio | Hora de finalización', () => {
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    expect(PERIOD_LABELS).toEqual({
      COMERCIAL: '10:00 a 19:00 hs',
      ANTES: '00:00 a 09:45 hs',
      DESPUES: '19:15 a 23:45 hs',
      TODOS: '00:00 a 23:59 hs',
    });

    expect(screen.queryByRole('tab', { name: '10:00 a 19:00 hs' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '00:00 a 09:45 hs' })).toBeNull();

    const startSelect = screen.getByRole('combobox', { name: /Hora de inicio \*/i });
    expect(startSelect).toBeInTheDocument();
    expect(startSelect).toHaveValue('10:00');

    const endSelect = screen.getByRole('combobox', { name: /Hora de finalización \*/i });
    expect(endSelect).toBeInTheDocument();
    expect(endSelect).toHaveValue('10:45');

    fireEvent.change(startSelect, { target: { value: '10:15' } });
    expect(endSelect).toHaveValue('11:00');
  });

  it('renders Buscar cliente existente as a real input with search icon', () => {
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText(/Buscar cliente existente/i);
    expect(searchInput).toBeInTheDocument();
    expect(searchInput.parentElement).toHaveClass('v2-client-quick-search');
    expect(searchInput.parentElement).toHaveClass('v2-search');

    fireEvent.change(searchInput, { target: { value: 'Lucas' } });
    expect(screen.getByText('Lucas Gómez')).toBeInTheDocument();
  });

  it('CSS validates responsive viewport-safe modal rules, internal scroll and 2-column manual row', () => {
    const cssPath = path.resolve(__dirname, '../components/kani/v2/v2.css');
    const css = fs.readFileSync(cssPath, 'utf-8');

    expect(css).toContain('body:has(.v2-manual-dialog) .site-header');
    expect(css).toMatch(/display:\s*none\s*!important/);

    expect(css).toMatch(/\.v2-dialog\.v2-manual-dialog\s*\{[^}]*position:\s*fixed\s*!important/);
    expect(css).toMatch(/max-height:\s*calc\(100dvh\s*-\s*(16|24|32)px\)\s*!important/);
    expect(css).toMatch(/--tw-translate-x:\s*0px\s*!important/);
    expect(css).toMatch(/--tw-translate-y:\s*0px\s*!important/);
    expect(css).toMatch(/z-index:\s*200\s*!important/);

    expect(css).toMatch(/\.v2-manual-form\s*\{[^}]*overflow-y:\s*auto\s*!important/);
    expect(css).toMatch(/\.v2-manual-form\s*\{[^}]*min-height:\s*0\s*!important/);

    expect(css).toMatch(/@media\s*\(min-width:\s*768px\)\s*\{[^}]*\.v2-dialog\.v2-manual-dialog\s*\{[^}]*transform:\s*translate\(-50%,\s*-50%\)\s*!important/);

    expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)\s*!important/);

    expect(css).toMatch(/padding-bottom:\s*calc\([^)]*safe-area-inset-bottom/);
  });

  it('preserves exact field order: Barbero | Servicio, Fecha | Importe, Hora de inicio | Hora de finalización, Buscar cliente existente, Nombre | Celular, Email, Cancelar | Crear turno', () => {
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    const form = document.body.querySelector('.v2-manual-form');
    expect(form).not.toBeNull();
    const html = form?.innerHTML ?? '';
    const idxBarbero = html.indexOf('Barbero');
    const idxServicio = html.indexOf('Servicio');
    const idxFecha = html.indexOf('Fecha');
    const idxImporte = html.indexOf('Importe');
    const idxHoraInicio = html.indexOf('Hora de inicio');
    const idxHoraFin = html.indexOf('Hora de finalización');
    const idxBuscar = html.indexOf('Buscar cliente existente');
    const idxNombre = html.indexOf('Nombre del cliente');
    const idxCelular = html.indexOf('Celular');
    const idxEmail = html.indexOf('Email');
    const idxCancelar = html.indexOf('Cancelar');
    const idxCrear = html.indexOf('Crear turno');

    expect(idxBarbero).toBeGreaterThanOrEqual(0);
    expect(idxBarbero).toBeLessThan(idxServicio);
    expect(idxServicio).toBeLessThan(idxFecha);
    expect(idxFecha).toBeLessThan(idxImporte);
    expect(idxImporte).toBeLessThan(idxHoraInicio);
    expect(idxHoraInicio).toBeLessThan(idxHoraFin);
    expect(idxHoraFin).toBeLessThan(idxBuscar);
    expect(idxBuscar).toBeLessThan(idxNombre);
    expect(idxNombre).toBeLessThan(idxCelular);
    expect(idxCelular).toBeLessThan(idxEmail);
    expect(idxEmail).toBeLessThan(idxCancelar);
    expect(idxCancelar).toBeLessThan(idxCrear);
  });

  it('Caso H: en /admin-v2/datos (V2Insights) con Fecha específica muestra exactamente Período | Fecha desde | Fecha hasta | Barbero', () => {
    const { container } = render(<V2Insights />);
    const periodSelect = screen.getByLabelText('Período');
    fireEvent.change(periodSelect, { target: { value: 'CUSTOM' } });

    const filterPanel = container.querySelector('[aria-label="Filtros de datos"]');
    expect(filterPanel).not.toBeNull();
    const labels = Array.from(filterPanel!.querySelectorAll('.v2-admin-filter-label')).map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual(['Período', 'Fecha desde', 'Fecha hasta', 'Barbero']);
  });
});
