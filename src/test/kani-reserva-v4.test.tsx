import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAYWAY_MESSAGES } from '@/lib/kani-payway';
import { dateLabel } from '@/lib/kani-model';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), pay: vi.fn(), tokenize: vi.fn(), mp: vi.fn(), create: vi.fn() }));
vi.mock('@/components/kani/store', () => ({ useKani: () => ({ mobileMenuOpen: false, setMobileMenuOpen: vi.fn() }) }));
vi.mock('@/lib/kani-availability', async original => ({ ...await original<typeof import('@/lib/kani-availability')>(),
  readConfiguredServices: async () => [], readPublicAvailabilityStarts: async () => ['10:00', '11:30'].map(start_time => ({
    barber_id: 'Lautaro', barber_name: 'Lautaro', slot_date: '2026-10-27', start_time, is_exception: false,
    compatible_services: ['Corte'],
  })),
}));
vi.mock('@/lib/kani-appointments', () => ({ createRealAppointment: mocks.create, appointmentErrorMessage: String }));
vi.mock('@/lib/kani-down-payment', () => ({ getDynamicDownPayment: async () => 5000 }));
vi.mock('@/lib/kani-mercadopago.functions', () => ({ createBookingOrderFn: mocks.mp }));
vi.mock('@/lib/kani-payway.functions', () => ({ preparePaywayCheckoutFn: mocks.prepare, payPaywayDepositFn: mocks.pay }));
vi.mock('@/lib/kani-payway.browser', () => ({ tokenizePaywayForm: mocks.tokenize }));
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';

const checkout = { appointmentId: '123e4567-e89b-42d3-a456-426614174000', attemptId: 'a'.repeat(32), accessToken: 'x'.repeat(43), depositArs: 5000,
  publicKey: 'public-fixture', apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2', methods: [{ id: 1, label: 'Visa' }] };
function next() { fireEvent.click(screen.getByRole('button', { name: 'Continuar', hidden: false })); }
async function reachData() {
  render(<PaywayBooking />);
  fireEvent.click(screen.getByRole('button', { name: /^Corte 45/ })); next();
  fireEvent.click(screen.getByRole('button', { name: /Lautaro/ })); next();
  fireEvent.click(await screen.findByRole('button', { name: dateLabel('2026-10-27') })); next();
  await screen.findByRole('button', { name: '10:00' });
  fireEvent.click(screen.getByRole('button', { name: '10:00' })); next();
  await screen.findByRole('textbox', { name: /^Nombre/ });
  fireEvent.change(screen.getByRole('textbox', { name: /^Nombre/ }), { target: { value: 'Cliente Simulado' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^Email/ }), { target: { value: 'fixture@example.test' } });
  fireEvent.change(screen.getByPlaceholderText('11 2345-6789'), { target: { value: '1128436014' } });
}
async function openCard() {
  await reachData(); fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));
  await screen.findByRole('textbox', { name: 'Número de tarjeta' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Número de tarjeta' }), { target: { value: '4507990000004905' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Mes de vencimiento' }), { target: { value: '12' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Año de vencimiento' }), { target: { value: '29' } });
  fireEvent.change(screen.getByLabelText('Código de seguridad'), { target: { value: '123' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del titular' }), { target: { value: 'Titular Simulado' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'DNI del titular' }), { target: { value: '12345678' } });
}
beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState(null, '');
  Element.prototype.scrollTo = vi.fn();
  window.scrollTo = vi.fn();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  mocks.prepare.mockResolvedValue({ ready: true, checkout });
  mocks.tokenize.mockResolvedValue({ token: 'fixture-token', bin: '450799' });
  mocks.pay.mockResolvedValue({ state: 'approved', message: PAYWAY_MESSAGES.approved, appointmentConfirmed: true });
});
afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.useRealTimers(); });

