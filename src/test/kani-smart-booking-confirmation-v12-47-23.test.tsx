import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAYWAY_MESSAGES } from '@/lib/kani-payway';
import { dateLabel } from '@/lib/kani-model';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  pay: vi.fn(),
  checkStatus: vi.fn(),
  tokenize: vi.fn(),
  validateBenefit: vi.fn(),
  confirmZeroDeposit: vi.fn(),
  mp: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@/components/kani/store', () => ({
  useKani: () => ({ mobileMenuOpen: false, setMobileMenuOpen: vi.fn() }),
}));

vi.mock('@/lib/kani-availability', async (original) => ({
  ...(await original<typeof import('@/lib/kani-availability')>()),
  readPublicBookingBarbers: async () =>
    ['Lautaro', 'Gonzalo', 'Valentín'].map((name) => ({ id: name, name })),
  readConfiguredServices: async () => [],
  readPublicAvailabilityStarts: async () =>
    ['10:00', '11:30'].map((start_time) => ({
      barber_id: 'Lautaro',
      barber_name: 'Lautaro',
      slot_date: '2026-10-27',
      start_time,
      is_exception: false,
      compatible_services: ['Corte'],
    })),
}));

vi.mock('@/lib/kani-appointments', () => ({
  createRealAppointment: mocks.create,
  appointmentErrorMessage: String,
}));
vi.mock('@/lib/kani-down-payment', () => ({ getDynamicDownPayment: async () => 5000 }));
vi.mock('@/lib/kani-mercadopago.functions', () => ({ createBookingOrderFn: mocks.mp }));
vi.mock('@/lib/kani-payway.functions', () => ({
  preparePaywayCheckoutFn: mocks.prepare,
  payPaywayDepositFn: mocks.pay,
  checkPaywayPaymentStatusFn: mocks.checkStatus,
}));
vi.mock('@/lib/kani-payway.browser', () => ({ tokenizePaywayForm: mocks.tokenize }));
vi.mock('@/lib/kani-benefit-codes.functions', () => ({
  validateBenefitCodeQuoteFn: mocks.validateBenefit,
  confirmZeroDepositBookingFn: mocks.confirmZeroDeposit,
}));
vi.mock('@/lib/kani-booking-draft', async (original) => ({
  ...(await original<typeof import('@/lib/kani-booking-draft')>()),
  readBookingDraft: () => null,
  readValidBookingDraft: () => null,
}));

import { PaywayBooking } from '@/components/kani/experimental/payway-booking';

const checkout = {
  appointmentId: '123e4567-e89b-42d3-a456-426614174000',
  attemptId: 'a'.repeat(32),
  accessToken: 'x'.repeat(43),
  depositArs: 5000,
  publicKey: 'public-fixture',
  apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2',
  methods: [{ id: 1, label: 'Visa' }],
};

function next() {
  fireEvent.click(screen.getByRole('button', { name: 'Continuar', hidden: false }));
}

async function reachDataStep() {
  render(<PaywayBooking homeUrl="/reservar" />);
  fireEvent.click(screen.getByRole('button', { name: /^Corte,/ }));
  next();
  fireEvent.click(await screen.findByRole('button', { name: /Lautaro/ }));
  next();
  fireEvent.click(await screen.findByRole('button', { name: dateLabel('2026-10-27') }));
  next();
  await screen.findByRole('button', { name: /10:00/ });
  fireEvent.click(screen.getByRole('button', { name: /10:00/ }));
  next();
  await screen.findByRole('textbox', { name: /^Nombre/ });
  fireEvent.change(screen.getByRole('textbox', { name: /^Nombre/ }), {
    target: { value: 'Cliente Prueba' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: /^Email/ }), {
    target: { value: 'cliente@test.com' },
  });
  fireEvent.change(await screen.findByPlaceholderText('11 2345-6789'), {
    target: { value: '1128436014' },
  });
}

async function openAndFillCard() {
  await reachDataStep();
  fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));
  const pan = await screen.findByRole('textbox', { name: 'Número de tarjeta' });
  fireEvent.change(pan, { target: { value: '4507990000004905' } });
  fireEvent.change(screen.getByLabelText('Mes de vencimiento'), { target: { value: '12' } });
  fireEvent.change(screen.getByLabelText('Año de vencimiento'), { target: { value: '29' } });
  fireEvent.change(screen.getByLabelText(/Código de seguridad/), { target: { value: '123' } });
  fireEvent.change(screen.getByRole('textbox', { name: /Titular/ }), {
    target: { value: 'Titular Simulado' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'DNI del titular' }), {
    target: { value: '40123456' },
  });
  return pan.closest('form')!;
}

