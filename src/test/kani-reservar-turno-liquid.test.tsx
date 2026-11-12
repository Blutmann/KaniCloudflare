import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { LiquidLanding, PUBLIC_RESERVABLE_BARBERS } from '@/components/kani/liquid/liquid-landing';
import { LiquidBookingFlow } from '@/components/kani/liquid/liquid-booking-flow';
import { LiquidExperience } from '@/components/kani/liquid/liquid-experience';
import { KaniProvider } from '@/components/kani/store';

vi.mock('@/lib/kani-availability', () => ({
  readConfiguredServices: vi.fn().mockResolvedValue([
    { id: 'corte', name: 'Corte', price: 25000, duration: 45 },
    { id: 'corte-barba', name: 'Corte y barba', price: 30000, duration: 60 },
    { id: 'barba', name: 'Barba', price: 15000, duration: 30 },
  ]),
  readPublicAvailabilityStarts: vi.fn().mockResolvedValue([
    {
      barber_id: 'b1',
      barber_name: 'Lautaro',
      slot_date: '2026-11-20',
      start_time: '14:00:00',
      is_exception: false,
      compatible_services: ['Corte', 'Corte y barba', 'Barba'],
    },
    {
      barber_id: 'b2',
      barber_name: 'Gonzalo',
      slot_date: '2026-11-20',
      start_time: '15:00:00',
      is_exception: false,
      compatible_services: ['Corte', 'Corte y barba', 'Barba'],
    },
  ]),
  availabilityStartTimesForServiceDate: vi.fn().mockReturnValue(['14:00', '15:00']),
  eligibleBarbersForAvailabilityStart: vi.fn().mockReturnValue(['Lautaro', 'Gonzalo']),
}));

describe('Liquid Glass Experience — /reservar-turno-liquid', () => {
  it('renders Landing Page with Hero, CTAs and public barbers', async () => {
    const handleStartBooking = vi.fn();
    render(
      <KaniProvider>
        <LiquidLanding onStartBooking={handleStartBooking} />
      </KaniProvider>
    );

    // Hero title
    const heroHeading = screen.getByRole('heading', { level: 1 });
    expect(heroHeading).toBeInTheDocument();
    expect(heroHeading).toHaveTextContent(/Tu estilo/i);
    expect(heroHeading).toHaveTextContent(/Tu momento/i);
    expect(screen.getByText(/Barbería Premium/i)).toBeInTheDocument();

    // CTAs
    const reservarBtn = screen.getByRole('button', { name: /Reservar turno/i });
    expect(reservarBtn).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Conocer servicios/i })).toBeInTheDocument();

    // Public barbers
    expect(screen.getByText('Lautaro')).toBeInTheDocument();
    expect(screen.getByText('Gonzalo')).toBeInTheDocument();
    expect(screen.getByText('Valentín')).toBeInTheDocument();

    // Franco must NOT be present as a public reservable barber
    expect(screen.queryByText('Franco')).not.toBeInTheDocument();
    expect(PUBLIC_RESERVABLE_BARBERS).not.toContain('Franco');

    // Clicking Reservar turno calls handler
    fireEvent.click(reservarBtn);
    expect(handleStartBooking).toHaveBeenCalled();
  });

  it('renders Liquid Booking Flow and allows navigating steps', async () => {
    const handleExit = vi.fn();
    render(
      <KaniProvider>
        <LiquidBookingFlow onExitBooking={handleExit} />
      </KaniProvider>
    );

    // Step 0: Servicio
    expect(screen.getByText('Elegí un servicio')).toBeInTheDocument();
    expect(screen.getByText('Paso 1 de 6 · Servicio')).toBeInTheDocument();

    // Select Corte
    const corteOption = screen.getByText('Corte').closest('.liquid-option-card');
    expect(corteOption).toBeInTheDocument();
    fireEvent.click(corteOption!);

    // Next to Step 1: Barbero
    const nextBtn = screen.getByRole('button', { name: /Continuar/i });
    fireEvent.click(nextBtn);

    expect(screen.getByText('Elegí un barbero')).toBeInTheDocument();
    expect(screen.getByText('Paso 2 de 6 · Barbero')).toBeInTheDocument();

    // Franco must NOT be listed
    expect(screen.queryByText('Franco')).not.toBeInTheDocument();

    // Elegir más adelante (Cualquier barbero disponible)
    expect(screen.getByText(/Cualquier barbero disponible/i)).toBeInTheDocument();

    // Select Lautaro
    const lautaroOption = screen.getByText('Lautaro').closest('.liquid-option-card');
    fireEvent.click(lautaroOption!);

    // Next to Step 2: Fecha
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    expect(screen.getByText('Elegí una fecha')).toBeInTheDocument();
    expect(screen.getByText('Paso 3 de 6 · Fecha')).toBeInTheDocument();
  });

  it('allows full experience switching between landing and booking view', () => {
    render(
      <KaniProvider>
        <LiquidExperience />
      </KaniProvider>
    );

    // Starts in Landing view
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Tu estilo/i);

    // Click Reservar turno
    fireEvent.click(screen.getByRole('button', { name: /Reservar turno/i }));

    // Now in booking view
    expect(screen.getByText('Elegí un servicio')).toBeInTheDocument();

    // Click Volver
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));

    // Back to landing view
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Tu estilo/i);
  });
});
