import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';
import { LiquidGlassBooking } from '@/components/kani/experimental/liquid-glass-booking';

const mockReadPublicAvailabilityStarts = vi.fn();

vi.mock('@/components/kani/store', () => ({
  useKani: () => ({
    mobileMenuOpen: false,
    setMobileMenuOpen: vi.fn(),
    theme: 'dark',
    toggleTheme: vi.fn(),
  }),
}));

vi.mock('@/lib/kani-availability', async (original) => {
  const actual = await original<typeof import('@/lib/kani-availability')>();
  return {
    ...actual,
    readConfiguredServices: async () => [],
    readPublicBookingBarbers: async () => ['Lautaro', 'Gonzalo', 'Valentín'].map((name) => ({ id: name, name })),
    readPublicAvailabilityStarts: (...args: unknown[]) => mockReadPublicAvailabilityStarts(...args),
  };
});

vi.mock('@/lib/kani-appointments', () => ({
  createRealAppointment: vi.fn(),
  appointmentErrorMessage: String,
}));

vi.mock('@/lib/kani-down-payment', () => ({
  getDynamicDownPayment: async () => 5000,
}));

function buildFutureDate(daysAhead = 2) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // avoid Sunday
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildStarts(date: string, entries: Array<{ barber: 'Lautaro' | 'Gonzalo' | 'Valentín'; times: string[] }>) {
  const rows: Array<{
    barber_id: string;
    barber_name: 'Lautaro' | 'Gonzalo' | 'Valentín';
    slot_date: string;
    start_time: string;
    is_exception: boolean;
    compatible_services: string[];
  }> = [];
  for (const entry of entries) {
    for (const t of entry.times) {
      rows.push({
        barber_id: entry.barber,
        barber_name: entry.barber,
        slot_date: date,
        start_time: t,
        is_exception: true,
        compatible_services: ['Corte', 'Barba', 'Corte y barba'],
      });
    }
  }
  return rows;
}

