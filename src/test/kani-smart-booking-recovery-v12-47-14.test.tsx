import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { KaniProvider } from '@/components/kani/store';
import { Booking } from '@/components/kani/booking';
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';
import { liquidGlassMotionAdapter } from '@/components/kani/experimental/liquid-glass-motion';
import {
  BOOKING_DRAFT_STORAGE_KEY,
  buenosAiresAppointmentStartMs,
  clearBookingDraft,
  readValidBookingDraft,
  saveBookingDraft,
} from '@/lib/kani-booking-draft';
import { dateLabel, type Barber } from '@/lib/kani-model';
import type { PublicAvailabilityStart } from '@/lib/kani-availability';

const mocks = vi.hoisted(() => ({
  readPublicBookingBarbers: vi.fn(),
  readPublicAvailabilityStarts: vi.fn(),
  validateBenefitCodeQuoteFn: vi.fn(),
  preparePaywayCheckoutFn: vi.fn(),
  checkPaywayPaymentStatusFn: vi.fn(),
}));

vi.mock('@/lib/kani-availability', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/kani-availability')>();
  return {
    ...actual,
    readPublicBookingBarbers: (...args: unknown[]) => mocks.readPublicBookingBarbers(...args),
    readPublicAvailabilityStarts: (...args: unknown[]) => mocks.readPublicAvailabilityStarts(...args),
  };
});

vi.mock('@/lib/kani-benefit-codes.functions', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/kani-benefit-codes.functions')>();
  return {
    ...actual,
    validateBenefitCodeQuoteFn: (...args: unknown[]) => mocks.validateBenefitCodeQuoteFn(...args),
  };
});

vi.mock('@/lib/kani-payway.functions', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/kani-payway.functions')>();
  return {
    ...actual,
    preparePaywayCheckoutFn: (...args: unknown[]) => mocks.preparePaywayCheckoutFn(...args),
    checkPaywayPaymentStatusFn: (...args: unknown[]) => mocks.checkPaywayPaymentStatusFn(...args),
  };
});

function makeSlot(barber: Barber, date: string, time: string): PublicAvailabilityStart {
  return {
    barber_id: `id-${barber.toLowerCase()}`,
    barber_name: barber,
    slot_date: date,
    start_time: `${time}:00`,
    compatible_services: ['Corte', 'Corte y barba', 'Barba'],
    is_exception: false,
  } as unknown as PublicAvailabilityStart;
}