describe('independent Payway reservation matching the current V3 five steps', () => {
  it('preserves the compact review and blocks unavailable payment without creating an appointment', async () => {
    mocks.prepare.mockResolvedValue({ ready: false, message: PAYWAY_MESSAGES.unavailable });
    await reachData();
    expect(screen.getByLabelText('Paso 5 de 5: Datos')).toBeInTheDocument();
    expect(screen.getByText('Precio total del servicio')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(PAYWAY_MESSAGES.unavailable);
    expect(mocks.prepare).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'Cliente Simulado', phone: '+5491128436014' }) });
    expect(screen.queryByRole('textbox', { name: 'Número de tarjeta' })).not.toBeInTheDocument();
    expect(mocks.mp).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.tokenize).not.toHaveBeenCalled();
  });

  it('transitions automatically on APPROVED + appointmentConfirmed to Turno confirmado, removes Pagar seña and pre-payment copy, and prevents a second payment', async () => {
    await openCard();
    const form = screen.getByRole('textbox', { name: 'Número de tarjeta' }).closest('form')!;
    let resolve!: (value: { token: string; bin: string }) => void;
    mocks.tokenize.mockReturnValue(new Promise(r => { resolve = r; }));
    fireEvent.submit(form); fireEvent.submit(form);
    expect(mocks.tokenize).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ token: 'fixture-token', bin: '450799' }); });
    await waitFor(() => expect(mocks.pay).toHaveBeenCalledTimes(1));
    expect(mocks.pay).toHaveBeenCalledWith({ data: { appointmentId: checkout.appointmentId, attemptId: checkout.attemptId,
      accessToken: checkout.accessToken, token: 'fixture-token', bin: '450799', paymentMethodId: 1 } });

    // Final confirmation screen appears automatically without intermediate modal
    expect(await screen.findByRole('heading', { name: 'Turno confirmado' })).toBeInTheDocument();
    expect(screen.getByText('Tu turno está confirmado.')).toBeInTheDocument();
    expect(screen.getByText('Te enviamos la confirmación por correo electrónico.')).toBeInTheDocument();
    expect(screen.getByText('Corte')).toBeInTheDocument();
    expect(screen.getByText('Lautaro')).toBeInTheDocument();
    expect(screen.getByText(dateLabel('2026-10-27'))).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('$5.000')).toBeInTheDocument();
    expect(screen.getByText('$20.000')).toBeInTheDocument();

    // Form, Pagar seña, and pre-payment notice are completely gone
    expect(screen.queryByText('Completá tus datos')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pagar seña' })).not.toBeInTheDocument();
    expect(screen.queryByText('Tu turno se confirma cuando se acredita la seña.')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Número de tarjeta' })).not.toBeInTheDocument();
    expect(mocks.mp).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();

    // Pressing Back (popstate) or refreshing/remounting preserves Turno confirmado and never allows a second payment
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByRole('heading', { name: 'Turno confirmado' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pagar seña' })).not.toBeInTheDocument();

    cleanup();
    render(<PaywayBooking />);
    expect(screen.getByRole('heading', { name: 'Turno confirmado' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pagar seña' })).not.toBeInTheDocument();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.pay).toHaveBeenCalledTimes(1);
  });

  it('keeps an indeterminate payment terminal even after closing and reopening the dialog', async () => {
    mocks.pay.mockRejectedValue(new Error('network fixture'));
    await openCard(); fireEvent.submit(screen.getByRole('textbox', { name: 'Número de tarjeta' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(PAYWAY_MESSAGES.unknown);
    expect(screen.getByText('Conservá esta pantalla y contactá al estudio. Tu turno todavía no está confirmado.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Turno confirmado' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Número de tarjeta' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Cerrar$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(PAYWAY_MESSAGES.unknown);
    expect(mocks.prepare).toHaveBeenCalledTimes(1); expect(mocks.pay).toHaveBeenCalledTimes(1);
  });

  it('renders explicit rejection without false success and allows recoverable retry with a new preparation', async () => {
    mocks.pay.mockResolvedValueOnce({ state: 'rejected', message: PAYWAY_MESSAGES.rejected });
    await openCard(); fireEvent.submit(screen.getByRole('textbox', { name: 'Número de tarjeta' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(PAYWAY_MESSAGES.rejected);
    expect(screen.queryByRole('heading', { name: 'Turno confirmado' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Número de tarjeta' })).toBeNull();
    expect(mocks.pay).toHaveBeenCalledTimes(1);

    // Recoverable flow: closing modal and clicking Pagar seña prepares a fresh attempt
    fireEvent.click(screen.getByRole('button', { name: 'Volver a mis datos' }));
    const retryCheckout = { ...checkout, attemptId: 'b'.repeat(32) };
    mocks.prepare.mockResolvedValueOnce({ ready: true, checkout: retryCheckout });
    fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));
    expect(await screen.findByRole('textbox', { name: 'Número de tarjeta' })).toBeInTheDocument();
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });
});
