import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { BookingTimeSelection } from '@/components/kani/booking-time-selection';
import type { BookingTimeSlotItem } from '@/lib/kani-booking-slots';
import { PhoneInput } from '@/components/kani/phone-input';

describe('KANI — Ajustes visuales en Reserva: Horarios, Selección de Barbero y Campo Celular', () => {
  const reservaV4CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css');
  const stylesCssPath = path.resolve(__dirname, '../styles.css');
  const bookingTsxPath = path.resolve(__dirname, '../components/kani/booking.tsx');

  const cssV4 = fs.readFileSync(reservaV4CssPath, 'utf8');
  const cssStyles = fs.readFileSync(stylesCssPath, 'utf8');
  const bookingTsx = fs.readFileSync(bookingTsxPath, 'utf8');

  const mockSlots: BookingTimeSlotItem[] = [
    { time: '10:00', status: 'AVAILABLE' },
    { time: '11:30', status: 'AVAILABLE' },
    { time: '14:30', status: 'AVAILABLE' },
    { time: '16:00', status: 'UNAVAILABLE' },
  ];

  it('1. Encabezados "Mañana" y "Tarde": capitalización normal y sin negrita excesiva', () => {
    render(
      <BookingTimeSelection
        slots={mockSlots}
        selectedTime={null}
        onSelectTime={() => {}}
        availabilityLoading={false}
      />
    );

    const morningHeading = screen.getByRole('heading', { level: 2, name: 'Mañana' });
    const afternoonHeading = screen.getByRole('heading', { level: 2, name: 'Tarde' });

    expect(morningHeading).toBeInTheDocument();
    expect(afternoonHeading).toBeInTheDocument();
    expect(morningHeading.textContent).toBe('Mañana');
    expect(afternoonHeading.textContent).toBe('Tarde');

    // Regla CSS: text-transform: none (elimina uppercase) y font-weight: 500
    expect(cssV4).toMatch(/\.payway-reservation\s+\.booking-time-period-title\s*\{[\s\S]*?font-weight:\s*500;/);
    expect(cssV4).toMatch(/\.payway-reservation\s+\.booking-time-period-title\s*\{[\s\S]*?text-transform:\s*none;/);
  });

  it('2. Barberos disponibles tras elegir horario: sin checkmark en el barbero seleccionado', () => {
    // En booking.tsx, los botones de candidatos dentro de .barber-choice-list NO deben renderizar <Check>
    expect(bookingTsx).not.toMatch(/\{barber === candidate && <Check/);
    expect(bookingTsx).toContain('className={`booking-candidate-barber-btn ${barber === candidate ? \'selected\' : \'\'}`');
  });

  it('3. Barberos disponibles tras elegir horario: fondos sólidos blanco / #242424 y seleccionado bordó', () => {
    // Light mode no seleccionado: fondo blanco sólido
    expect(cssV4).toMatch(/html\[data-theme="light"\]\s+\.payway-reservation\s+\.barber-choice-list\s*>\s*button:not\(\.selected\):not\(:disabled\)[\s\S]*?background:\s*#ffffff\s*!important;/);
    expect(cssV4).toMatch(/html\[data-theme="light"\]\s+\.payway-reservation\s+\.barber-choice-list\s*>\s*button:not\(\.selected\):not\(:disabled\)[\s\S]*?backdrop-filter:\s*none\s*!important;/);

    // Dark mode no seleccionado: fondo gris oscuro #242424 idéntico a Volver
    expect(cssV4).toMatch(/html\[data-theme="dark"\]\s+\.payway-reservation\s+\.barber-choice-list\s*>\s*button:not\(\.selected\):not\(:disabled\)[\s\S]*?background:\s*#242424\s*!important;/);
    expect(cssV4).toMatch(/html\[data-theme="dark"\]\s+\.payway-reservation\s+\.barber-choice-list\s*>\s*button:not\(\.selected\):not\(:disabled\)[\s\S]*?color:\s*#ffffff\s*!important;/);

    // Seleccionado en ambos modos: fondo bordó sólido var(--primary) y borde var(--primary)
    expect(cssV4).toMatch(/\.payway-reservation\s+\.barber-choice-list\s*>\s*button\.selected[\s\S]*?background:\s*var\(--primary\)\s*!important;/);
  });

  it('4. Selector telefónico: "Argentina +54" con peso tipográfico normal / regular (font-weight: 500)', () => {
    // En styles.css y reserva-v4.css no debe tener font-weight: 700
    expect(cssStyles).toMatch(/\.phone-country-trigger\s*\{[^}]*font-weight:\s*500;/);
    expect(cssV4).toMatch(/\.payway-reservation\s+\.phone-country-trigger[\s\S]*?font-weight:\s*500\s*!important;/);
    expect(cssV4).toMatch(/\.payway-reservation\s+\.phone-country-label[\s\S]*?font-weight:\s*500\s*!important;/);
  });

  it('5. Exclusión pública de Franco: se preserva rigurosamente fuera del flujo público', () => {
    expect(bookingTsx).toContain('readPublicBookingBarbers');
    expect(bookingTsx).toContain("initialBarber !== 'Franco'");
    expect(bookingTsx).toContain('isPublicBookingBarber');
  });
});
