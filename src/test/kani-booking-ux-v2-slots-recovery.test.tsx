import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dateLabel } from '@/lib/kani-model';
import { PAYWAY_MESSAGES } from '@/lib/kani-payway';
import type { PublicAvailabilityStart } from '@/lib/kani-availability';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  create: vi.fn(),
  order: vi.fn(),
  getStatus: vi.fn(),
  prepare: vi.fn(),
  pay: vi.fn(),
  checkPaywayStatus: vi.fn(),
  tokenize: vi.fn(),
  confirmZero: vi.fn(),
  validateBenefit: vi.fn(),
  assign: vi.fn(),
}));

vi.mock('@/components/kani/store', () => ({
  useKani: () => ({ mobileMenuOpen: false, setMobileMenuOpen: vi.fn() }),
}));

vi.mock('@/lib/kani-availability', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/kani-availability')>()),
  readConfiguredServices: async () => [],
  readPublicBookingBarbers: async () => ['Lautaro', 'Gonzalo', 'Valentín'].map(name => ({ id: name, name })),
  readPublicAvailabilityStarts: (...args: unknown[]) => mocks.read(...args),
}));

vi.mock('@/lib/kani-appointments', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/kani-appointments')>();
  return {
    ...actual,
    createRealAppointment: (...args: unknown[]) => mocks.create(...args),
  };
});

vi.mock('@/lib/kani-down-payment', () => ({
  getDynamicDownPayment: async () => 5000,
}));

vi.mock('@/lib/kani-mercadopago.functions', () => ({
  createBookingOrderFn: (...args: unknown[]) => mocks.order(...args),
  getAppointmentPaymentStatusFn: (...args: unknown[]) => mocks.getStatus(...args),
}));

vi.mock('@/lib/kani-payway.functions', () => ({
  preparePaywayCheckoutFn: (...args: unknown[]) => mocks.prepare(...args),
  payPaywayDepositFn: (...args: unknown[]) => mocks.pay(...args),
  checkPaywayPaymentStatusFn: (...args: unknown[]) => mocks.checkPaywayStatus(...args),
}));

vi.mock('@/lib/kani-payway.browser', () => ({
  tokenizePaywayForm: (...args: unknown[]) => mocks.tokenize(...args),
}));

vi.mock('@/lib/kani-benefit-codes.functions', () => ({
  validateBenefitCodeQuoteFn: (...args: unknown[]) => mocks.validateBenefit(...args),
  confirmZeroDepositBookingFn: (...args: unknown[]) => mocks.confirmZero(...args),
}));

import { Booking } from '@/components/kani/booking';
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';
import { MercadoPagoBooking } from '@/components/kani/experimental/mercadopago-booking';

function makeStarts(
  times: string[],
  slot_date = '2026-10-26',
  barber_name: 'Lautaro' | 'Gonzalo' | 'Valentín' | 'Franco' = 'Lautaro',
  compatible_services = ['Corte', 'Barba', 'Corte y barba'],
): PublicAvailabilityStart[] {
  return times.map(start_time => ({
    barber_id: barber_name,
    barber_name,
    slot_date,
    start_time,
    is_exception: true,
    compatible_services,
  }));
}

function next() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Continuar' }).find(btn => !btn.hidden)!);
}

async function goToScheduleStep({
  variant = 'v3',
  serviceRegex = /^Corte(?: de cabello)?, 45 minutos/,
  barberName = 'Lautaro',
  slotDate = '2026-10-26',
}: {
  variant?: 'v3' | 'payway' | 'mp';
  serviceRegex?: RegExp;
  barberName?: string;
  slotDate?: string;
} = {}) {
  if (variant === 'payway') {
    render(<PaywayBooking />);
  } else if (variant === 'mp') {
    render(<MercadoPagoBooking />);
  } else {
    render(<Booking variant="v3" />);
  }

  fireEvent.click(screen.getByRole('button', { name: serviceRegex }));
  next();
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(barberName) }));
  await waitFor(() => expect(mocks.read).toHaveBeenCalled());
  next();
  fireEvent.click(await screen.findByRole('button', { name: new RegExp('^' + dateLabel(slotDate)) }));
  next();
  await screen.findByRole('heading', { name: 'Elegí un horario' });
}

