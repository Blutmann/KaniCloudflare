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
      { id: 'corte', name: 'Corte', price: 25000 },
      { id: 'barba', name: 'Barba', price: 15000 },
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

describe('Admin V2 Pagos — Botón Descuento Mobile (≤767px) vs Desktop', () => {
  const css = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/kani/v2/v2.css'),
    'utf-8'
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renderiza ambos textos ("Agregar descuento" desktop y "Descuento" mobile) con las clases correspondientes', () => {
    render(<V2Payments />);
    const discountBtn = screen.getByRole('button', { name: /descuento/i });
    expect(discountBtn).toBeDefined();

    const desktopSpan = discountBtn.querySelector('.v2-discount-text-desktop');
    const mobileSpan = discountBtn.querySelector('.v2-discount-text-mobile');

    expect(desktopSpan).not.toBeNull();
    expect(desktopSpan?.textContent).toBe('Agregar descuento');

    expect(mobileSpan).not.toBeNull();
    expect(mobileSpan?.textContent).toBe('Descuento');
  });

  it('mantiene el ícono Tag actual', () => {
    render(<V2Payments />);
    const discountBtn = screen.getByRole('button', { name: /descuento/i });
    const tagIcon = discountBtn.querySelector('svg.lucide-tag');
    expect(tagIcon).not.toBeNull();
  });

  it('conserva la funcionalidad de alternar descuento al hacer clic', () => {
    render(<V2Payments />);
    const discountBtn = screen.getByRole('button', { name: /descuento/i });
    
    // Toggle on
    fireEvent.click(discountBtn);
    expect(screen.getByLabelText(/Descuento en pesos/i)).toBeDefined();
    expect(screen.getByText('Quitar descuento')).toBeDefined();

    // Toggle off
    fireEvent.click(screen.getByRole('button', { name: /Quitar descuento/i }));
    expect(screen.queryByLabelText(/Descuento en pesos/i)).toBeNull();
  });

  it('CSS define white-space: nowrap y alineación centrada para garantizar una sola línea', () => {
    expect(css).toMatch(/\.v2-payment-toggle-btn\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.v2-payment-toggle-btn\s*\{[^}]*display:\s*inline-flex/);
    expect(css).toMatch(/\.v2-payment-toggle-btn\s*\{[^}]*align-items:\s*center/);
    expect(css).toMatch(/\.v2-payment-toggle-btn\s*\{[^}]*justify-content:\s*center/);
    expect(css).toMatch(/\.v2-payment-toggle-btn\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.v2-payment-toggle-btn\s*\{[^}]*height:\s*44px/);
  });

  it('CSS define fila de 2 columnas al 50% cada una en .v2-payment-row', () => {
    expect(css).toMatch(/\.v2-payment-row\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  });

  it('CSS define reglas responsivas para mobile (≤767px): oculta texto desktop y muestra "Descuento"', () => {
    expect(css).toMatch(/\.v2-discount-text-desktop\s*\{[^}]*display:\s*inline/);
    expect(css).toMatch(/\.v2-discount-text-mobile\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)[^}]*\{[\s\S]*?\.v2-discount-text-desktop\s*\{[^}]*display:\s*none\s*!important/);
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)[^}]*\{[\s\S]*?\.v2-discount-text-mobile\s*\{[^}]*display:\s*inline\s*!important/);
  });

  it('preserva el estilo activo dorado en modo oscuro', () => {
    expect(css).toMatch(/html\[data-theme="dark"\]\s+\.v2-payment-toggle-btn\.active[^}]*background:\s*var\(--gold\)\s*!important/);
    expect(css).toMatch(/html\[data-theme="dark"\]\s+\.v2-payment-toggle-btn\.active[^}]*color:\s*#121212\s*!important/);
  });
});
