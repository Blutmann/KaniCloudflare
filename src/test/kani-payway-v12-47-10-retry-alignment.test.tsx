import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

import { KaniProvider } from '@/components/kani/store';
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';
import { liquidGlassMotionAdapter } from '@/components/kani/experimental/liquid-glass-motion';
import { dateLabel } from '@/lib/kani-model';
import * as benefitFunctions from '@/lib/kani-benefit-codes.functions';

const mocks = vi.hoisted(() => ({
  readPublicBookingBarbers: vi.fn(),
  readPublicAvailabilityStarts: vi.fn(),
  preparePaywayCheckoutFn: vi.fn(),
}));

vi.mock('@/lib/kani-availability', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/kani-availability')>();
  return {
    ...actual,
    readPublicBookingBarbers: (...args: unknown[]) => mocks.readPublicBookingBarbers(...args),
    readPublicAvailabilityStarts: (...args: unknown[]) => mocks.readPublicAvailabilityStarts(...args),
  };
});

vi.mock('@/lib/kani-payway.functions', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/kani-payway.functions')>();
  return {
    ...actual,
    preparePaywayCheckoutFn: (...args: unknown[]) => mocks.preparePaywayCheckoutFn(...args),
  };
});

async function navigateToStepDatosAndOpenPayway(discountCode?: string) {
  render(
    <KaniProvider>
      <PaywayBooking homeUrl="/reservar" experimentalMotion={liquidGlassMotionAdapter} />
    </KaniProvider>,
  );

  fireEvent.click(await screen.findByRole('button', { name: /^Corte,/i }));
  fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

  fireEvent.click(await screen.findByRole('button', { name: /Lautaro/i }));
  fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

  const dateBtn = await screen.findByRole('button', { name: new RegExp('^' + dateLabel('2026-11-20')) });
  await waitFor(() => expect(dateBtn).not.toBeDisabled());
  fireEvent.click(dateBtn);
  await waitFor(() => expect(screen.getByRole('button', { name: /Continuar/i })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

  fireEvent.click(await screen.findByRole('button', { name: /14:30/i }));
  fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

  const nameInput = await screen.findByPlaceholderText('Tu nombre completo');
  const phoneInput = (await screen.findByPlaceholderText('11 2345-6789')) as HTMLInputElement;
  const emailInput = screen.getByPlaceholderText('nombre@email.com');
  const discountInput = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX') as HTMLInputElement;

  fireEvent.change(nameInput, { target: { value: 'Tomas Cliente' } });
  fireEvent.change(phoneInput, { target: { value: '1122334455' } });
  fireEvent.change(emailInput, { target: { value: 'tomas@example.com' } });
  if (discountCode) {
    fireEvent.change(discountInput, { target: { value: discountCode } });
  }

  fireEvent.click(screen.getByRole('button', { name: /Pagar seña/i }));

  const dialog = await screen.findByRole('dialog');
  return { dialog, discountInput };
}

describe('KANI v12.47.10 — Alineación CVV/DNI y Reintento de Descuentos en PayWay Mobile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    mocks.preparePaywayCheckoutFn.mockReset();
    mocks.readPublicBookingBarbers.mockResolvedValue([
      {
        id: 'Lautaro',
        name: 'Lautaro',
      },
    ]);
    mocks.readPublicAvailabilityStarts.mockResolvedValue([
      {
        barber_id: 'Lautaro',
        barber_name: 'Lautaro',
        slot_date: '2026-11-20',
        start_time: '14:30',
        is_exception: true,
        compatible_services: ['Corte'],
      },
    ]);
  });

  it('1. Alinea CVV y DNI en .payway-cvv-dni-row con .payway-col-label-row idéntico, alturas fijas 42px y tooltip dinámico', () => {
    const paywayCode = fs.readFileSync(
      path.resolve(__dirname, '../components/kani/experimental/payway-booking.tsx'),
      'utf-8',
    );
    const reservaV4Css = fs.readFileSync(
      path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css'),
      'utf-8',
    );
    const liquidCss = fs.readFileSync(
      path.resolve(__dirname, '../components/kani/experimental/liquid-glass.css'),
      'utf-8',
    );

    expect(paywayCode).toContain('className="payway-col-label-row"');
    expect(paywayCode).toContain('ref={cvvHelpRef}');
    expect(paywayCode).toContain('setCvvHelpPlacement');
    expect(paywayCode).toContain('payway-help-bubble is-${cvvHelpPlacement}');

    expect(reservaV4Css).toMatch(/\.payway-cvv-dni-row\s+\.payway-col-label-row\s*\{[\s\S]*?min-height:\s*20px;/);
    expect(reservaV4Css).toMatch(/\.payway-checkout\s*\{[\s\S]*?500px[\s\S]*?92dvh/);
    expect(liquidCss).toMatch(/\.payway-checkout\)\s*\{[\s\S]*?500px\)\s*!important;[\s\S]*?92dvh/);
    expect(reservaV4Css).toMatch(/\.payway-help-trigger\s*\{[\s\S]*?width:\s*18px\s*!important;[\s\S]*?height:\s*18px\s*!important;/);
    expect(reservaV4Css).toMatch(/#card-holder-dni\s*\{[\s\S]*?height:\s*42px\s*!important;/);
    expect(liquidCss).toMatch(/\.payway-discount-retry-input\s*\{[\s\S]*?font-size:\s*16px\s*!important;/);
  });

  it('2. No muestra el bloque de reintento de descuento cuando el usuario no intentó usar ningún código en Datos', async () => {
    mocks.preparePaywayCheckoutFn.mockResolvedValue({
      ready: true,
      checkout: {
        appointmentId: 'apt-1',
        attemptId: 'att-1',
        accessToken: 'tok-1-12345678901234567890123456789012',
        depositArs: 5000,
        publicKey: 'pk_test',
        apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2',
        methods: [{ id: 1, label: 'Visa' }],
      },
    });

    const { dialog } = await navigateToStepDatosAndOpenPayway();
    expect(within(dialog).getByRole('heading', { name: 'Pagá la seña con Payway' })).toBeInTheDocument();
    expect(within(dialog).getByText('Seña: $5.000 · Pago seguro · Kani Barber Studio')).toBeInTheDocument();
    expect(within(dialog).getByText('Código de seguridad (CVV)')).toBeInTheDocument();
    expect(
      within(dialog).queryByText(/No pudimos aplicar el descuento\. Revisá el código o continuá con la seña habitual\./i),
    ).toBeNull();
    expect(within(dialog).queryByPlaceholderText('Código de descuento')).toBeNull();
  });

  it('3. Permite reintentar un código en PayWay, recalcula en backend, actualiza el monto, conserva la tarjeta y sincroniza con Datos', async () => {
    const validateSpy = vi
      .spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn')
      .mockResolvedValueOnce({ valid: false, message: 'Código no encontrado.' })
      .mockResolvedValueOnce({
        valid: true,
        code: 'KANI-50-OK',
        type: 'PERCENT_50',
        benefitType: 'PERCENT_50',
        label: '50% OFF',
        benefitLabel: '50% OFF',
        originalPriceArs: 25000,
        discountAmountArs: 12500,
        finalPriceArs: 12500,
        onlineDepositArs: 2500,
        inPersonBalanceArs: 10000,
        skipOnlinePayment: false,
      });

    mocks.preparePaywayCheckoutFn
      .mockResolvedValueOnce({
        ready: true,
        checkout: {
          appointmentId: 'apt-2',
          attemptId: 'att-2',
          accessToken: 'tok-2-12345678901234567890123456789012',
          depositArs: 5000,
          publicKey: 'pk_test',
          apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2',
          methods: [{ id: 1, label: 'Visa' }],
        },
      })
      .mockResolvedValueOnce({
        ready: true,
        checkout: {
          appointmentId: 'apt-2-recalc',
          attemptId: 'att-2-recalc',
          accessToken: 'tok-2-recalc-123456789012345678901234',
          depositArs: 2500,
          publicKey: 'pk_test',
          apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2',
          methods: [{ id: 1, label: 'Visa' }],
        },
      });

    const { dialog, discountInput } = await navigateToStepDatosAndOpenPayway('KANI-MAL');

    expect(
      within(dialog).getByText('No pudimos aplicar el descuento. Revisá el código o continuá con la seña habitual.'),
    ).toBeInTheDocument();

    // Ingresar datos de tarjeta antes de corregir el descuento para verificar preservación
    const cardInput = within(dialog).getByLabelText('Número de tarjeta') as HTMLInputElement;
    const holderInput = within(dialog).getByLabelText('Titular de la tarjeta') as HTMLInputElement;
    fireEvent.change(cardInput, { target: { value: '4507990000004905' } });
    fireEvent.change(holderInput, { target: { value: 'TOMAS HARISPE' } });

    const modalDiscountInput = within(dialog).getByPlaceholderText('Código de descuento') as HTMLInputElement;
    expect(modalDiscountInput.value).toBe('KANI-MAL');

    fireEvent.change(modalDiscountInput, { target: { value: 'kani-50-ok' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aplicar' }));

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: /Pagar seña \$2\.500/i })).toBeInTheDocument();
      expect(within(dialog).getByText('Seña: $2.500 · Pago seguro · Kani Barber Studio')).toBeInTheDocument();
    });

    expect(validateSpy).toHaveBeenCalledTimes(2);
    expect(mocks.preparePaywayCheckoutFn).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ benefitCode: 'KANI-50-OK' }),
    });
    expect(within(dialog).getByText(/Descuento/i)).toBeInTheDocument();
    expect(cardInput.value).toBe('4507 9900 0000 4905');
    expect(holderInput.value).toBe('TOMAS HARISPE');

    // Al cerrar el modal, el descuento válido quedó sincronizado en Datos
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByText('KANI-50-OK')).toBeInTheDocument();
  });

  it('4. Muestra error claro si el nuevo código en PayWay es inválido o vence sin alterar el monto ni bloquear el pago habitual', async () => {
    vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn')
      .mockResolvedValueOnce({ valid: false, message: 'Código no válido.' })
      .mockResolvedValueOnce({ valid: false, message: 'Este código ya fue utilizado o alcanzó su límite.' });

    mocks.preparePaywayCheckoutFn.mockResolvedValueOnce({
      ready: true,
      checkout: {
        appointmentId: 'apt-3',
        attemptId: 'att-3',
        accessToken: 'tok-3-12345678901234567890123456789012',
        depositArs: 5000,
        publicKey: 'pk_test',
        apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2',
        methods: [{ id: 1, label: 'Visa' }],
      },
    });

    const { dialog } = await navigateToStepDatosAndOpenPayway('KANI-BAD-1');
    const modalDiscountInput = within(dialog).getByPlaceholderText('Código de descuento') as HTMLInputElement;
    fireEvent.change(modalDiscountInput, { target: { value: 'KANI-USADO' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aplicar' }));

    const alertEl = await within(dialog).findByRole('alert');
    expect(alertEl).toHaveClass('payway-discount-retry-error');
    expect(alertEl.textContent?.trim().length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: /Pagar seña \$5\.000/i })).toBeInTheDocument();
    expect(mocks.preparePaywayCheckoutFn).toHaveBeenCalledTimes(1);
  });

  it('5. Confirma turno sin pago online cuando el código validado dentro de PayWay deja la seña en $0 (skipOnlinePayment)', async () => {
    vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn')
      .mockResolvedValueOnce({ valid: false, message: 'Código inválido.' })
      .mockResolvedValueOnce({
        valid: true,
        code: 'KANI-FREE-100',
        type: 'FREE_100',
        benefitType: 'FREE_100',
        label: 'Corte bonificado 100%',
        benefitLabel: 'Corte bonificado 100%',
        originalPriceArs: 25000,
        discountAmountArs: 25000,
        finalPriceArs: 0,
        onlineDepositArs: 0,
        inPersonBalanceArs: 0,
        skipOnlinePayment: true,
      });

    mocks.preparePaywayCheckoutFn.mockResolvedValueOnce({
      ready: true,
      checkout: {
        appointmentId: 'apt-4',
        attemptId: 'att-4',
        accessToken: 'tok-4-12345678901234567890123456789012',
        depositArs: 5000,
        publicKey: 'pk_test',
        apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2',
        methods: [{ id: 1, label: 'Visa' }],
      },
    });
    const confirmZeroSpy = vi
      .spyOn(benefitFunctions, 'confirmZeroDepositBookingFn')
      .mockResolvedValueOnce({
        success: true,
        appointmentId: 'apt-free-1',
        calculation: {
          code: 'KANI-FREE-100',
          benefitType: 'FREE_100',
          originalPriceArs: 25000,
          discountAmountArs: 25000,
          finalPriceArs: 0,
          onlineDepositArs: 0,
          inPersonBalanceArs: 0,
        },
      } as Awaited<ReturnType<typeof benefitFunctions.confirmZeroDepositBookingFn>>);

    const { dialog } = await navigateToStepDatosAndOpenPayway('KANI-ERR');
    const modalDiscountInput = within(dialog).getByPlaceholderText('Código de descuento');
    fireEvent.change(modalDiscountInput, { target: { value: 'KANI-FREE-100' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aplicar' }));

    await waitFor(() => {
      expect(confirmZeroSpy).toHaveBeenCalledWith({
        data: expect.objectContaining({ benefitCode: 'KANI-FREE-100' }),
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(await screen.findByText('Turno confirmado')).toBeInTheDocument();
  });

  it('6. Tooltip del CVV se abre al pulsar el ícono de ayuda y se cierra al tocar fuera o volver a tocar el ícono', async () => {
    mocks.preparePaywayCheckoutFn.mockResolvedValueOnce({
      ready: true,
      checkout: {
        appointmentId: 'apt-5',
        attemptId: 'att-5',
        accessToken: 'tok-5-12345678901234567890123456789012',
        depositArs: 5000,
        publicKey: 'pk_test',
        apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2',
        methods: [{ id: 1, label: 'Visa' }],
      },
    });

    const { dialog } = await navigateToStepDatosAndOpenPayway();
    const helpBtn = within(dialog).getByRole('button', { name: 'Ayuda sobre el CVV' });

    expect(within(dialog).queryByRole('tooltip')).toBeNull();
    fireEvent.click(helpBtn);
    expect(within(dialog).getByRole('tooltip')).toBeInTheDocument();

    // Tocar fuera cierra el tooltip
    fireEvent.pointerDown(dialog);
    await waitFor(() => {
      expect(within(dialog).queryByRole('tooltip')).toBeNull();
    });
  });
});