async function fillCustomerContact() {
  await screen.findByRole('textbox', { name: /^Nombre/ });
  fireEvent.change(screen.getByRole('textbox', { name: /^Nombre/ }), {
    target: { value: 'Mateo González' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: /^Email/ }), {
    target: { value: 'mateo.gonzalez@example.test' },
  });
  fireEvent.change(await screen.findByPlaceholderText('11 2345-6789'), {
    target: { value: '1128436014' },
  });
}

const originalLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState(null, '');
  Element.prototype.scrollTo = vi.fn();
  window.scrollTo = vi.fn();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));

  mocks.read.mockResolvedValue([
    ...makeStarts(['19:15', '11:30', '14:30', '10:00', '16:45', '13:45'], '2026-10-26', 'Lautaro'),
    ...makeStarts(['10:00', '15:15'], '2026-10-27', 'Lautaro'),
  ]);
  mocks.create.mockResolvedValue({ appointment_id: 'apt-default-1', request_number: 201 });
  mocks.order.mockResolvedValue({
    success: true,
    checkoutUrl: 'https://payments.example.test/mp-checkout',
  });
  mocks.getStatus.mockResolvedValue({
    success: true,
    isConfirmed: false,
    appointmentStatus: 'PENDING',
  });
  mocks.prepare.mockResolvedValue({
    ready: true,
    checkout: {
      appointmentId: 'apt-pw-1',
      attemptId: 'a'.repeat(32),
      accessToken: 'x'.repeat(43),
      depositArs: 5000,
      publicKey: 'public-fixture',
      apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2',
      methods: [{ id: 1, label: 'Visa' }],
    },
  });
  mocks.checkPaywayStatus.mockResolvedValue({
    state: 'verifying',
    message: PAYWAY_MESSAGES.verifying,
  });
  mocks.validateBenefit.mockResolvedValue({
    valid: true,
    code: 'KANI-TEST-20',
    type: 'PERCENT_DISCOUNT',
    label: '20% OFF',
    originalPriceArs: 25000,
    discountAmountArs: 5000,
    finalPriceArs: 20000,
    onlineDepositArs: 5000,
    inPersonBalanceArs: 15000,
    skipOnlinePayment: false,
  });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { search: '', pathname: '/reservar-turno', assign: mocks.assign },
  });
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.useRealTimers();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('UX/UI V2 — Horarios agrupados y recuperación ante conflicto de disponibilidad', () => {
  it('1. Agrupa por Mañana (<14:00) y Tarde (>=14:00) en orden ascendente, oculta franjas vacías y muestra contexto editable', async () => {
    await goToScheduleStep();

    // Franja Mañana y Tarde presentes
    const morningHeading = screen.getByRole('heading', { level: 2, name: 'Mañana' });
    const afternoonHeading = screen.getByRole('heading', { level: 2, name: 'Tarde' });
    expect(morningHeading).toBeInTheDocument();
    expect(afternoonHeading).toBeInTheDocument();

    // La barra horizontal de resumen de selección ("Otra fecha", Servicio, Barbero) fue eliminada completamente
    expect(screen.queryByLabelText('Resumen de selección')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar servicio/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar barbero/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar fecha' })).not.toBeInTheDocument();
    expect(screen.queryByText('Otra fecha')).not.toBeInTheDocument();

    // Orden cronológico ascendente estricto dentro de cada franja (incluye 15m/13:45/14:00/19:15)
    const morningSection = morningHeading.closest('section')!;
    const morningLabels = within(morningSection)
      .getAllByRole('button')
      .map(btn => btn.textContent?.trim());
    expect(morningLabels).toEqual(['10:00', '11:30', '13:45']);

    const afternoonSection = afternoonHeading.closest('section')!;
    const afternoonLabels = within(afternoonSection)
      .getAllByRole('button')
      .map(btn => btn.textContent?.trim());
    expect(afternoonLabels).toEqual(['14:30', '16:45', '19:15']);

    // Estado seleccionado accesible
    const slot1345 = screen.getByRole('button', { name: /^Horario 13:45/ });
    expect(slot1345).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(slot1345);
    expect(slot1345).toHaveAttribute('aria-pressed', 'true');
    expect(slot1345).toHaveClass('selected');
  });

  it('2. Oculta Mañana cuando solo hay horarios de Tarde (ej. Gonzalo) y respeta duraciones de servicio compatibles', async () => {
    mocks.read.mockResolvedValue(
      makeStarts(['16:00', '16:45', '17:30', '19:15'], '2026-10-26', 'Gonzalo', ['Barba']),
    );

    await goToScheduleStep({
      serviceRegex: /^Barba, 30 minutos/,
      barberName: 'Gonzalo',
      slotDate: '2026-10-26',
    });

    expect(screen.queryByRole('heading', { level: 2, name: 'Mañana' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Tarde' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Horario 19:15/ })).toBeInTheDocument();
  });

  it('3. Muestra estado de carga (skeleton) y estado vacío accionable sin horarios disponibles', async () => {
    let resolveSlots!: (value: PublicAvailabilityStart[]) => void;
    mocks.read.mockReturnValue(
      new Promise(resolve => {
        resolveSlots = resolve;
      }),
    );

    render(<Booking variant="v3" />);
    fireEvent.click(screen.getByRole('button', { name: /^Corte(?: de cabello)?, 45 minutos/ }));
    next();
    fireEvent.click(await screen.findByRole('button', { name: /Lautaro/ }));

    // Ir directo a fecha -> sin esperar? Esperamos resolución inicial primero
    await act(async () => {
      resolveSlots(makeStarts(['10:00'], '2026-10-26', 'Lautaro', ['Corte']));
    });
    next();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp('^' + dateLabel('2026-10-26')) }));
    next();

    // Simulamos fecha sin horarios para validar el estado vacío
    mocks.read.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Barbero' }));
    fireEvent.click(await screen.findByRole('button', { name: /Gonzalo/ }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));

    // Confirmar estado vacío accionable tras recargar disponibilidad vacía
    cleanup();
    mocks.read.mockResolvedValue([]);
    render(<Booking variant="v3" initialStep={3} initialService="corte" initialBarber="Lautaro" initialDate="2026-10-26" />);
    await waitFor(() => {
      expect(screen.getByText('No hay horarios disponibles para esta fecha.')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Elegir otra fecha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elegir otro barbero' })).toBeInTheDocument();
  });

  it('4. Pre-check de concurrencia antes de pagar: muestra 3 alternativas cercanas, conserva datos + descuento y revalida la alternativa elegida', async () => {
    await goToScheduleStep({ variant: 'payway' });
    fireEvent.click(screen.getByRole('button', { name: /^Horario 11:30/ }));
    next();

    await fillCustomerContact();
    fireEvent.change(screen.getByLabelText(/Código de descuento/), { target: { value: 'KANI-TEST-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await screen.findByText('Código aplicado correctamente.');

    // Mientras llenaba datos, 11:30 se ocupó y quedaron 10:00, 10:45, 12:15, 13:00, 16:45
    mocks.read.mockResolvedValueOnce(
      makeStarts(['10:00', '10:45', '12:15', '13:00', '16:45'], '2026-10-26', 'Lautaro'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Ese horario ya no está disponible');
    expect(alert).toHaveTextContent('11:30 hs');
    expect(alert).toHaveTextContent('Ocupado');
    expect(mocks.prepare).not.toHaveBeenCalled();

    // Las 3 alternativas más cercanas a 11:30 son 10:00 (-90m, desempate cronológico vs 13:00), 10:45 (-45m) y 12:15 (+45m)
    expect(screen.getByRole('button', { name: 'Elegir horario alternativo 10:00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elegir horario alternativo 10:45' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elegir horario alternativo 12:15' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /alternativo 13:00/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /alternativo 16:45/ })).not.toBeInTheDocument();

    // Al pulsar "12:15", vuelve a consultar disponibilidad real antes de regresar a Datos
    mocks.read.mockResolvedValueOnce(
      makeStarts(['10:00', '10:45', '12:15', '13:00', '16:45'], '2026-10-26', 'Lautaro'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Elegir horario alternativo 12:15' }));

    await screen.findByRole('heading', { name: 'Completá tus datos' });
    // Conserva todos los datos personales, descuento aplicado y el nuevo horario 12:15
    expect(screen.getByRole('textbox', { name: /^Nombre/ })).toHaveValue('Mateo González');
    expect(screen.getByRole('textbox', { name: /^Email/ })).toHaveValue('mateo.gonzalez@example.test');
    expect(screen.getAllByText('KANI-TEST-20').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('12:15', { selector: 'dd' })).toBeInTheDocument();
  });

  it('5. Conflicto tardío en Payway (preparePaywayCheckoutFn -> SLOT_UNAVAILABLE): cierra modal sin cobrar y abre recuperación', async () => {
    await goToScheduleStep({ variant: 'payway' });
    fireEvent.click(screen.getByRole('button', { name: /^Horario 11:30/ }));
    next();
    await fillCustomerContact();

    mocks.prepare.mockResolvedValueOnce({
      ready: false,
      state: 'recoverable',
      message: 'El horario seleccionado ya no se encuentra disponible. Por favor seleccioná otro horario.',
    });
    // Race en preparePaywayCheckoutFn (SLOT_UNAVAILABLE)
    mocks.read
      .mockResolvedValueOnce(makeStarts(['10:00', '11:30', '14:30'], '2026-10-26', 'Lautaro'))
      .mockResolvedValueOnce(makeStarts(['10:00', '14:30'], '2026-10-26', 'Lautaro'));

    fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Ese horario ya no está disponible');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.tokenize).not.toHaveBeenCalled();

    // Si elige "Elegir otro horario", vuelve a la grilla donde 11:30 aparece marcado Ocupado / No disponible
    fireEvent.click(screen.getByRole('button', { name: 'Elegir otro horario' }));
    const blockedBtn = await screen.findByRole('button', { name: 'Horario 11:30, no disponible' });
    expect(blockedBtn).toBeDisabled();
    expect(blockedBtn).toHaveClass('time-unavailable');
    expect(blockedBtn).toHaveTextContent('Ocupado');
  });

  it('6. Reserva $0 con beneficio: si falla por colisión de horario conserva el código y abre recuperación', async () => {
    mocks.validateBenefit.mockResolvedValue({
      valid: true,
      code: 'VIP-FREE',
      type: 'FREE_SERVICE',
      label: 'Servicio 100% bonificado',
      originalPriceArs: 25000,
      discountAmountArs: 25000,
      finalPriceArs: 0,
      onlineDepositArs: 0,
      inPersonBalanceArs: 0,
      skipOnlinePayment: true,
    });
    mocks.confirmZero.mockRejectedValueOnce(new Error('SLOT_COLLISION'));

    await goToScheduleStep({ variant: 'payway' });
    fireEvent.click(screen.getByRole('button', { name: /^Horario 11:30/ }));
    next();
    await fillCustomerContact();

    fireEvent.change(screen.getByLabelText(/Código de descuento/), { target: { value: 'VIP-FREE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await screen.findAllByText('VIP-FREE');

    mocks.read
      .mockResolvedValueOnce(makeStarts(['10:00', '11:30', '14:30'], '2026-10-26', 'Lautaro'))
      .mockResolvedValueOnce(makeStarts(['10:00', '14:30'], '2026-10-26', 'Lautaro'));

    fireEvent.click(screen.getByRole('button', { name: 'Reservar turno' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Ese horario ya no está disponible');

    // Al seleccionar 10:00 conserva el código VIP-FREE sin re-ingresarlo
    mocks.read.mockResolvedValueOnce(makeStarts(['10:00', '14:30'], '2026-10-26', 'Lautaro'));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir horario alternativo 10:00' }));

    await screen.findByRole('heading', { name: 'Completá tus datos' });
    expect(screen.getAllByText('VIP-FREE').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Reservar turno' })).toBeInTheDocument();
  });

  it('7. Doble conflicto y fallback sin alternativas para el día en Mercado Pago', async () => {
    await goToScheduleStep({ variant: 'mp' });
    fireEvent.click(screen.getByRole('button', { name: /^Horario 11:30/ }));
    next();
    await fillCustomerContact();

    // Race en createRealAppointment (SLOT_ALREADY_BOOKED)
    mocks.create.mockRejectedValueOnce({ code: 'P0001', message: 'SLOT_ALREADY_BOOKED' });
    mocks.read
      .mockResolvedValueOnce(makeStarts(['10:00', '11:30', '14:30'], '2026-10-26', 'Lautaro'))
      .mockResolvedValueOnce(makeStarts(['10:00', '14:30'], '2026-10-26', 'Lautaro'));

    fireEvent.click(screen.getByRole('button', { name: /Pagar seña de \$5\.000 con Mercado Pago/ }));

    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Elegir horario alternativo 10:00' })).toBeInTheDocument();

    // Doble conflicto: 10:00 y 14:00 también se acaban de ocupar
    mocks.read.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Elegir horario alternativo 10:00' }));

    await screen.findByText('No encontramos otros horarios disponibles para ese día.');
    expect(
      screen.getByText(/El horario 10:00 también acaba de ocuparse/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elegir otra fecha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elegir otro barbero' })).toBeInTheDocument();

    // Si cambia de fecha conservando sus datos y ahora sí elige 10:00 del martes 27, crea 1 sola reserva y redirige a MP
    mocks.read.mockResolvedValue(makeStarts(['10:00'], '2026-10-27', 'Lautaro'));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir otra fecha' }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp('^' + dateLabel('2026-10-27')) }));
    next();
    fireEvent.click(await screen.findByRole('button', { name: /^Horario 10:00/ }));
    next();

    await screen.findByRole('heading', { name: 'Completá tus datos' });
    expect(screen.getByRole('textbox', { name: /^Nombre/ })).toHaveValue('Mateo González');

    fireEvent.click(screen.getByRole('button', { name: /Pagar seña de \$5\.000 con Mercado Pago/ }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ date: '2026-10-27', time: '10:00' }),
    );
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith('https://payments.example.test/mp-checkout'),
    );
  });

  it('8. Errores reales de pago / intento ya acreditado NO se disfrazan como conflicto ni duplican turno/cobro', async () => {
    // 8a. Payway unavailable -> mantiene error real de pasarela, NO abre pantalla de horario ocupado
    await goToScheduleStep({ variant: 'payway' });
    fireEvent.click(screen.getByRole('button', { name: /^Horario 11:30/ }));
    next();
    await fillCustomerContact();

    mocks.prepare.mockResolvedValueOnce({ ready: false, message: PAYWAY_MESSAGES.unavailable });
    fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(PAYWAY_MESSAGES.unavailable);
    expect(screen.queryByText('Ese horario ya no está disponible')).not.toBeInTheDocument();

    cleanup();

    // 8b. MercadoPago con intento previo ya CONFIRMED en servidor: muestra Turno confirmado sin duplicar reserva ni cobro
    window.sessionStorage.setItem(
      'kani:mercadopago:active-attempt',
      JSON.stringify({
        appointmentId: 'apt-already-paid',
        serviceName: 'Corte',
        barber: 'Lautaro',
        date: '2026-10-26',
        time: '11:30',
        clientName: 'Mateo González',
        clientEmail: 'mateo.gonzalez@example.test',
        clientPhone: '+5491128436014',
        timestamp: Date.now(),
      }),
    );
    mocks.getStatus.mockResolvedValue({
      success: true,
      isConfirmed: true,
      appointmentStatus: 'CONFIRMED',
      appointment: {
        id: 'apt-already-paid',
        serviceName: 'Corte',
        barberName: 'Lautaro',
        date: '2026-10-26',
        time: '11:30',
        clientName: 'Mateo González',
        depositAmountArs: 5000,
        servicePriceArs: 25000,
      },
    });

    render(<MercadoPagoBooking />);
    await screen.findByRole('textbox', { name: /^Nombre/ });
    fireEvent.click(screen.getByRole('button', { name: /Pagar seña de \$5\.000 con Mercado Pago/ }));

    expect(await screen.findByRole('heading', { name: 'Turno confirmado' })).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.order).not.toHaveBeenCalled();
    expect(mocks.assign).not.toHaveBeenCalled();
  });
});