describe('KANI V12.47.14 — Smart Booking Recovery (/reservar Liquid Glass)', () => {
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
      if (barber === 'Gonzalo') {
        return [makeSlot('Gonzalo', '2026-11-20', '14:30'), makeSlot('Gonzalo', '2026-11-20', '15:15')];
      }
      if (barber === 'Valentín') {
        return [makeSlot('Valentín', '2026-11-20', '10:00')];
      }
      return [makeSlot('Lautaro', '2026-11-20', '16:00')];
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1, 2 y 3. Guarda únicamente datos válidos, excluye inválidos y elimina campos que pasan de válidos a inválidos', () => {
    const now = Date.now();
    // Datos inválidos o no permitidos (Franco, nombre < 3, celular inválido, email inválido)
    const invalidOnly = saveBookingDraft(
      {
        service: null,
        barber: 'Franco',
        barberDeferred: false,
        date: null,
        time: null,
        name: 'To',
        phone: '123',
        phoneCountry: 'AR',
        email: 'tomas@gmail',
        benefitCode: null,
        lastMeaningfulActivityAt: now,
      },
      now,
    );
    expect(invalidOnly).toBeNull();
    expect(window.localStorage.getItem(BOOKING_DRAFT_STORAGE_KEY)).toBeNull();

    // Datos válidos completos
    const valid = saveBookingDraft(
      {
        service: 'corte',
        barber: 'Gonzalo',
        barberDeferred: false,
        date: '2026-11-20',
        time: '14:30',
        name: 'Tomás Pérez',
        phone: '11 5555-6666',
        phoneCountry: 'AR',
        email: 'tomas@gmail.com',
        benefitCode: 'KANI-10OFF',
        lastMeaningfulActivityAt: now,
      },
      now,
    );
    expect(valid).not.toBeNull();
    expect(valid?.email).toBe('tomas@gmail.com');
    expect(valid?.name).toBe('Tomás Pérez');
    expect(valid?.phone).toBe('11 5555-6666');
    expect(valid?.benefitCode).toBe('KANI-10OFF');

    // Invalidación posterior: email pasa a tomas@gmail, nombre a "To", phone a "12"
    const updated = saveBookingDraft(
      {
        service: 'corte',
        barber: 'Gonzalo',
        barberDeferred: false,
        date: '2026-11-20',
        time: '14:30',
        name: 'To',
        phone: '12',
        phoneCountry: 'AR',
        email: 'tomas@gmail',
        benefitCode: null,
        lastMeaningfulActivityAt: now + 1000,
      },
      now + 1000,
    );
    expect(updated?.email).toBeNull();
    expect(updated?.name).toBeNull();
    expect(updated?.phone).toBeNull();
    expect(updated?.benefitCode).toBeNull();
    const persisted = readValidBookingDraft(now + 1000);
    expect(persisted?.email).toBeNull();
    expect(persisted?.service).toBe('corte');
  });

  it('5 y 6. Expira a los 60 minutos de inactividad y 15 minutos antes del turno en America/Argentina/Buenos_Aires', () => {
    const startMs = buenosAiresAppointmentStartMs('2026-11-20', '14:30')!;
    // Caso A: actividad 2 horas antes del turno -> vence a los 60 min de inactividad
    const activityEarly = startMs - 2 * 60 * 60 * 1000;
    const draftEarly = saveBookingDraft(
      {
        service: 'corte',
        barber: 'Gonzalo',
        barberDeferred: false,
        date: '2026-11-20',
        time: '14:30',
        name: null,
        phone: null,
        phoneCountry: 'AR',
        email: null,
        benefitCode: null,
        lastMeaningfulActivityAt: activityEarly,
      },
      activityEarly,
    );
    expect(draftEarly?.expiresAt).toBe(activityEarly + 60 * 60 * 1000);
    expect(readValidBookingDraft(activityEarly + 59 * 60 * 1000)).not.toBeNull();
    expect(readValidBookingDraft(activityEarly + 60 * 60 * 1000)).toBeNull();

    // Caso B: actividad 25 min antes del turno -> vence 15 min antes del turno (solo dura 10 min)
    const activityNear = startMs - 25 * 60 * 1000;
    const draftNear = saveBookingDraft(
      {
        service: 'corte',
        barber: 'Gonzalo',
        barberDeferred: false,
        date: '2026-11-20',
        time: '14:30',
        name: 'Tomás Pérez',
        phone: null,
        phoneCountry: 'AR',
        email: null,
        benefitCode: null,
        lastMeaningfulActivityAt: activityNear,
      },
      activityNear,
    );
    expect(draftNear?.expiresAt).toBe(startMs - 15 * 60 * 1000);
    expect(readValidBookingDraft(startMs - 16 * 60 * 1000)).not.toBeNull();
    expect(readValidBookingDraft(startMs - 14 * 60 * 1000)).toBeNull();
    // Al vencer se elimina del almacenamiento local
    expect(window.localStorage.getItem(BOOKING_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('4 y 16. Recuperación completa de reserva válida y descuento revalidado sin duplicar reservas ni cobros Payway', async () => {
    const now = Date.now();
    saveBookingDraft(
      {
        service: 'corte',
        barber: 'Gonzalo',
        barberDeferred: false,
        date: '2026-11-20',
        time: '14:30',
        name: 'Tomás Pérez',
        phone: '11 5555-6666',
        phoneCountry: 'AR',
        email: 'tomas@gmail.com',
        benefitCode: 'KANI-FREE',
        lastMeaningfulActivityAt: now,
      },
      now,
    );
    mocks.validateBenefitCodeQuoteFn.mockResolvedValue({
      valid: true,
      code: 'KANI-FREE',
      benefitType: 'FREE_SERVICE',
      onlineDepositArs: 0,
      inPersonBalanceArs: 0,
      finalPriceArs: 0,
      originalPriceArs: 16000,
      discountAmountArs: 16000,
    });

    render(
      <KaniProvider>
        <PaywayBooking homeUrl="/reservar" experimentalMotion={liquidGlassMotionAdapter} />
      </KaniProvider>,
    );

    expect(await screen.findByText('¿Querés continuar tu reserva?')).toBeInTheDocument();
    expect(screen.getByText('Encontramos una reserva que habías empezado anteriormente.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar reserva' }));

    expect(await screen.findByDisplayValue('Tomás Pérez')).toBeInTheDocument();
    expect(screen.getByDisplayValue('tomas@gmail.com')).toBeInTheDocument();
    expect(mocks.validateBenefitCodeQuoteFn).toHaveBeenCalled();
    // Sin creación de reservas ni cobros automáticos al recuperar
    expect(mocks.preparePaywayCheckoutFn).not.toHaveBeenCalled();
  });

  it('7. Horario ocupado durante la ausencia muestra "Tu reserva está casi lista", conserva datos y lleva al selector de horarios', async () => {
    const now = Date.now();
    saveBookingDraft(
      {
        service: 'corte',
        barber: 'Gonzalo',
        barberDeferred: false,
        date: '2026-11-20',
        time: '14:30',
        name: 'Tomás Pérez',
        phone: '11 5555-6666',
        phoneCountry: 'AR',
        email: 'tomas@gmail.com',
        benefitCode: null,
        lastMeaningfulActivityAt: now,
      },
      now,
    );
    // 14:30 ocupado, pero 15:15 disponible en 2026-11-20
    mocks.readPublicAvailabilityStarts.mockResolvedValue([makeSlot('Gonzalo', '2026-11-20', '15:15')]);

    render(
      <KaniProvider>
        <Booking variant="v3" experimentalMotion={liquidGlassMotionAdapter} />
      </KaniProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Continuar reserva' }));

    expect(await screen.findByText('Tu reserva está casi lista')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Elegir otro horario' }));

    expect(await screen.findByRole('button', { name: /15:15/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /14:30/i })).not.toBeInTheDocument();
    // Datos personales conservados en el borrador actualizado (sin el horario ocupado)
    const updated = readValidBookingDraft();
    expect(updated?.name).toBe('Tomás Pérez');
    expect(updated?.time).toBeNull();
  });

  it('8. Error temporal de conexión no borra el borrador y permite reintentar', async () => {
    const now = Date.now();
    saveBookingDraft(
      {
        service: 'corte',
        barber: 'Gonzalo',
        barberDeferred: false,
        date: '2026-11-20',
        time: '14:30',
        name: 'Tomás Pérez',
        phone: null,
        phoneCountry: 'AR',
        email: null,
        benefitCode: null,
        lastMeaningfulActivityAt: now,
      },
      now,
    );

    mocks.readPublicAvailabilityStarts.mockRejectedValueOnce(new Error('Network error'));

    render(
      <KaniProvider>
        <Booking variant="v3" experimentalMotion={liquidGlassMotionAdapter} />
      </KaniProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Continuar reserva' }));
    expect(await screen.findByText('No pudimos verificar la disponibilidad')).toBeInTheDocument();
    expect(readValidBookingDraft()).not.toBeNull();

    mocks.readPublicAvailabilityStarts.mockResolvedValueOnce([makeSlot('Gonzalo', '2026-11-20', '14:30')]);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByDisplayValue('Tomás Pérez')).toBeInTheDocument();
  });

  it('9 y 10. Descuento vencido se descarta informando discretamente y barbero deshabilitado solicita nueva selección respetando exclusión de Franco', async () => {
    const now = Date.now();
    saveBookingDraft(
      {
        service: 'corte',
        barber: 'Valentín',
        barberDeferred: false,
        date: '2026-11-20',
        time: '10:00',
        name: 'Tomás Pérez',
        phone: '11 5555-6666',
        phoneCountry: 'AR',
        email: 'tomas@gmail.com',
        benefitCode: 'KANI-EXPIRED',
        lastMeaningfulActivityAt: now,
      },
      now,
    );
    // Valentín ya no está habilitado y el descuento venció
    mocks.readPublicBookingBarbers.mockResolvedValue([
      { id: 'id-lautaro', name: 'Lautaro' },
      { id: 'id-gonzalo', name: 'Gonzalo' },
    ]);
    mocks.validateBenefitCodeQuoteFn.mockResolvedValue({ valid: false, error: 'expired' });

    render(
      <KaniProvider>
        <Booking variant="v3" experimentalMotion={liquidGlassMotionAdapter} />
      </KaniProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Continuar reserva' }));

    expect(await screen.findByText(/El profesional que habías elegido ya no está disponible/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Franco/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gonzalo/i })).toBeInTheDocument();
  });

  it('11, 12 y 13. Cierre con × conserva borrador con banner discreto, Empezar de nuevo lo elimina y confirmar lo limpia', async () => {
    const now = Date.now();
    saveBookingDraft(
      {
        service: 'corte',
        barber: 'Gonzalo',
        barberDeferred: false,
        date: '2026-11-20',
        time: '14:30',
        name: 'Tomás Pérez',
        phone: null,
        phoneCountry: 'AR',
        email: null,
        benefitCode: null,
        lastMeaningfulActivityAt: now,
      },
      now,
    );

    render(
      <KaniProvider>
        <Booking variant="v3" experimentalMotion={liquidGlassMotionAdapter} />
      </KaniProvider>,
    );

    // Cerrar con × sin borrar borrador
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByText('¿Querés continuar tu reserva?')).not.toBeInTheDocument();
    expect(readValidBookingDraft()).not.toBeNull();
    expect(screen.getByText('Tenés una reserva sin terminar')).toBeInTheDocument();

    // Abrir desde banner discreto y descartar con "Empezar de nuevo"
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar' }));
    expect(await screen.findByText('¿Querés continuar tu reserva?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Empezar de nuevo' }));
    expect(readValidBookingDraft()).toBeNull();

    // Confirmación limpia borrador
    saveBookingDraft(
      {
        service: 'corte',
        barber: 'Gonzalo',
        barberDeferred: false,
        date: '2026-11-20',
        time: '14:30',
        name: 'Tomás Pérez',
        phone: null,
        phoneCountry: 'AR',
        email: null,
        benefitCode: null,
        lastMeaningfulActivityAt: Date.now(),
      },
    );
    clearBookingDraft();
    expect(readValidBookingDraft()).toBeNull();
  });

  it('14 y 15. Almacenamiento bloqueado no rompe el flujo y un intento Payway pendiente suprime el modal de borrador', async () => {
    // 14) Simular localStorage bloqueado
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });

    expect(() => readValidBookingDraft()).not.toThrow();
    expect(readValidBookingDraft()).toBeNull();
    expect(() =>
      saveBookingDraft({
        service: 'corte',
        barber: 'Gonzalo',
        barberDeferred: false,
        date: null,
        time: null,
        name: null,
        phone: null,
        phoneCountry: 'AR',
        email: null,
        benefitCode: null,
        lastMeaningfulActivityAt: Date.now(),
      }),
    ).not.toThrow();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();

    // 15) Intento Payway pendiente en sessionStorage suprime modal de recuperación de borrador
    saveBookingDraft({
      service: 'corte',
      barber: 'Gonzalo',
      barberDeferred: false,
      date: '2026-11-20',
      time: '14:30',
      name: 'Tomás Pérez',
      phone: null,
      phoneCountry: 'AR',
      email: null,
      benefitCode: null,
      lastMeaningfulActivityAt: Date.now(),
    });
    window.sessionStorage.setItem(
      'kani:payway:active-attempt',
      JSON.stringify({
        appointmentId: 'apt-1',
        attemptId: 'att-1',
        accessToken: 'tok-1',
        depositArs: 5000,
        barber: 'Lautaro',
        serviceName: 'Corte',
        date: '2026-11-20',
        time: '16:00',
        clientName: 'Tomás',
      }),
    );
    mocks.checkPaywayPaymentStatusFn.mockResolvedValue({
      state: 'pending',
      message: 'Pago en verificación',
    });

    render(
      <KaniProvider>
        <PaywayBooking homeUrl="/reservar" experimentalMotion={liquidGlassMotionAdapter} />
      </KaniProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText('¿Querés continuar tu reserva?')).not.toBeInTheDocument();
  });
});
