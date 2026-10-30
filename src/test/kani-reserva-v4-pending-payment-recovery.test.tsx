import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PAYWAY_MESSAGES } from '@/lib/kani-payway';
import { dateLabel } from '@/lib/kani-model';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  pay: vi.fn(),
  checkStatus: vi.fn(),
  tokenize: vi.fn(),
  mp: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@/components/kani/store', () => ({
  useKani: () => ({ mobileMenuOpen: false, setMobileMenuOpen: vi.fn() }),
}));

vi.mock('@/lib/kani-availability', async original => ({
  ...await original<typeof import('@/lib/kani-availability')>(),
  readConfiguredServices: async () => [],
  readPublicAvailabilityStarts: async () => ['10:00', '11:30'].map(start_time => ({
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

vi.mock('@/lib/kani-down-payment', () => ({
  getDynamicDownPayment: async () => 5000,
}));

vi.mock('@/lib/kani-mercadopago.functions', () => ({
  createBookingOrderFn: mocks.mp,
}));

vi.mock('@/lib/kani-payway.functions', () => ({
  preparePaywayCheckoutFn: (args: unknown) => mocks.prepare(args),
  payPaywayDepositFn: (args: unknown) => mocks.pay(args),
  checkPaywayPaymentStatusFn: (args: unknown) => mocks.checkStatus(args),
}));

vi.mock('@/lib/kani-payway.browser', () => ({
  tokenizePaywayForm: (...args: unknown[]) => mocks.tokenize(...args),
}));

import { PaywayBooking } from '@/components/kani/experimental/payway-booking';

const standardCheckout = {
  appointmentId: '11111111-1111-4111-8111-111111111111',
  attemptId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  accessToken: 'valid_access_token_32_characters_ok',
  depositArs: 5000,
  publicKey: 'pk_test_123',
  apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2',
  methods: [{ id: 1, label: 'Visa' }],
};

function next() {
  fireEvent.click(screen.getByRole('button', { name: 'Continuar', hidden: false }));
}

async function reachDataStep() {
  render(<PaywayBooking />);
  fireEvent.click(screen.getByRole('button', { name: /^Corte,/ }));
  next();
  fireEvent.click(screen.getByRole('button', { name: /Lautaro/ }));
  next();
  fireEvent.click(await screen.findByRole('button', { name: dateLabel('2026-10-27') }));
  next();
  await screen.findByRole('button', { name: /10:00/ });
  fireEvent.click(screen.getByRole('button', { name: /10:00/ }));
  next();
  await screen.findByRole('textbox', { name: /^Nombre/ });
  fireEvent.change(screen.getByRole('textbox', { name: /^Nombre/ }), { target: { value: 'Cliente Prueba' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^Email/ }), { target: { value: 'cliente@test.com' } });
  fireEvent.change(screen.getByPlaceholderText('11 2345-6789'), { target: { value: '1123456789' } });
}

async function fillAndSubmitCard() {
  await waitFor(() => expect(screen.getByRole('heading', { name: /Pagá la seña a Kani con Payway/i })).toBeInTheDocument());
  const panInput = screen.getByRole('textbox', { name: 'Número de tarjeta' });
  fireEvent.change(panInput, { target: { value: '4507990000004905' } });
  fireEvent.change(screen.getByLabelText('Mes de vencimiento'), { target: { value: '12' } });
  fireEvent.change(screen.getByLabelText('Año de vencimiento'), { target: { value: '29' } });
  fireEvent.change(screen.getByLabelText(/Código de seguridad/), { target: { value: '123' } });
  fireEvent.change(screen.getByRole('textbox', { name: /Titular/ }), { target: { value: 'Titular Prueba' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'DNI del titular' }), { target: { value: '40123456' } });
  fireEvent.submit(panInput.closest('form')!);
}

describe('Payway V4 - Pending payment recovery and persistent verification UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState(null, '');
    Element.prototype.scrollTo = vi.fn();
    window.scrollTo = vi.fn();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    mocks.tokenize.mockResolvedValue({ token: 'fixture-token', bin: '450799' });
    mocks.prepare.mockResolvedValue({ ready: true, checkout: standardCheckout });
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  it('1. Pago incierto -> termina espera -> cerrar modal -> muestra aviso persistente "Pago en verificación" y botón "Ver estado del pago"', async () => {
    mocks.pay.mockResolvedValueOnce({ state: 'unknown', message: PAYWAY_MESSAGES.verifying });
    mocks.checkStatus.mockResolvedValue({ state: 'verifying', message: PAYWAY_MESSAGES.verifying });

    await reachDataStep();
    fireEvent.click(screen.getByRole('button', { name: /Pagar seña/i }));
    await fillAndSubmitCard();

    // Waiting message appears
    expect(await screen.findByText('Estamos verificando tu pago', { exact: true })).toBeInTheDocument();

    // Close modal via "Cerrar" button
    const closeBtn = screen.getByRole('button', { name: 'Cerrar' });
    fireEvent.click(closeBtn);

    // Modal is closed, but in Step Datos:
    // 1. Persistent notice "Pago en verificación" is visible
    expect(screen.getByText('Pago en verificación')).toBeInTheDocument();
    // 2. Action button is replaced with "Ver estado del pago"
    expect(screen.getByRole('button', { name: 'Ver estado del pago' })).toBeInTheDocument();
    // 3. "Pagar seña" is NOT present
    expect(screen.queryByRole('button', { name: 'Pagar seña' })).not.toBeInTheDocument();
  }, 20000);

  it('2. Pulsar "Ver estado del pago" abre el seguimiento existente sin iniciar otro cobro ni llamada adicional', async () => {
    mocks.pay.mockResolvedValueOnce({ state: 'unknown', message: PAYWAY_MESSAGES.verifying });
    mocks.checkStatus.mockResolvedValue({ state: 'verifying', message: PAYWAY_MESSAGES.verifying });

    await reachDataStep();
    fireEvent.click(screen.getByRole('button', { name: /Pagar seña/i }));
    await fillAndSubmitCard();

    expect(await screen.findByText('Estamos verificando tu pago', { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    // Initial pay call count
    expect(mocks.pay).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);

    // Click "Ver estado del pago"
    fireEvent.click(screen.getByRole('button', { name: 'Ver estado del pago' }));

    // Modal re-opens in tracking mode directly
    expect(await screen.findByText('Estamos verificando tu pago', { exact: true })).toBeInTheDocument();
    // Card form is NOT rendered
    expect(screen.queryByRole('textbox', { name: 'Número de tarjeta' })).not.toBeInTheDocument();

    // NO new prepare or pay calls were made
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.pay).toHaveBeenCalledTimes(1);
  }, 20000);

  it('3. Recargar la página recupera el estado desde almacenamiento con aviso y comprobación sin habilitar pago temporalmente', async () => {
    // Pre-populate active attempt in sessionStorage as if user reloaded
    window.sessionStorage.setItem(
      'kani:payway:active-attempt',
      JSON.stringify({
        appointmentId: standardCheckout.appointmentId,
        attemptId: standardCheckout.attemptId,
        accessToken: standardCheckout.accessToken,
        depositArs: 5000,
        barber: 'Lautaro',
        serviceName: 'Corte',
        date: '2026-10-30',
        time: '16:45',
        clientName: 'Cliente Recargado',
      })
    );

    mocks.checkStatus.mockResolvedValueOnce({ state: 'verifying', message: PAYWAY_MESSAGES.verifying });

    render(<PaywayBooking />);

    // Query is fired on mount
    await waitFor(() => {
      expect(mocks.checkStatus).toHaveBeenCalledWith({
        data: {
          appointmentId: standardCheckout.appointmentId,
          attemptId: standardCheckout.attemptId,
          accessToken: standardCheckout.accessToken,
        },
      });
    });

    // Verification state is restored
    expect(screen.getByText('Pago en verificación')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver estado del pago' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pagar seña' })).not.toBeInTheDocument();
  }, 20000);

  it('4. Aprobación confirmada recuperada en recarga transiciona inmediatamente a "Turno confirmado"', async () => {
    window.sessionStorage.setItem(
      'kani:payway:active-attempt',
      JSON.stringify({
        appointmentId: standardCheckout.appointmentId,
        attemptId: standardCheckout.attemptId,
        accessToken: standardCheckout.accessToken,
        depositArs: 5000,
        barber: 'Lautaro',
        serviceName: 'Corte',
        date: '2026-10-30',
        time: '16:45',
        clientName: 'Cliente Aprobado',
      })
    );

    mocks.checkStatus.mockResolvedValueOnce({
      state: 'approved',
      message: PAYWAY_MESSAGES.approved,
      appointmentConfirmed: true,
    });

    render(<PaywayBooking />);

    expect(await screen.findByRole('heading', { name: 'Turno confirmado' })).toBeInTheDocument();
    expect(screen.getByText('Te enviamos la confirmación por mail.')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('kani:payway:active-attempt')).toBeNull();
  }, 20000);

  it('5. Rechazo confirmado en consulta limpia el intento y permite reintentar el pago', async () => {
    window.sessionStorage.setItem(
      'kani:payway:active-attempt',
      JSON.stringify({
        appointmentId: standardCheckout.appointmentId,
        attemptId: standardCheckout.attemptId,
        accessToken: standardCheckout.accessToken,
        depositArs: 5000,
      })
    );

    mocks.checkStatus.mockResolvedValueOnce({
      state: 'rejected',
      message: PAYWAY_MESSAGES.rejected,
    });

    render(<PaywayBooking />);

    await waitFor(() => {
      expect(window.sessionStorage.getItem('kani:payway:active-attempt')).toBeNull();
    });
  }, 20000);

  it('6. Pago en revisión administrativa muestra aviso de revisión y bloquea pagos adicionales', async () => {
    window.sessionStorage.setItem(
      'kani:payway:active-attempt',
      JSON.stringify({
        appointmentId: standardCheckout.appointmentId,
        attemptId: standardCheckout.attemptId,
        accessToken: standardCheckout.accessToken,
        depositArs: 5000,
      })
    );

    mocks.checkStatus.mockResolvedValueOnce({
      state: 'review',
      message: PAYWAY_MESSAGES.late_review,
    });

    render(<PaywayBooking />);

    expect(await screen.findByText('Pago registrado en revisión')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pagar seña' })).not.toBeInTheDocument();
  }, 20000);
});