describe('V12.47.23 · Smart Booking Confirmation — Liquid Glass Processing Modal & Error Recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState(null, '');
    document.body.removeAttribute('data-payway-modal-open');
    Element.prototype.scrollTo = vi.fn();
    window.scrollTo = vi.fn();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    mocks.prepare.mockResolvedValue({ ready: true, checkout });
    mocks.tokenize.mockResolvedValue({ token: 'fixture-token', bin: '450799' });
    mocks.pay.mockResolvedValue({
      state: 'approved',
      message: PAYWAY_MESSAGES.approved,
      appointmentConfirmed: true,
    });
    mocks.checkStatus.mockResolvedValue({
      state: 'verifying',
      message: PAYWAY_MESSAGES.verifying,
    });
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    document.body.removeAttribute('data-payway-modal-open');
    vi.useRealTimers();
  });

  it('1 & 11 & 12. Confirmación rápida: muestra modal "Estamos confirmando tu turno", cierra automáticamente y limpia overlays/scroll-lock', async () => {
    const form = await openAndFillCard();
    let resolvePay!: (v: any) => void;
    mocks.pay.mockReturnValueOnce(
      new Promise((r) => {
        resolvePay = r;
      }),
    );

    fireEvent.submit(form);

    // Estado A inmediatamente visible con role="status" y aria-live="polite"
    const statusBox = await screen.findByRole('status');
    expect(statusBox).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Estamos confirmando tu turno')).toBeInTheDocument();
    expect(screen.getByText('Esto puede tardar unos segundos.')).toBeInTheDocument();
    expect(screen.getByText('Por favor, mantené esta página abierta.')).toBeInTheDocument();

    // Se resuelve exitosamente
    await act(async () => {
      resolvePay({ state: 'approved', message: PAYWAY_MESSAGES.approved, appointmentConfirmed: true });
    });

    // Modal se cierra inmediatamente y aparece ¡Turno confirmado! sin overlays residuales
    expect(await screen.findByRole('heading', { name: /Turno confirmado/i })).toBeInTheDocument();
    expect(screen.queryByText('Estamos confirmando tu turno')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.hasAttribute('data-payway-modal-open')).toBe(false);
  }, 15000);

  it('2. Confirmación lenta: transiciona a "Estamos verificando tu reserva" tras superar el umbral habitual', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    const form = await openAndFillCard();
    let resolvePay!: (v: any) => void;
    mocks.pay.mockReturnValueOnce(
      new Promise((r) => {
        resolvePay = r;
      }),
    );

    fireEvent.submit(form);
    expect(await screen.findByText('Estamos confirmando tu turno')).toBeInTheDocument();

    // Avanzar más allá del umbral real (4500ms) mientras sigue pendiente
    await act(async () => {
      vi.advanceTimersByTime(4600);
    });

    expect(screen.getByText('Estamos verificando tu reserva')).toBeInTheDocument();
    expect(screen.getByText('La confirmación está tardando más de lo habitual.')).toBeInTheDocument();
    expect(
      screen.getByText('Estamos comprobando el resultado para evitar reservas o cobros duplicados.'),
    ).toBeInTheDocument();

    await act(async () => {
      resolvePay({ state: 'approved', message: PAYWAY_MESSAGES.approved, appointmentConfirmed: true });
    });
    expect(await screen.findByRole('heading', { name: /Turno confirmado/i })).toBeInTheDocument();
  });

  it('3. Doble clic / envío duplicado: bloquea múltiples envíos mientras la operación está en curso', async () => {
    const form = await openAndFillCard();
    let resolveTokenize!: (v: any) => void;
    mocks.tokenize.mockReturnValueOnce(
      new Promise((r) => {
        resolveTokenize = r;
      }),
    );

    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(mocks.tokenize).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveTokenize({ token: 'fixture-token', bin: '450799' });
    });
    await waitFor(() => expect(mocks.pay).toHaveBeenCalledTimes(1));
  }, 15000);

  it('4 & 10. Error del servidor y recuperación interrumpida: muestra "No pudimos completar la confirmación", permite reintentar o volver preservando el borrador', async () => {
    mocks.prepare.mockResolvedValueOnce({
      ready: false,
      message: 'Servicio temporalmente no disponible.',
    });

    await reachDataStep();
    fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));

    const alertEl = await screen.findByRole('alert');
    expect(alertEl).toHaveTextContent('No pudimos completar la confirmación');
    expect(screen.getByText('Hubo un inconveniente al procesar tu reserva.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver a intentar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver a mi reserva' })).toBeInTheDocument();

    // Volver a mi reserva preserva todos los datos del paso 5
    fireEvent.click(screen.getByRole('button', { name: 'Volver a mi reserva' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: /^Nombre/ })).toHaveValue('Cliente Prueba');
    expect(screen.getByRole('textbox', { name: /^Email/ })).toHaveValue('cliente@test.com');

    // Reintentar prepara correctamente el checkout
    mocks.prepare.mockResolvedValueOnce({ ready: true, checkout });
    fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));
    expect(await screen.findByRole('textbox', { name: 'Número de tarjeta' })).toBeInTheDocument();
  });

  it('5. Pérdida de red antes del cobro: muestra recuperación sin crear cobros duplicados y permite reintentar', async () => {
    mocks.prepare.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await reachDataStep();
    fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos completar la confirmación');
    expect(screen.getByText(/Verificá tu conexión/i)).toBeInTheDocument();

    mocks.prepare.mockResolvedValueOnce({ ready: true, checkout });
    fireEvent.click(screen.getByRole('button', { name: 'Volver a intentar' }));
    expect(await screen.findByRole('textbox', { name: 'Número de tarjeta' })).toBeInTheDocument();
  });

  it('6 & 7 & 8. Timeout / pago pendiente / confirmación tardía: nunca ofrece nuevo pago y ofrece "Consultar el estado" hasta confirmar', async () => {
    const form = await openAndFillCard();
    mocks.pay.mockRejectedValueOnce(new Error('Request timed out'));

    fireEvent.submit(form);

    // Pasa a verificación prolongada segura
    expect(await screen.findByText('Estamos verificando tu reserva')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver a intentar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();

    const checkBtn = screen.getByRole('button', { name: 'Consultar el estado' });
    expect(checkBtn).toBeInTheDocument();

    // Confirmación tardía al consultar estado
    mocks.checkStatus.mockResolvedValueOnce({
      state: 'approved',
      message: PAYWAY_MESSAGES.approved,
      appointmentConfirmed: true,
    });
    fireEvent.click(checkBtn);

    expect(await screen.findByRole('heading', { name: /Turno confirmado/i })).toBeInTheDocument();
    expect(mocks.pay).toHaveBeenCalledTimes(1);
  });

  it('9. Retorno / recarga tras pago pendiente: recupera el intento activo desde sessionStorage sin permitir segundo pago', async () => {
    window.sessionStorage.setItem(
      'kani:payway:active-attempt',
      JSON.stringify({
        appointmentId: checkout.appointmentId,
        attemptId: checkout.attemptId,
        accessToken: checkout.accessToken,
        depositArs: 5000,
        barber: 'Lautaro',
        serviceName: 'Corte',
        date: '2026-10-27',
        time: '10:00',
        clientName: 'Cliente Prueba',
      }),
    );

    mocks.checkStatus.mockResolvedValueOnce({
      state: 'verifying',
      message: PAYWAY_MESSAGES.verifying,
    });

    render(<PaywayBooking homeUrl="/reservar" />);

    expect(await screen.findByText('Pago en verificación')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver estado del pago' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pagar seña' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ver estado del pago' }));
    expect(await screen.findByText('Estamos verificando tu reserva')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Consultar el estado' })).toBeInTheDocument();
  });

  it('Confirmación sin seña (código 100%): muestra modal Liquid Glass de procesamiento y recupera errores de red', async () => {
    mocks.validateBenefit.mockResolvedValueOnce({
      valid: true,
      code: 'VIP100',
      type: 'FREE_SERVICE',
      skipOnlinePayment: true,
      originalPriceArs: 25000,
      discountAmountArs: 25000,
      finalPriceArs: 0,
      onlineDepositArs: 0,
      inPersonBalanceArs: 0,
    });
    mocks.confirmZeroDeposit.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await reachDataStep();
    const codeInput = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX');
    fireEvent.change(codeInput, { target: { value: 'VIP100' } });
    fireEvent.click(screen.getByRole('button', { name: /Aplicar/i }));

    await screen.findByText(/Tu turno se confirma directamente/i);

    const confirmBtn = screen.getByRole('button', { name: 'Reservar turno' });
    fireEvent.click(confirmBtn);

    // Error de red recuperable en el modal
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos completar la confirmación');
    expect(screen.getByRole('button', { name: 'Volver a intentar' })).toBeInTheDocument();

    // Reintento exitoso
    mocks.confirmZeroDeposit.mockResolvedValueOnce({
      success: true,
      appointmentId: 'zero-appt-1',
      calculation: {
        benefitType: 'FREE_SERVICE',
        code: 'VIP100',
        originalPriceArs: 25000,
        discountAmountArs: 25000,
        finalPriceArs: 0,
        onlineDepositArs: 0,
        inPersonBalanceArs: 0,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Volver a intentar' }));
    expect(await screen.findByRole('heading', { name: /Turno confirmado/i })).toBeInTheDocument();
    expect(document.body.hasAttribute('data-payway-modal-open')).toBe(false);
  });
});
