import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAYWAY_MESSAGES } from '@/lib/kani-payway';
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
  readPublicAvailabilityStarts: async () => ['10:00'].map(start_time => ({
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
  preparePaywayCheckoutFn: mocks.prepare,
  payPaywayDepositFn: mocks.pay,
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

async function reachCardModal() {
  render(<PaywayBooking />);
  fireEvent.click(screen.getByRole('button', { name: /^Corte 45/ }));
  next();
  fireEvent.click(screen.getByRole('button', { name: /Lautaro/ }));
  next();
  fireEvent.click(await screen.findByRole('button', { name: dateLabel('2026-10-27') }));
  next();
  await screen.findByRole('button', { name: '10:00' });
  fireEvent.click(screen.getByRole('button', { name: '10:00' }));
  next();
  await screen.findByRole('textbox', { name: /^Nombre/ });
  fireEvent.change(screen.getByRole('textbox', { name: /^Nombre/ }), { target: { value: 'Cliente Simulado' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^Email/ }), { target: { value: 'fixture@example.test' } });
  fireEvent.change(screen.getByPlaceholderText('11 2345-6789'), { target: { value: '1128436014' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));
  await screen.findByRole('textbox', { name: 'Número de tarjeta' });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState(null, '');
  Element.prototype.scrollTo = vi.fn();
  window.scrollTo = vi.fn();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  mocks.prepare.mockResolvedValue({ ready: true, checkout: standardCheckout });
  mocks.tokenize.mockResolvedValue({ token: 'fixture-token', bin: '450799' });
  mocks.pay.mockResolvedValue({ state: 'approved', message: PAYWAY_MESSAGES.approved, appointmentConfirmed: true });
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.useRealTimers();
});

describe('Payway V4 Modern Checkout UX/UI', () => {
  it('eliminates manual issuer dropdown and uses hidden method mapping', async () => {
    await reachCardModal();

    // No visible select with name "paymentMethod"
    const visibleSelects = screen.getAllByRole('combobox');
    expect(visibleSelects.map(s => s.getAttribute('name'))).not.toContain('paymentMethod');

    // Hidden input exists
    const hiddenMethod = document.querySelector('input[name="paymentMethod"]') as HTMLInputElement;
    expect(hiddenMethod).toBeInTheDocument();
    expect(hiddenMethod.type).toBe('hidden');
  });

  it('detects Visa brand, formats PAN with spaces, and shows green checkmark when valid', async () => {
    await reachCardModal();
    const panInput = screen.getByRole('textbox', { name: 'Número de tarjeta' });

    // Partial input: formatted, brand detected, but status idle (no check yet)
    fireEvent.change(panInput, { target: { value: '45079900' } });
    expect(panInput).toHaveValue('4507 9900');
    expect(screen.getByTitle('Visa')).toBeInTheDocument();
    expect(panInput.closest('.field-control')).not.toHaveClass('valid');

    // Complete valid Visa input
    fireEvent.change(panInput, { target: { value: '4507990000004905' } });
    expect(panInput).toHaveValue('4507 9900 0000 4905');
    expect(screen.getByTitle('Visa')).toBeInTheDocument();
    expect(panInput.closest('.field-control')).toHaveClass('valid');
    const hiddenMethod = document.querySelector('input[name="paymentMethod"]') as HTMLInputElement;
    expect(hiddenMethod.value).toBe('1');
  });

  it('detects Mastercard brand and maps to method 104', async () => {
    await reachCardModal();
    const panInput = screen.getByRole('textbox', { name: 'Número de tarjeta' });

    fireEvent.change(panInput, { target: { value: '541234' } });
    expect(screen.getByTitle('Mastercard')).toBeInTheDocument();
    const hiddenMethod = document.querySelector('input[name="paymentMethod"]') as HTMLInputElement;
    expect(hiddenMethod.value).toBe('104');
  });

  it('detects Cabal brand (589657) and maps to method 63', async () => {
    await reachCardModal();
    const panInput = screen.getByRole('textbox', { name: 'Número de tarjeta' });

    fireEvent.change(panInput, { target: { value: '589657' } });
    expect(screen.getByTitle('Cabal')).toBeInTheDocument();
    const hiddenMethod = document.querySelector('input[name="paymentMethod"]') as HTMLInputElement;
    expect(hiddenMethod.value).toBe('63');
  });

  it('shows inline error when card brand is not supported in checkout.methods', async () => {
    await reachCardModal();
    const panInput = screen.getByRole('textbox', { name: 'Número de tarjeta' });

    // American Express is not in configured checkout.methods
    fireEvent.change(panInput, { target: { value: '378282246310005' } });
    fireEvent.blur(panInput);

    expect(screen.getByTitle('American Express')).toBeInTheDocument();
    expect(panInput.closest('.field-control')).toHaveClass('invalid');
    expect(screen.getByText('Esta tarjeta no está disponible como medio de pago.')).toBeInTheDocument();
  });

  it('shows inline error on invalid Luhn card number', async () => {
    await reachCardModal();
    const panInput = screen.getByRole('textbox', { name: 'Número de tarjeta' });

    // Invalid Luhn checksum
    fireEvent.change(panInput, { target: { value: '4507990000004906' } });
    fireEvent.blur(panInput);

    expect(panInput.closest('.field-control')).toHaveClass('invalid');
    expect(screen.getByText('Número de tarjeta inválido.')).toBeInTheDocument();
  });

  it('renders month dropdown with 12 months and year dropdown with 20-year range', async () => {
    await reachCardModal();
    const monthSelect = screen.getByLabelText('Mes de vencimiento') as HTMLSelectElement;
    const yearSelect = screen.getByLabelText('Año de vencimiento') as HTMLSelectElement;

    // Month options: placeholder + 12 months = 13 options
    expect(monthSelect.options).toHaveLength(13);
    expect(monthSelect.options[1].text).toBe('Enero (01)');
    expect(monthSelect.options[12].text).toBe('Diciembre (12)');

    // Year options: placeholder + 21 years (2026 to 2046) = 22 options
    expect(yearSelect.options).toHaveLength(22);
    expect(yearSelect.options[1].text).toBe('2026');
    expect(yearSelect.options[21].text).toBe('2046');
  });

  it('disables past months when current year is selected', async () => {
    await reachCardModal();
    const monthSelect = screen.getByLabelText('Mes de vencimiento') as HTMLSelectElement;
    const yearSelect = screen.getByLabelText('Año de vencimiento') as HTMLSelectElement;

    // Current date is 2026-10-26 (Month: 10, Year: 2026)
    fireEvent.change(yearSelect, { target: { value: '26' } });

    // Months 01 to 09 should be disabled
    expect(monthSelect.options[1].disabled).toBe(true); // Enero
    expect(monthSelect.options[9].disabled).toBe(true); // Septiembre
    // Month 10 and future months should remain enabled
    expect(monthSelect.options[10].disabled).toBe(false); // Octubre
    expect(monthSelect.options[11].disabled).toBe(false); // Noviembre
    expect(monthSelect.options[12].disabled).toBe(false); // Diciembre
  });

  it('validates CVV according to card brand length and displays checkmark', async () => {
    await reachCardModal();
    const cvvInput = screen.getByLabelText(/Código de seguridad/);

    // Partial CVV
    fireEvent.change(cvvInput, { target: { value: '12' } });
    expect(cvvInput.closest('.field-control')).not.toHaveClass('valid');

    // Complete CVV
    fireEvent.change(cvvInput, { target: { value: '123' } });
    expect(cvvInput.closest('.field-control')).toHaveClass('valid');
  });

  it('pre-populates cardholder name from booking contact and validates DNI with dot formatting', async () => {
    await reachCardModal();
    const holderInput = screen.getByLabelText(/Titular de la tarjeta/);
    const dniInput = screen.getByLabelText('DNI del titular');

    // Cardholder is prefilled with "Cliente Simulado"
    expect(holderInput).toHaveValue('Cliente Simulado');
    expect(holderInput.closest('.field-control')).toHaveClass('valid');

    // Cardholder remains fully editable
    fireEvent.change(holderInput, { target: { value: 'Otro Titular Autorizado' } });
    expect(holderInput).toHaveValue('Otro Titular Autorizado');

    // DNI formatted with dots
    fireEvent.change(dniInput, { target: { value: '40123456' } });
    expect(dniInput).toHaveValue('40.123.456');
    expect(dniInput.closest('.field-control')).toHaveClass('valid');
  });

  it('blocks form submission when fields are empty and focuses the first invalid field', async () => {
    await reachCardModal();
    const form = screen.getByRole('textbox', { name: 'Número de tarjeta' }).closest('form')!;
    const panInput = screen.getByRole('textbox', { name: 'Número de tarjeta' });

    // Attempt submission with empty card data
    fireEvent.submit(form);

    // Errors displayed
    expect(screen.getByText('Ingresá el número de tarjeta.')).toBeInTheDocument();
    expect(screen.getByText('Seleccioná mes y año de vencimiento.')).toBeInTheDocument();
    expect(screen.getByText('Ingresá los 3 dígitos de seguridad.')).toBeInTheDocument();
    expect(screen.getByText('Ingresá el DNI del titular.')).toBeInTheDocument();

    // Focus set to first invalid field (card_number)
    expect(document.activeElement).toBe(panInput);

    // Payway tokenization was NOT called
    expect(mocks.tokenize).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it('submits successfully when all fields are valid, passing correct token and paymentMethodId without leaking PAN/CVV to backend', async () => {
    await reachCardModal();
    const form = screen.getByRole('textbox', { name: 'Número de tarjeta' }).closest('form')!;

    fireEvent.change(screen.getByRole('textbox', { name: 'Número de tarjeta' }), {
      target: { value: '4507990000004905' },
    });
    fireEvent.change(screen.getByLabelText('Mes de vencimiento'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Año de vencimiento'), { target: { value: '29' } });
    fireEvent.change(screen.getByLabelText(/Código de seguridad/), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText(/Titular de la tarjeta/), { target: { value: 'Titular Simulado' } });
    fireEvent.change(screen.getByLabelText('DNI del titular'), { target: { value: '12345678' } });

    fireEvent.submit(form);

    await waitFor(() => expect(mocks.tokenize).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.pay).toHaveBeenCalledTimes(1));

    // Confirm that Kani backend received ONLY token and paymentMethodId (never PAN or CVV)
    expect(mocks.pay).toHaveBeenCalledWith({
      data: {
        appointmentId: standardCheckout.appointmentId,
        attemptId: standardCheckout.attemptId,
        accessToken: standardCheckout.accessToken,
        token: 'fixture-token',
        bin: '450799',
        paymentMethodId: 1,
      },
    });

    // Check that appointment was confirmed on screen
    expect(await screen.findByRole('heading', { name: 'Turno confirmado' })).toBeInTheDocument();
  });

  it('renders refined header hierarchy: title, dynamic supporting text, and dynamic CTA button text without extra space', async () => {
    await reachCardModal();

    // Title and supporting text hierarchy
    expect(screen.getByRole('heading', { name: 'Pagá la seña a Kani con Payway' })).toBeInTheDocument();
    expect(screen.getByText('Seña: $5.000 · Pago seguro')).toBeInTheDocument();

    // CTA button text is dynamic and compact ("Pagar seña $5.000" without space after $)
    const cta = screen.getByRole('button', { name: 'Pagar seña $5.000' });
    expect(cta).toBeInTheDocument();
  });

  it('renders Expiry label and independent CVV row with contextual help for standard cards and Amex', async () => {
    await reachCardModal();

    // General expiration label
    expect(screen.getByText('Vencimiento de tarjeta')).toBeInTheDocument();

    // CVV label in independent row
    expect(screen.getByText('Código de seguridad (CVV)')).toBeInTheDocument();

    // Contextual help button exists and is accessible
    const helpBtn = screen.getByRole('button', { name: 'Ayuda sobre el CVV' });
    expect(helpBtn).toBeInTheDocument();
    expect(helpBtn).toHaveAttribute('aria-expanded', 'false');

    // Default card network: 3 digits of reverse
    fireEvent.click(helpBtn);
    expect(helpBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('3 dígitos del reverso de la tarjeta.')).toBeInTheDocument();

    // Closes on clicking again
    fireEvent.click(helpBtn);
    expect(screen.queryByText('3 dígitos del reverso de la tarjeta.')).not.toBeInTheDocument();

    // When card is Amex, help text adapts to 4 digits on front
    const panInput = screen.getByRole('textbox', { name: 'Número de tarjeta' });
    fireEvent.change(panInput, { target: { value: '378282246310005' } });
    fireEvent.click(helpBtn);
    expect(screen.getByText('4 dígitos del frente de la tarjeta.')).toBeInTheDocument();
  });

  it('marks data-payway-modal-open on body while modal is open to ensure solid header icon contrast under overlay', async () => {
    await reachCardModal();
    expect(document.body).toHaveAttribute('data-payway-modal-open', 'true');
  });
});
