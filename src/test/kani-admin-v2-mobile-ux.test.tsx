import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';

// Mocks for TanStack Router
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className }: { children: ReactNode; to?: string; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
  useSearch: () => ({}),
}));

// Mocks for Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

// Mocks for Staff Context
vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    profile: {
      role: 'ADMIN',
      barber_id: 'b1',
      display_name: 'Gonzalo Kani',
    },
    barbers: [
      { id: 'b1', name: 'Gonzalo' },
      { id: 'b2', name: 'Lucas' },
    ],
  }),
}));

// Mocks for Dates & Times
vi.mock('@/lib/kani-mobile-appointments', () => ({
  businessDateToday: () => '2026-10-30',
  addCalendarDays: (d: string, n: number) => {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt.toISOString().slice(0, 10);
  },
  startOfBusinessWeek: (d: string) => d,
}));

vi.mock('@/lib/kani-payments', () => ({
  businessTimeNow: () => '14:00',
  deleteServicePayment: vi.fn(),
  updateServicePayment: vi.fn(),
  updateServicePaymentClient: vi.fn(),
  calculatePaymentPeriodRange: () => ({
    start: '2026-10-23',
    end: '2026-10-30',
    isInvalid: false,
  }),
  getPaymentPeriodDynamicLabels: () => ({}),
}));

// Mock Data Provider
vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => ({
    loading: false,
    barberId: 'ALL',
    setBarberId: vi.fn(),
    refresh: vi.fn(),
    depositSupported: true,
    services: [
      { id: 's1', name: 'Corte', price: 25000 },
      { id: 's2', name: 'Barba', price: 15000 },
    ],
    clients: [
      { id: 'c1', name: 'Martin Gomez', phone: '+5491112345678', draft: false, archived: false },
    ],
    appointments: [
      {
        id: 'a1',
        name: 'Carlos Mendez',
        phone: '+5491198765432',
        email: 'carlos@example.com',
        serviceName: 'Corte',
        servicePrice: 25000,
        date: '2026-10-30',
        time: '15:00',
        barber: 'Gonzalo',
        barberId: 'b1',
        statusCode: 'CONFIRMED',
        depositPaid: true,
        depositAmountArs: 5000,
        isManual: false,
      },
      {
        id: 'a2',
        name: 'Julian Alvarez',
        phone: '+5491122334455',
        email: null,
        serviceName: 'Corte',
        servicePrice: 25000,
        date: '2026-10-30',
        time: '16:00',
        barber: 'Lucas',
        barberId: 'b2',
        statusCode: 'COMPLETED',
        depositPaid: false,
        depositAmountArs: 0,
        isManual: true,
      },
    ],
    payments: [
      {
        id: 'p1',
        barberId: 'b1',
        paymentDate: '2026-10-30',
        collectedAmountArs: 20000,
        finalAmountArs: 25000,
        onlineDepositAmountArs: 5000,
        isDepositMovement: false,
        serviceName: 'Corte',
        paymentMethod: 'Efectivo',
      },
    ],
    starts: [],
  }),
}));

import { V2Payments } from '@/components/kani/v2/payments';
import { V2Insights } from '@/components/kani/v2/insights';
import { V2Appointments, V2Home } from '@/components/kani/v2/agenda';