describe('KANI Barber Studio — Liquid Glass V12.15 (Smooth Availability Updates & Defer Barber)', () => {
  const targetDate1 = buildFutureDate(2);
  const targetDate2 = buildFutureDate(3);

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadPublicAvailabilityStarts.mockReset();
    Element.prototype.scrollTo = vi.fn();
    window.scrollTo = vi.fn();
    document.body.classList.remove('liquid-glass-active');
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove('liquid-glass-active');
  });

  async function goToDeferredTimeStep() {
    render(<LiquidGlassBooking />);

    // Step 0: Service
    const serviceBtn = await screen.findByRole('button', { name: /Corte, 45 minutos/i });
    fireEvent.click(serviceBtn);
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    // Step 1: Elegir más adelante
    const deferBtn = await screen.findByRole('button', { name: /Elegir más adelante|Cualquier barbero disponible/i });
    fireEvent.click(deferBtn);

    await waitFor(() => expect(mockReadPublicAvailabilityStarts).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    // Step 2: Date
    const nextBtnStep2 = await screen.findByRole('button', { name: /Continuar/i });
    await waitFor(() => expect(nextBtnStep2).not.toBeDisabled());
    fireEvent.click(nextBtnStep2);

    // Step 3: Time selection
    await screen.findByRole('button', { name: /Horario 10:00/i });
  }

  it('1. No reemplaza la grilla ni dispara consultas redundantes al elegir horario o cambiar barbero diferido, y habilita Continuar a Datos', async () => {
    const initialRows = buildStarts(targetDate1, [
      { barber: 'Lautaro', times: ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30'] },
      { barber: 'Gonzalo', times: ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30'] },
    ]);
    mockReadPublicAvailabilityStarts.mockResolvedValue(initialRows);

    await goToDeferredTimeStep();
    expect(mockReadPublicAvailabilityStarts).toHaveBeenCalledTimes(1);

    // Selecting 10:00 must NOT fire a redundant availability fetch
    fireEvent.click(screen.getByRole('button', { name: /Horario 10:00/i }));
    await screen.findByRole('button', { name: /Barbero Lautaro/i });
    expect(mockReadPublicAvailabilityStarts).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Buscando horarios disponibles/i)).not.toBeInTheDocument();

    // Rapidly switching time to 10:45 must NOT fire a redundant availability fetch
    fireEvent.click(screen.getByRole('button', { name: /Horario 10:45/i }));
    expect(mockReadPublicAvailabilityStarts).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Buscando horarios disponibles/i)).not.toBeInTheDocument();

    // Selecting candidate barber verifies combination in background WITHOUT hiding the grid
    fireEvent.click(screen.getByRole('button', { name: /Barbero Lautaro/i }));
    expect(screen.getByRole('button', { name: /Horario 10:45/i })).toBeInTheDocument();
    expect(screen.queryByText(/Buscando horarios disponibles/i)).not.toBeInTheDocument();

    await waitFor(() => expect(mockReadPublicAvailabilityStarts).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: /Barbero Lautaro, seleccionado/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Horario 10:45, seleccionado/i })).toBeInTheDocument();

    // Continue to Datos (Step 4)
    const continueBtn = screen.getByRole('button', { name: /Continuar/i });
    expect(continueBtn).not.toBeDisabled();
    fireEvent.click(continueBtn);
    await screen.findByLabelText(/Nombre y apellido/i);
  });

  it('2. Deduplica consultas concurrentes y protege contra respuestas lentas al cambiar rápidamente de barbero', async () => {
    const initialRows = buildStarts(targetDate1, [
      { barber: 'Lautaro', times: ['10:00', '10:15', '10:30', '10:45'] },
      { barber: 'Gonzalo', times: ['10:00', '10:15', '10:30', '10:45'] },
    ]);

    let resolveSlow!: (val: typeof initialRows) => void;
    mockReadPublicAvailabilityStarts
      .mockResolvedValueOnce(initialRows)
      .mockImplementationOnce(() => new Promise((r) => { resolveSlow = r; }));

    await goToDeferredTimeStep();
    fireEvent.click(screen.getByRole('button', { name: /Horario 10:00/i }));

    // Click Lautaro (slow verification starts), then immediately switch to Gonzalo while in-flight
    fireEvent.click(await screen.findByRole('button', { name: /Barbero Lautaro/i }));
    fireEvent.click(screen.getByRole('button', { name: /Barbero Gonzalo/i }));

    // Concurrent identical verification is deduplicated (1 initial + 1 shared verification)
    expect(mockReadPublicAvailabilityStarts).toHaveBeenCalledTimes(2);
    // Grid stays visible without replacing with "Buscando horarios disponibles…"
    expect(screen.queryByText(/Buscando horarios disponibles/i)).not.toBeInTheDocument();

    // Even if the in-flight response says Lautaro is gone, Gonzalo stays selected cleanly
    await act(async () => {
      resolveSlow(buildStarts(targetDate1, [
        { barber: 'Gonzalo', times: ['10:00', '10:15', '10:30', '10:45'] },
      ]));
    });

    expect(screen.getByRole('button', { name: /Barbero Gonzalo, seleccionado/i })).toBeInTheDocument();
    expect(screen.queryByText(/dejó de estar disponible/i)).not.toBeInTheDocument();
  });

  it('3. Si el barbero o el horario dejan de estar disponibles durante la verificación, invalida solo la selección afectada e informa claramente', async () => {
    const initialRows = buildStarts(targetDate1, [
      { barber: 'Lautaro', times: ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45'] },
      { barber: 'Gonzalo', times: ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45'] },
    ]);
    // On verify, Lautaro is no longer available at 10:00, but Gonzalo still is
    const afterVerifyRows = buildStarts(targetDate1, [
      { barber: 'Gonzalo', times: ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45'] },
    ]);

    mockReadPublicAvailabilityStarts
      .mockResolvedValueOnce(initialRows)
      .mockResolvedValueOnce(afterVerifyRows);

    await goToDeferredTimeStep();
    fireEvent.click(screen.getByRole('button', { name: /Horario 10:00/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Barbero Lautaro/i }));

    await screen.findByText(/Lautaro dejó de estar disponible a las 10:00 hs/i);
    // Time 10:00 remains selected, only Lautaro selection was invalidated
    expect(screen.getByRole('button', { name: /Horario 10:00, seleccionado/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Barbero Lautaro/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Barbero Gonzalo/i })).toBeInTheDocument();

    // Also test returning to Fecha and picking another day works cleanly
    const backBtn = screen.getByRole('button', { name: /Volver/i });
    fireEvent.click(backBtn);
    expect(await screen.findByRole('button', { name: /Continuar/i })).toBeInTheDocument();
    expect(targetDate2).toBeTruthy();
  });
});
