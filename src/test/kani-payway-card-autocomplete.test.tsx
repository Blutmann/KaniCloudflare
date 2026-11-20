import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dateLabel } from '@/lib/kani-model';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  pay: vi.fn(),
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
  readPublicBookingBarbers: async () => ['Lautaro', 'Gonzalo', 'Valentín'].map(name => ({ id: name, name })),
  readPublicAvailabilityStarts: async () => ['10:00'].map(start_time => ({
    barber_id: 'Lautaro',
    barber_name: 'Lautaro',
    slot_date: '2026-11-28',
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
  preparePaywayCheckoutFn: mocks.prepare,
  payPaywayDepositFn: mocks.pay,
  checkPaywayPaymentStatusFn: vi.fn(),
}));

vi.mock('@/lib/kani-payway.browser', () => ({
  tokenizePaywayForm: mocks.tokenize,
}));

import { PaywayBooking } from '@/components/kani/experimental/payway-booking';

const standardCheckout = {
  appointmentId: '123e4567-e89b-42d3-a456-426614174000',
  attemptId: 'a'.repeat(32),
  accessToken: 'x'.repeat(43),
  depositArs: 5000,
  publicKey: 'public-fixture',
  apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2',
  methods: [
    { id: 1, label: 'Visa' },
    { id: 104, label: 'Mastercard' },
    { id: 63, label: 'Cabal' },
  ],
};

function next() {
  fireEvent.click(screen.getByRole('button', { name: 'Continuar', hidden: false }));
}

async function openCardModal() {
  render(<PaywayBooking />);
  fireEvent.click(screen.getByRole('button', { name: /^Corte, 45/ }));
  next();
  fireEvent.click(await screen.findByRole('button', { name: /Lautaro/ }));
  next();
  fireEvent.click(await screen.findByRole('button', { name: dateLabel('2026-11-28') }));
  next();
  await screen.findByRole('button', { name: /10:00/ });
  fireEvent.click(screen.getByRole('button', { name: /10:00/ }));
  next();
  await screen.findByRole('textbox', { name: /^Nombre/ });
  fireEvent.change(screen.getByRole('textbox', { name: /^Nombre/ }), { target: { value: 'Cliente Simulado' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^Email/ }), { target: { value: 'fixture@example.test' } });
  const telInput = await waitFor(() => {
    const el = document.querySelector('input[type="tel"]') as HTMLInputElement | null;
    if (!el) throw new Error('PhoneInput not mounted yet');
    return el;
  });
  fireEvent.change(telInput, { target: { value: '1128436014' } });
  fireEvent.click(await screen.findByRole('button', { name: /Pagar seña/i }));
  return await screen.findByLabelText('Número de tarjeta');
}

