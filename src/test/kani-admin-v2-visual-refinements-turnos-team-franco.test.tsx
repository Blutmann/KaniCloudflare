import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';

// Mock models and booking
import { barbers, barberInstagramHandles, getEffectiveServicePrice } from '@/lib/kani-model';
import { Booking } from '@/components/kani/booking';
import { KaniProvider } from '@/components/kani/store';

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: 5000, error: null }),
  }),
}));

describe('KANI BARBER STUDIO — Ajustes visuales de Admin e interfaz de reservas', () => {
  const css = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/kani/v2/v2.css'),
    'utf-8'
  );

  describe('1. Turnos — Desktop (Unificación de botonera 4 vs 2 acciones)', () => {
    it('en desktop (>= 768px), las tarjetas con 2 acciones apilan los botones en 1 columna al 100% de ancho', () => {
      expect(css).toMatch(
        /@media\s*\(min-width:\s*768px\)[\s\S]*?\.v2-appointment-actions-grid\.count-2\s*\{[^}]*grid-template-columns:\s*1fr/
      );
    });

    it('en mobile (< 768px), las tarjetas con 2 acciones conservan 2 columnas al 50% cada una', () => {
      expect(css).toMatch(
        /\.v2-appointment-actions-grid\.count-2\s*\{[^}]*grid-template-columns:\s*1fr 1fr/
      );
    });

    it('las tarjetas con 4 acciones mantienen 2 columnas x 2 filas en mobile y desktop', () => {
      expect(css).toMatch(
        /\.v2-appointment-actions-grid\.count-4\s*\{[^}]*grid-template-columns:\s*1fr 1fr/
      );
    });

    it('todos los botones de acción de turnos conservan altura fija de 44px', () => {
      expect(css).toMatch(/\.v2-action-btn\s*\{[^}]*height:\s*44px/);
      expect(css).toMatch(/\.v2-action-btn\s*\{[^}]*min-height:\s*44px/);
    });
  });

  describe('2. Inicio — «El equipo hoy» (Distribución equilibrada de 4 barberos)', () => {
    it('en desktop amplio, muestra los 4 barberos en una única fila (4 columnas equivalentes)', () => {
      expect(css).toMatch(/\.v2-team\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    });

    it('en pantallas desktop más estrechas (<= 1024px), utiliza distribución 2 x 2 sin elementos aislados', () => {
      expect(css).toMatch(
        /@media\s*\(max-width:\s*1024px\)[\s\S]*?\.v2-team\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
      );
    });

    it('en mobile (<= 767px), conserva la columna única', () => {
      expect(css).toMatch(
        /@media\s*\(max-width:\s*767px\)[\s\S]*?\.v2-team\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/
      );
    });
  });

  describe('3. Reservas — Tarjeta de Franco (Paso «Elegí un barbero»)', () => {
    it('no muestra la etiqueta "Precio especial con Franco" en la selección de barbero', () => {
      render(
        <KaniProvider>
          <Booking
            onComplete={vi.fn()}
            initialStep={1}
            flowVariant="v4"
          />
        </KaniProvider>
      );

      // Verify all 4 barbers are present
      expect(barbers).toEqual(['Lautaro', 'Gonzalo', 'Valentín', 'Franco']);
      expect(screen.getByRole('button', { name: /Barbero Franco/i })).toBeDefined();

      // Check Franco's card
      const francoCard = screen.getByRole('button', { name: /Barbero Franco/i });
      expect(francoCard.textContent).toContain('Franco');
      expect(francoCard.textContent).toContain('@franbarber.24');

      // The promotional tag must NOT be present on the card
      expect(francoCard.textContent).not.toContain('Precio especial con Franco');
      expect(francoCard.querySelector('.booking-barber-promo')).toBeNull();
    });

    it('mantiene intactos los precios promocionales de Franco ($15.000 / $20.000 / $5.000 y seña $5.000)', () => {
      expect(getEffectiveServicePrice('corte', 'Franco')).toBe(15000);
      expect(getEffectiveServicePrice('corte-barba', 'Franco')).toBe(20000);
      expect(getEffectiveServicePrice('barba', 'Franco')).toBe(5000);

      const deposit = 5000;
      expect(getEffectiveServicePrice('corte', 'Franco') - deposit).toBe(10000);
      expect(getEffectiveServicePrice('corte-barba', 'Franco') - deposit).toBe(15000);
      expect(getEffectiveServicePrice('barba', 'Franco') - deposit).toBe(0);
    });
  });
});
