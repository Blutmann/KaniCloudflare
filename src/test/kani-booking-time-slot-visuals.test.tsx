import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { BookingTimeSelection } from '@/components/kani/booking-time-selection';
import type { BookingTimeSlotItem } from '@/lib/kani-booking-slots';

describe('KANI - Visuales y accesibilidad en selección de horarios', () => {
  const reservaV4CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css');
  const cssV4 = fs.readFileSync(reservaV4CssPath, 'utf8');

  const mockSlots: BookingTimeSlotItem[] = [
    { time: '10:00', status: 'AVAILABLE' },
    { time: '11:30', status: 'AVAILABLE' },
    { time: '14:30', status: 'AVAILABLE' },
    { time: '16:00', status: 'UNAVAILABLE' },
  ];

  it('1. Elimina completamente el ícono checkmark del horario seleccionado conservando accesibilidad', () => {
    const handleSelectTime = vi.fn();

    const { container } = render(
      <BookingTimeSelection
        slots={mockSlots}
        selectedTime="11:30"
        onSelectTime={handleSelectTime}
        availabilityLoading={false}
      />
    );

    // El slot seleccionado debe existir con aria-pressed="true" y label descriptivo
    const selectedBtn = screen.getByRole('button', { name: /Horario 11:30, seleccionado/i });
    expect(selectedBtn).toBeInTheDocument();
    expect(selectedBtn).toHaveAttribute('aria-pressed', 'true');
    expect(selectedBtn.classList.contains('selected')).toBe(true);

    // NO debe existir ningún elemento con la clase booking-time-slot-check
    const checkIcon = container.querySelector('.booking-time-slot-check');
    expect(checkIcon).toBeNull();

    // El botón del horario solo debe contener el texto del horario (sin SVG de check)
    const svgsInSelectedBtn = selectedBtn.querySelectorAll('svg');
    expect(svgsInSelectedBtn.length).toBe(0);

    // Los slots no seleccionados conservan aria-pressed="false"
    const unselectedBtn = screen.getByRole('button', { name: /Horario 10:00/i });
    expect(unselectedBtn).toHaveAttribute('aria-pressed', 'false');
    expect(unselectedBtn.classList.contains('selected')).toBe(false);

    // Al hacer clic en otro slot se dispara onSelectTime
    fireEvent.click(unselectedBtn);
    expect(handleSelectTime).toHaveBeenCalledWith('10:00');
  });

  it('2. Modo claro: horarios no seleccionados tienen fondo blanco sólido sin transparencias', () => {
    // Fondo blanco sólido (#ffffff) idéntico al botón Volver en modo claro
    expect(cssV4).toMatch(
      /html\[data-theme="light"\]\s+\.payway-reservation\s+\.booking-time-slot:not\(\.selected\):not\(:disabled\):not\(\.time-unavailable\)\s*\{[\s\S]*?background:\s*#ffffff\s*!important;/
    );
    expect(cssV4).toMatch(
      /html\[data-theme="light"\]\s+\.payway-reservation\s+\.booking-time-slot:not\(\.selected\):not\(:disabled\):not\(\.time-unavailable\)\s*\{[\s\S]*?backdrop-filter:\s*none\s*!important;/
    );
  });

  it('3. Modo oscuro: horarios no seleccionados tienen fondo gris oscuro #242424 idéntico al botón Volver', () => {
    // Fondo gris carbón sólido #242424, texto blanco y borde sutil
    expect(cssV4).toMatch(
      /html\[data-theme="dark"\]\s+\.payway-reservation\s+\.booking-time-slot:not\(\.selected\):not\(:disabled\):not\(\.time-unavailable\)\s*\{[\s\S]*?background:\s*#242424\s*!important;/
    );
    expect(cssV4).toMatch(
      /html\[data-theme="dark"\]\s+\.payway-reservation\s+\.booking-time-slot:not\(\.selected\):not\(:disabled\):not\(\.time-unavailable\)\s*\{[\s\S]*?color:\s*#ffffff\s*!important;/
    );
    expect(cssV4).toMatch(
      /html\[data-theme="dark"\]\s+\.payway-reservation\s+\.booking-time-slot:not\(\.selected\):not\(:disabled\):not\(\.time-unavailable\)\s*\{[\s\S]*?border:\s*1px solid rgba\(255, 255, 255, 0\.15\)\s*!important;/
    );
    expect(cssV4).toMatch(
      /html\[data-theme="dark"\]\s+\.payway-reservation\s+\.booking-time-slot:not\(\.selected\):not\(:disabled\):not\(\.time-unavailable\)\s*\{[\s\S]*?backdrop-filter:\s*none\s*!important;/
    );
  });

  it('4. Horario seleccionado conserva fondo bordó sólido institucional (var(--primary)) en ambos temas', () => {
    // Selected en light y dark
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-time-slot\.selected,\s*html\[data-theme="light"\]\s+\.payway-reservation\s+\.booking-time-slot\.selected,\s*html\[data-theme="dark"\]\s+\.payway-reservation\s+\.booking-time-slot\.selected\s*\{[\s\S]*?background:\s*var\(--primary\)\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-time-slot\.selected,\s*html\[data-theme="light"\]\s+\.payway-reservation\s+\.booking-time-slot\.selected,\s*html\[data-theme="dark"\]\s+\.payway-reservation\s+\.booking-time-slot\.selected\s*\{[\s\S]*?color:\s*#ffffff\s*!important;/
    );
  });

  it('5. Hover, focus y disabled conservan contraste y estados sin traslucir el fondo', () => {
    // Hover modo claro
    expect(cssV4).toMatch(
      /html\[data-theme="light"\]\s+\.payway-reservation\s+\.booking-time-slot:not\(\.selected\):not\(:disabled\):not\(\.time-unavailable\):hover/
    );
    // Hover modo oscuro: fondo #2e2e2e
    expect(cssV4).toMatch(
      /html\[data-theme="dark"\]\s+\.payway-reservation\s+\.booking-time-slot:not\(\.selected\):not\(:disabled\):not\(\.time-unavailable\):hover[\s\S]*?background:\s*#2e2e2e\s*!important;/
    );
    // Disabled modo oscuro: fondo #242424
    expect(cssV4).toMatch(
      /html\[data-theme="dark"\]\s+\.payway-reservation\s+\.booking-time-slot:disabled:not\(\.selected\)[\s\S]*?background:\s*#242424\s*!important;/
    );
  });
});
