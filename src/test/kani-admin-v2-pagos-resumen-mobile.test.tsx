import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';

vi.mock("@tanstack/react-router", () => ({ useSearch: () => ({}) }));

// Mock AdminStaffContext
vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    profile: { role: 'ADMIN', barber_id: 'b1' },
    barbers: [{ id: 'b1', name: 'Lautaro' }],
  }),
}));

// Mock useV2
vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => ({
    barbers: [{ id: 'b1', name: 'Lautaro' }],
    services: [
      { id: 'corte', name: 'Corte de cabello', price: 30000 },
      { id: 'premium', name: 'Servicio VIP', price: 1250000 },
    ],
    appointments: [],
    clients: [],
    payments: [],
    refresh: vi.fn(),
  }),
}));

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

import { V2Payments } from '@/components/kani/v2/payments';

describe('Admin V2 Pagos — Resumen Mobile junto al botón "Cobrar"', () => {
  const css = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/kani/v2/v2.css'),
    'utf-8'
  ).replace(/\r\n/g, '\n');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Reglas CSS Responsivas (Mobile ≤767px vs Desktop)', () => {
    it('oculta en mobile la etiqueta "Importe:" con display: none !important', () => {
      expect(css).toContain('.v2-total-box-label {\n    display: none !important;');
    });

    it('oculta en mobile el desglose "Desc: -$X" con display: none !important', () => {
      expect(css).toContain('.v2-total-box-breakdown {\n    display: none !important;');
    });

    it('mantiene el importe legible, centrado y en una sola línea (nowrap) sin compresión en mobile', () => {
      expect(css).toContain('white-space: nowrap !important;');
      expect(css).toContain('text-align: center !important;');
      expect(css).toContain('overflow: hidden;');
      expect(css).toContain('text-overflow: ellipsis;');
    });

    it('en escritorio conserva la presentación con label 12px, breakdown 10px y flex space-between', () => {
      expect(css).toMatch(/\.v2-total-box-label\s*\{[^}]*font-size:\s*12px/);
      expect(css).toMatch(/\.v2-total-box-breakdown\s*\{[^}]*font-size:\s*10px/);
      expect(css).toMatch(/\.v2-payment-total-box\s*\{[^}]*justify-content:\s*space-between/);
    });
  });

  describe('2. Comportamiento funcional en el componente', () => {
    it('muestra el importe exacto sin descuento y con botón Cobrar habilitado', () => {
      render(<V2Payments />);
      // Servicio Corte = $30.000
      expect(screen.getByText('$30.000')).toBeDefined();
      expect(screen.getByText('Cobrar')).toBeDefined();
    });

    it('calcula y muestra únicamente el importe final cuando se aplica descuento (ej. $30.000 - $5.677 = $24.323)', () => {
      render(<V2Payments />);
      // Abrir campo descuento
      fireEvent.click(screen.getByRole('button', { name: /descuento/i }));
      const discountInput = screen.getByLabelText(/Descuento en pesos/i);
      fireEvent.change(discountInput, { target: { value: '5677' } });

      // El total a cobrar ahora es $24.323
      expect(screen.getByText('$24.323')).toBeDefined();
      // El botón Cobrar sigue presente
      expect(screen.getByText('Cobrar')).toBeDefined();
      // El campo para editar/ingresar descuento se mantiene visible
      expect(screen.getByLabelText(/Descuento en pesos/i)).toBeDefined();
    });

    it('soporta importes grandes sin alterar la estructura (ej. $1.250.000)', () => {
      render(<V2Payments />);
      fireEvent.change(screen.getByLabelText(/^Servicio$/i), { target: { value: 'Otros' } });
      fireEvent.change(screen.getByLabelText('Detalle del servicio'), { target: { value: 'Servicio VIP' } });
      fireEvent.change(screen.getByLabelText(/^Importe$/i), { target: { value: '1250000' } });

      // Total es $1.250.000
      expect(screen.getByText('$1.250.000')).toBeDefined();

      // Aplicar descuento de $250.000
      fireEvent.click(screen.getByRole('button', { name: /descuento/i }));
      const discountInput = screen.getByLabelText(/Descuento en pesos/i);
      fireEvent.change(discountInput, { target: { value: '250000' } });

      // Total final = $1.000.000
      expect(screen.getByText('$1.000.000')).toBeDefined();
      expect(screen.getByText('Cobrar')).toBeDefined();
    });
  });
});
