import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { KaniProvider } from '@/components/kani/store';
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';
import { liquidGlassMotionAdapter } from '@/components/kani/experimental/liquid-glass-motion';
import { dateLabel, type Barber } from '@/lib/kani-model';
import type { PublicAvailabilityStart } from '@/lib/kani-availability';

const mocks = vi.hoisted(() => ({
  readPublicBookingBarbers: vi.fn(),
  readPublicAvailabilityStarts: vi.fn(),
}));

vi.mock('@/lib/kani-availability', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/kani-availability')>();
  return {
    ...actual,
    readPublicBookingBarbers: (...args: unknown[]) => mocks.readPublicBookingBarbers(...args),
    readPublicAvailabilityStarts: (...args: unknown[]) => mocks.readPublicAvailabilityStarts(...args),
  };
});

function makeSlot(barber: Barber, date: string, time: string, services = ['Corte', 'Corte y barba', 'Barba']): PublicAvailabilityStart {
  return {
    barber_id: `id-${barber.toLowerCase()}`,
    barber_name: barber,
    slot_date: date,
    start_time: `${time}:00`,
    compatible_services: services,
    is_exception: false,
  } as unknown as PublicAvailabilityStart;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const SLOTS_BY_BARBER: Record<string, PublicAvailabilityStart[]> = {
  Valentín: [makeSlot('Valentín', '2026-11-20', '10:00'), makeSlot('Valentín', '2026-11-20', '10:45')],
  Gonzalo: [makeSlot('Gonzalo', '2026-11-20', '14:30'), makeSlot('Gonzalo', '2026-11-21', '15:15')],
  Lautaro: [makeSlot('Lautaro', '2026-11-20', '16:00'), makeSlot('Lautaro', '2026-11-22', '16:45')],
  Franco: [makeSlot('Franco', '2026-11-20', '18:15')],
};

describe('KANI V12.47.13 — Disponibilidad al cambiar de barbero en /reservar (Liquid Glass)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    mocks.readPublicBookingBarbers.mockResolvedValue([
      { id: 'id-lautaro', name: 'Lautaro' },
      { id: 'id-valentin', name: 'Valentín' },
      { id: 'id-gonzalo', name: 'Gonzalo' },
    ]);
    mocks.readPublicAvailabilityStarts.mockImplementation(async (barber: Barber | null) => {
      if (barber === null) {
        return [
          ...SLOTS_BY_BARBER.Lautaro,
          ...SLOTS_BY_BARBER.Valentín,
          ...SLOTS_BY_BARBER.Gonzalo,
          ...SLOTS_BY_BARBER.Franco,
        ];
      }
      return SLOTS_BY_BARBER[barber] ?? [];
    });
  });

  async function openBookingAtBarberStep() {
    render(
      <KaniProvider>
        <PaywayBooking homeUrl="/reservar" experimentalMotion={liquidGlassMotionAdapter} />
      </KaniProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /^Corte,/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    await screen.findByRole('button', { name: /Valentín/i });
  }

  it('1. Respuestas asíncronas fuera de orden: Valentín tarda más que Gonzalo y no sobrescribe los horarios de Gonzalo', async () => {
    const valentinDeferred = deferred<PublicAvailabilityStart[]>();
    const gonzaloDeferred = deferred<PublicAvailabilityStart[]>();

    mocks.readPublicAvailabilityStarts.mockImplementation((barber: Barber | null) => {
      if (barber === 'Valentín') return valentinDeferred.promise;
      if (barber === 'Gonzalo') return gonzaloDeferred.promise;
      return Promise.resolve([]);
    });

    await openBookingAtBarberStep();

    // Selecciona Valentín primero (respuesta lenta)
    fireEvent.click(screen.getByRole('button', { name: /Valentín/i }));
    await waitFor(() => expect(mocks.readPublicAvailabilityStarts).toHaveBeenCalledWith('Valentín', expect.any(String), expect.any(String)));

    // Cambia a Gonzalo antes de que Valentín responda, y avanza a Fecha/Horario
    fireEvent.click(screen.getByRole('button', { name: /Gonzalo/i }));
    await waitFor(() => expect(mocks.readPublicAvailabilityStarts).toHaveBeenCalledWith('Gonzalo', expect.any(String), expect.any(String)));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    // Llega primero la respuesta de Gonzalo
    await act(async () => {
      gonzaloDeferred.resolve(SLOTS_BY_BARBER.Gonzalo);
    });

    const dateBtn = await screen.findByRole('button', { name: new RegExp('^' + dateLabel('2026-11-20')) });
    await waitFor(() => expect(dateBtn).not.toBeDisabled());
    fireEvent.click(dateBtn);
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    expect(await screen.findByRole('button', { name: /14:30/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /10:00/i })).not.toBeInTheDocument();

    // Llega tardía la respuesta de Valentín: NO debe sobrescribir los horarios de Gonzalo
    await act(async () => {
      valentinDeferred.resolve(SLOTS_BY_BARBER.Valentín);
    });

    expect(screen.getByRole('button', { name: /14:30/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /10:00/i })).not.toBeInTheDocument();
  });

  it('2. Cambios rápidos y consecutivos (Valentín -> Gonzalo -> Valentín -> Elegir más adelante -> Gonzalo) actualizan disponibilidad desde el primer intento y excluyen a Franco', async () => {
    await openBookingAtBarberStep();

    // Franco nunca aparece en la selección pública
    expect(screen.queryByRole('button', { name: /Franco/i })).not.toBeInTheDocument();

    // Valentín -> Gonzalo -> Valentín (consecutivos)
    fireEvent.click(screen.getByRole('button', { name: /Valentín/i }));
    await waitFor(() => expect(mocks.readPublicAvailabilityStarts).toHaveBeenCalledWith('Valentín', expect.any(String), expect.any(String)));

    fireEvent.click(screen.getByRole('button', { name: /Gonzalo/i }));
    fireEvent.click(screen.getByRole('button', { name: /Valentín/i }));

    // Avanzar a Fecha y Horario de Valentín
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    const valentinDate = await screen.findByRole('button', { name: new RegExp('^' + dateLabel('2026-11-20')) });
    await waitFor(() => expect(valentinDate).not.toBeDisabled());
    fireEvent.click(valentinDate);
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    expect(await screen.findByRole('button', { name: /10:00/i })).toBeInTheDocument();

    // Volver al paso Barbero y cambiar a "Elegir más adelante"
    fireEvent.click(screen.getByRole('button', { name: /^Barbero$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Elegir más adelante/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    const deferredDate = await screen.findByRole('button', { name: new RegExp('^' + dateLabel('2026-11-20')) });
    await waitFor(() => expect(deferredDate).not.toBeDisabled());
    fireEvent.click(deferredDate);
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    // En Elegir más adelante muestra los horarios públicos (10:00, 14:30, 16:00) pero NO 18:15 de Franco
    expect(await screen.findByRole('button', { name: /10:00/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /14:30/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /16:00/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /18:15/i })).not.toBeInTheDocument();

    // Volver y cambiar de Elegir más adelante -> Lautaro -> Gonzalo
    fireEvent.click(screen.getByRole('button', { name: /^Barbero$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Lautaro/i }));
    fireEvent.click(screen.getByRole('button', { name: /Gonzalo/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    const gonzaloDate = await screen.findByRole('button', { name: new RegExp('^' + dateLabel('2026-11-21')) });
    await waitFor(() => expect(gonzaloDate).not.toBeDisabled());
    fireEvent.click(gonzaloDate);
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    expect(await screen.findByRole('button', { name: /15:15/i })).toBeInTheDocument();
  });

  it('3. Conserva fecha válida al cambiar de barbero, invalida el horario previo e informa si la fecha ya no tiene turnos', async () => {
    await openBookingAtBarberStep();

    // Seleccionar Lautaro, fecha 2026-11-20, horario 16:00
    fireEvent.click(screen.getByRole('button', { name: /Lautaro/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    const nov20 = await screen.findByRole('button', { name: new RegExp('^' + dateLabel('2026-11-20')) });
    await waitFor(() => expect(nov20).not.toBeDisabled());
    fireEvent.click(nov20);
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    const slot16 = await screen.findByRole('button', { name: /16:00/i });
    fireEvent.click(slot16);
    expect(slot16).toHaveAttribute('aria-pressed', 'true');

    // Cambiar de Lautaro a Gonzalo (2026-11-20 sigue siendo válida para Gonzalo, pero 16:00 no)
    fireEvent.click(screen.getByRole('button', { name: /^Barbero$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Gonzalo/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    // Fecha 2026-11-20 se conserva seleccionada porque Gonzalo tiene turno allí
    const nov20After = await screen.findByRole('button', { name: new RegExp('^' + dateLabel('2026-11-20')) });
    await waitFor(() => expect(nov20After).not.toBeDisabled());
    expect(nov20After).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    expect(await screen.findByRole('button', { name: /14:30/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /16:00/i })).not.toBeInTheDocument();

    // Ahora elegir fecha 2026-11-21 (solo Gonzalo tiene) y cambiar a Valentín (que no tiene 2026-11-21)
    fireEvent.click(screen.getByRole('button', { name: /Volver/i }));
    const nov21 = await screen.findByRole('button', { name: new RegExp('^' + dateLabel('2026-11-21')) });
    fireEvent.click(nov21);
    fireEvent.click(screen.getByRole('button', { name: /Volver/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Valentín/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    // Debe informar que la fecha seleccionada ya no tiene horarios para Valentín y permitir elegir otra (2026-11-20)
    expect(await screen.findByText(/La fecha seleccionada no tiene horarios disponibles para este barbero/i)).toBeInTheDocument();
    const nov20Valentin = screen.getByRole('button', { name: new RegExp('^' + dateLabel('2026-11-20')) });
    await waitFor(() => expect(nov20Valentin).not.toBeDisabled());
    fireEvent.click(nov20Valentin);
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    expect(await screen.findByRole('button', { name: /10:00/i })).toBeInTheDocument();
  });

  it('4. Distingue estado cargando, fecha sin horarios disponibles y error al consultar disponibilidad', async () => {
    const pendingGonzalo = deferred<PublicAvailabilityStart[]>();
    mocks.readPublicAvailabilityStarts.mockImplementation((barber: Barber | null) => {
      if (barber === 'Valentín') return Promise.resolve(SLOTS_BY_BARBER.Valentín);
      if (barber === 'Gonzalo') return pendingGonzalo.promise;
      if (barber === 'Lautaro') return Promise.reject(new Error('Error de red al consultar disponibilidad'));
      return Promise.resolve([]);
    });

    await openBookingAtBarberStep();

    // 1) Valentín en 2026-11-20 con servicio Barba sin compatibilidad -> fecha sin horarios
    fireEvent.click(screen.getByRole('button', { name: /Volver/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Barba,/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    mocks.readPublicAvailabilityStarts.mockImplementation(async (barber: Barber | null) => {
      if (barber === 'Valentín') return [makeSlot('Valentín', '2026-11-20', '10:00', ['Corte'])];
      if (barber === 'Gonzalo') return pendingGonzalo.promise;
      if (barber === 'Lautaro') return Promise.reject(new Error('Error de red al consultar disponibilidad'));
      return [];
    });

    fireEvent.click(screen.getByRole('button', { name: /Valentín/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    expect(await screen.findByText(/No encontramos turnos disponibles para los próximos días/i)).toBeInTheDocument();

    // 2) Cambiar a Gonzalo (pendiente): en Horario muestra estado cargando
    fireEvent.click(screen.getByRole('button', { name: /Volver/i }));
    fireEvent.click(screen.getByRole('button', { name: /Gonzalo/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    expect(screen.queryByText(/No encontramos turnos disponibles/i)).not.toBeInTheDocument();

    await act(async () => {
      pendingGonzalo.resolve(SLOTS_BY_BARBER.Gonzalo);
    });
    const nov20 = await screen.findByRole('button', { name: new RegExp('^' + dateLabel('2026-11-20')) });
    await waitFor(() => expect(nov20).not.toBeDisabled());
    fireEvent.click(nov20);
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    expect(await screen.findByRole('button', { name: /14:30/i })).toBeInTheDocument();

    // 3) Cambiar a Lautaro (error): muestra alerta de error y NO "No hay horarios disponibles"
    fireEvent.click(screen.getByRole('button', { name: /^Barbero$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Lautaro/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Error de red al consultar disponibilidad/i);
    expect(screen.queryByText(/No hay horarios disponibles para esta fecha/i)).not.toBeInTheDocument();
  });
});