describe('Payway Checkout — Card Autofill & Browser Compatibility', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mocks.prepare.mockReset();
    mocks.pay.mockReset();
    mocks.tokenize.mockReset();
    mocks.prepare.mockResolvedValue({ ready: true, checkout: standardCheckout });
    mocks.tokenize.mockResolvedValue({ token: 'tok-autofill-123', bin: '450799' });
    mocks.pay.mockResolvedValue({ state: 'approved', message: 'Seña aprobada. Tu turno está confirmado.', appointmentConfirmed: true });
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it('exposes standard HTML autocomplete, id, name, type and inputMode attributes on form and card fields', async () => {
    const panInput = await openCardModal();
    const form = panInput.closest('form');

    expect(form).not.toBeNull();
    expect(form).toHaveAttribute('autocomplete', 'on');

    expect(panInput).toHaveAttribute('id', 'card-number');
    expect(panInput).toHaveAttribute('name', 'card_number');
    expect(panInput).toHaveAttribute('type', 'text');
    expect(panInput).toHaveAttribute('inputmode', 'numeric');
    expect(panInput).toHaveAttribute('autocomplete', 'cc-number');

    const monthSelect = screen.getByLabelText('Mes de vencimiento');
    expect(monthSelect).toHaveAttribute('id', 'card-expiration-month');
    expect(monthSelect).toHaveAttribute('name', 'card_expiration_month');
    expect(monthSelect).toHaveAttribute('autocomplete', 'cc-exp-month');

    const yearSelect = screen.getByLabelText('Año de vencimiento');
    expect(yearSelect).toHaveAttribute('id', 'card-expiration-year');
    expect(yearSelect).toHaveAttribute('name', 'card_expiration_year');
    expect(yearSelect).toHaveAttribute('autocomplete', 'cc-exp-year');

    const cvvInput = screen.getByLabelText('Código de seguridad (CVV)');
    expect(cvvInput).toHaveAttribute('id', 'card-security-code');
    expect(cvvInput).toHaveAttribute('name', 'security_code');
    expect(cvvInput).toHaveAttribute('type', 'password');
    expect(cvvInput).toHaveAttribute('inputmode', 'numeric');
    expect(cvvInput).toHaveAttribute('autocomplete', 'cc-csc');

    const holderInput = screen.getByLabelText('Titular de la tarjeta');
    expect(holderInput).toHaveAttribute('id', 'card-holder-name');
    expect(holderInput).toHaveAttribute('name', 'card_holder_name');
    expect(holderInput).toHaveAttribute('type', 'text');
    expect(holderInput).toHaveAttribute('autocomplete', 'cc-name');

    const dniInput = screen.getByLabelText('DNI del titular');
    expect(dniInput).toHaveAttribute('id', 'card-holder-dni');
    expect(dniInput).toHaveAttribute('name', 'card_holder_doc_number');
    expect(dniInput).toHaveAttribute('inputmode', 'numeric');
    expect(dniInput).toHaveAttribute('autocomplete', 'off');
  });

  it('updates React state, validates, and tokenizes cleanly when browser autofills PAN, expiry and holder name plus manual CVV and DNI', async () => {
    const panInput = await openCardModal();
    const monthSelect = screen.getByLabelText('Mes de vencimiento') as HTMLSelectElement;
    const yearSelect = screen.getByLabelText('Año de vencimiento') as HTMLSelectElement;
    const cvvInput = screen.getByLabelText('Código de seguridad (CVV)') as HTMLInputElement;
    const holderInput = screen.getByLabelText('Titular de la tarjeta') as HTMLInputElement;
    const dniInput = screen.getByLabelText('DNI del titular') as HTMLInputElement;

    // Simulate batched browser autofill (e.g., Chrome iOS / Safari iOS saved card)
    fireEvent.change(panInput, { target: { value: '4507990000004905' } });
    fireEvent.change(monthSelect, { target: { value: '12' } });
    fireEvent.change(yearSelect, { target: { value: '29' } });
    fireEvent.change(holderInput, { target: { value: 'GONZALO TEST' } });

    // Simulate manual CVV + DNI entry (as Chrome iOS prompts for CVV)
    fireEvent.change(cvvInput, { target: { value: '123' } });
    fireEvent.change(dniInput, { target: { value: '35123456' } });

    expect((panInput as HTMLInputElement).value).toBe('4507 9900 0000 4905');
    expect(monthSelect.value).toBe('12');
    expect(yearSelect.value).toBe('29');
    expect(holderInput.value).toBe('GONZALO TEST');
    expect(cvvInput.value).toBe('123');
    expect(dniInput.value).toBe('35.123.456');

    const submitBtn = panInput.closest('form')!.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn).toBeEnabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mocks.tokenize).toHaveBeenCalledTimes(1);
      expect(mocks.pay).toHaveBeenCalledWith({
        data: expect.objectContaining({
          appointmentId: standardCheckout.appointmentId,
          attemptId: standardCheckout.attemptId,
          token: 'tok-autofill-123',
          bin: '450799',
          paymentMethodId: 1,
        }),
      });
    });
  });
});