describe('Admin V2 — Optimización UX/UI Mobile', () => {
  const cssPath = path.resolve(__dirname, '../components/kani/v2/v2.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  describe('1. Turnos — Botonera Mobile y Separador', () => {
    it('elimina la línea horizontal divisoria entre la card y la botonera', () => {
      // In mobile styles, border-top on appointment actions is explicitly none
      expect(css).toMatch(/\.v2-appointments-page \.v2-appointment-actions\s*\{[^}]*border-top:\s*none\s*!important/);
    });

    it('Fila 1: Cancelar turno y Cobrar al 50/50 en mobile (dos columnas minmax(0, 1fr)) con min-height 44px', () => {
      expect(css).toMatch(/\.v2-op-buttons\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)\s*!important/);
      expect(css).toMatch(/\.v2-op-buttons > \*\s*\{[^}]*width:\s*100%\s*!important;\s*min-height:\s*44px\s*!important/);
      expect(css).toMatch(/\.v2-op-buttons:has\(>\s*:only-child\)\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/);
      expect(css).toMatch(/\.v2-op-buttons > :only-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1\s*!important/);
    });

    it('Desktop: alinea toda la botonera de acciones al extremo derecho de la card', () => {
      expect(css).toMatch(/\.v2-appointments-page \.v2-appointment\s*\{[^}]*justify-content:\s*space-between\s*!important/);
      expect(css).toMatch(/\.v2-appointments-page \.v2-appointment-actions\s*\{[^}]*margin:\s*0\s+0\s+0\s+auto\s*!important/);
    });

    it('Fila 2: WhatsApp y Mail ocupan el 50% cada uno (grid 2 columnas) con altura de 44px', () => {
      expect(css).toMatch(/\.v2-contact-buttons\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important/);
      expect(css).toMatch(/\.v2-contact-buttons > \*\s*\{[^}]*width:\s*100%\s*!important;\s*min-height:\s*44px\s*!important/);
    });

    it('renderiza Cancelar turno, WhatsApp y Mail con sus respectivas clases e iconos', () => {
      render(<V2Appointments />);
      expect(screen.getAllByText('Cancelar turno')[0]).toBeDefined();
      expect(screen.getAllByText('WhatsApp')[0]).toBeDefined();
      expect(screen.getAllByText('Mail')[0]).toBeDefined();
    });
  });

  describe('2. Pagos — Agregar descuento y Asociar cliente', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('integra los botones "Agregar descuento" y "Asociar cliente" en fila con clases v2-payment-action-btn', () => {
      render(<V2Payments />);
      const descBtn = screen.getByRole('button', { name: /Agregar descuento/i });
      const clienteBtn = screen.getByRole('button', { name: /Asociar cliente/i });

      expect(descBtn).toBeDefined();
      expect(clienteBtn).toBeDefined();
      expect(descBtn.className).toContain('v2-payment-action-btn');
      expect(clienteBtn.className).toContain('v2-payment-action-btn');
    });

    it('css define .v2-payment-actions-strip con 2 columnas (50% cada una) y estilo coherente', () => {
      expect(css).toMatch(/\.v2-payment-actions-strip\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
      expect(css).toMatch(/\.v2-payment-action-btn\s*\{[^}]*min-height:\s*44px/);
      expect(css).toMatch(/\.v2-payment-action-btn\s*\{[^}]*border:\s*1px solid var\(--border\)/);
    });

    it('permite alternar visibilidad de descuento y asociar cliente sin perder valores', () => {
      render(<V2Payments />);
      const descBtn = screen.getByRole('button', { name: /Agregar descuento/i });
      fireEvent.click(descBtn);

      const descInput = screen.getByLabelText(/Descuento en pesos/i);
      expect(descInput).toBeDefined();
      fireEvent.change(descInput, { target: { value: '4000' } });

      // Toggle off and on
      fireEvent.click(screen.getByRole('button', { name: /Quitar descuento/i }));
      expect(screen.queryByLabelText(/Descuento en pesos/i)).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /Agregar descuento/i }));
      expect((screen.getByLabelText(/Descuento en pesos/i) as HTMLInputElement).value).toBe('4000');
    });
  });

  describe('3. Pagos — Resumen monetario simplificado (Estados A, B, C, D)', () => {
    it('Estado A — Sin descuento ni seña: muestra únicamente "A cobrar ahora"', () => {
      render(<V2Payments />);
      // Only "A cobrar ahora" is present in summary, no redundant "Precio del servicio" or "Importe"
      expect(screen.getByText('A cobrar ahora')).toBeDefined();
      expect(screen.queryByText('Precio del servicio')).toBeNull();
      expect(screen.getAllByText('$25.000').length).toBe(1);
    });

    it('Estado B — Con descuento: muestra desglose de precio, descuento y total', () => {
      render(<V2Payments />);
      fireEvent.click(screen.getByRole('button', { name: /Agregar descuento/i }));
      const descInput = screen.getByLabelText(/Descuento en pesos/i);
      fireEvent.change(descInput, { target: { value: '5000' } });

      expect(screen.getByText('Precio del servicio')).toBeDefined();
      expect(screen.getByText('- $5.000')).toBeDefined();
      expect(screen.getByText('A cobrar ahora')).toBeDefined();
      expect(document.querySelector('.v2-total-amount')?.textContent).toBe('$20.000');
    });

    it('Estado C — Turno asociado con seña abonada: muestra desglose con seña descontada', () => {
      render(<V2Payments />);
      fireEvent.click(screen.getByRole('button', { name: 'Con turno' }));
      fireEvent.change(screen.getByLabelText('Turno'), { target: { value: 'a1' } });

      expect(screen.getByText('Precio del servicio')).toBeDefined();
      expect(screen.getByText('Seña abonada')).toBeDefined();
      expect(screen.getByText('- $5.000')).toBeDefined();
      expect(screen.getByText('A cobrar ahora')).toBeDefined();
      expect(document.querySelector('.v2-total-amount')?.textContent).toBe('$20.000');
    });

    it('Estado D — Descuento y seña previa: muestra ambos conceptos y resultado acumulado', () => {
      render(<V2Payments />);
      fireEvent.click(screen.getByRole('button', { name: 'Con turno' }));
      fireEvent.change(screen.getByLabelText('Turno'), { target: { value: 'a1' } });

      fireEvent.click(screen.getByRole('button', { name: /Agregar descuento/i }));
      const descInput = screen.getByLabelText(/Descuento en pesos/i);
      fireEvent.change(descInput, { target: { value: '3000' } });

      expect(screen.getByText('Precio del servicio')).toBeDefined();
      expect(screen.getByText('Descuento')).toBeDefined();
      expect(screen.getByText('- $3.000')).toBeDefined();
      expect(screen.getByText('Seña abonada')).toBeDefined();
      expect(screen.getByText('- $5.000')).toBeDefined();
      expect(screen.getByText('A cobrar ahora')).toBeDefined();
      // Total: 25000 - 3000 - 5000 = 17000
      expect(screen.getByText('$17.000')).toBeDefined();
    });
  });

  describe('4. Datos — Reorganización de filtros Mobile y UX Writing', () => {
    it('Fila 1 contiene [ Período ] y [ Barbero ] sin celdas vacías en modo predefinido', () => {
      render(<V2Insights />);
      expect(screen.getByLabelText('Período')).toBeDefined();
      expect(screen.getByLabelText('Barbero')).toBeDefined();
      // No input date fields in predefined period
      expect(screen.queryByLabelText('Fecha desde')).toBeNull();
      expect(screen.queryByLabelText('Fecha hasta')).toBeNull();
    });

    it('Fila 2 muestra [ Fecha desde ] y [ Fecha hasta ] al seleccionar Fecha específica (CUSTOM)', () => {
      render(<V2Insights />);
      fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'CUSTOM' } });

      expect(screen.getByLabelText('Fecha desde')).toBeDefined();
      expect(screen.getByLabelText('Fecha hasta')).toBeDefined();
    });

    it('simplifica etiquetas de métricas: Servicios, Cobrado, Valor total, Cancelaciones', () => {
      render(<V2Insights />);
      expect(screen.getByText('Servicios')).toBeDefined();
      expect(screen.getByText('Cobrado')).toBeDefined();
      expect(screen.getByText('Valor total')).toBeDefined();
      expect(screen.getByText('Cancelaciones')).toBeDefined();

      // Overly descriptive text removed
      expect(screen.queryByText('Servicios registrados')).toBeNull();
      expect(screen.queryByText('Cobrado en el local')).toBeNull();
      expect(screen.queryByText('Valor de servicios')).toBeNull();
      expect(screen.queryByText('Sin base anterior para comparar')).toBeNull();
    });
  });

  describe('5. Inicio — UX y Consistencia con Datos', () => {
    it('simplifica métricas en "Hoy, de un vistazo": Turnos, Realizados, Pendientes, Cobrado', () => {
      render(<V2Home />);
      expect(screen.getByText('Turnos')).toBeDefined();
      expect(screen.getByText('Realizados')).toBeDefined();
      expect(screen.getByText('Pendientes')).toBeDefined();
      expect(screen.getByText('Cobrado')).toBeDefined();

      // Redundant subtitles removed
      expect(screen.queryByText('Pendientes de pago')).toBeNull();
      expect(screen.queryByText(/servicios registrados/i)).toBeNull();
    });
  });
});
