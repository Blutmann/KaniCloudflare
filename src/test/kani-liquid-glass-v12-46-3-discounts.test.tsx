import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Booking } from '@/components/kani/booking';
import { KaniProvider } from '@/components/kani/store';
import { liquidGlassMotionAdapter } from '@/components/kani/experimental/liquid-glass-motion';
import * as benefitFunctions from '@/lib/kani-benefit-codes.functions';
import * as availabilityModule from '@/lib/kani-availability';

const BASE_CONTACT = {
  name: 'Lautaro Gomez',
  email: 'lautaro@test.com',
  phone: '+5491122334455',
  notes: '',
};

function renderLiquidBooking(props: Partial<React.ComponentProps<typeof Booking>> = {}) {
  return render(
    <KaniProvider>
      <Booking
        variant="v3"
        experimentalMotion={liquidGlassMotionAdapter}
        initialStep={4}
        initialService="corte"
        initialBarber="Lautaro"
        initialDate="2026-11-20"
        initialTime="14:00"
        initialContact={BASE_CONTACT}
        hasActivePaymentAttempt
        {...props}
      />
    </KaniProvider>,
  );
}

describe('Kani — V12.46.3 Descuentos sin fricción y estética champagne en /reservar-turno-liquid', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(availabilityModule, 'readPublicBookingBarbers').mockResolvedValue(['Lautaro', 'Gonzalo', 'Valentín'] as any);
    vi.spyOn(availabilityModule, 'readPublicAvailabilityStarts').mockResolvedValue([]);
  });

  it('1. Renderiza una única tarjeta champagne Liquid Glass sin duplicados ni alerta permanente verde al aplicar descuento', async () => {
    vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
      valid: true,
      code: 'KANI-CHAMPAGNE-50',
      type: 'PERCENT_50',
      benefitType: 'PERCENT_50',
      label: 'Descuento del 50%',
      benefitLabel: 'Descuento del 50%',
      originalPriceArs: 25000,
      discountAmountArs: 12500,
      finalPriceArs: 12500,
      onlineDepositArs: 5000,
      inPersonBalanceArs: 7500,
      skipOnlinePayment: false,
    });

    const { container } = renderLiquidBooking();

    const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX');
    fireEvent.change(input, { target: { value: 'KANI-CHAMPAGNE-50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    await waitFor(() => {
      const card = container.querySelector('.discount-applied-card');
      expect(card).not.toBeNull();
      expect(card?.className).not.toContain('emerald');
      expect(card?.textContent).toContain('KANI-CHAMPAGNE-50');
      expect(card?.textContent).toContain('Aplicado');
      expect(card?.textContent).toContain('Descuento del 50%');
    });

    // Sin tarjeta duplicada ni banner verde temporal con saltos de layout
    expect(container.querySelector('.booking-benefit-badge')).toBeNull();
    expect(container.querySelector('.discount-success-banner')).toBeNull();
    expect(container.querySelector('.summary-discount-row')).not.toBeNull();
    expect(container.querySelector('.summary-discount-row')?.className).not.toContain('emerald');
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeInTheDocument();

    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass.css'),
      'utf8',
    );
    expect(css).toContain('LIQUID GLASS V12.46.3');
    expect(css).toContain('.discount-applied-card');
    expect(css).toContain('backdrop-filter: blur(18px) saturate(145%) !important;');
  });

  it('2. Auto-valida y aplica PERCENT_50 al pulsar "Pagar seña" sin obligar a pulsar "Aplicar" y deduplica toques rápidos', async () => {
    let resolveValidation!: (val: any) => void;
    const validationSpy = vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveValidation = resolve;
        }),
    );
    const onPaymentRequest = vi.fn().mockResolvedValue(undefined);

    renderLiquidBooking({ onPaymentRequest });

    const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX');
    fireEvent.change(input, { target: { value: '  kani-auto-50  ' } });

    const submitBtn = screen.getByRole('button', { name: /Pagar seña/i });
    fireEvent.click(submitBtn);
    // Segundo toque rápido mientras valida: no debe duplicar ni abrir pago
    fireEvent.click(submitBtn);

    expect(validationSpy).toHaveBeenCalledTimes(1);
    expect(onPaymentRequest).not.toHaveBeenCalled();

    resolveValidation({
      valid: true,
      code: 'KANI-AUTO-50',
      type: 'PERCENT_50',
      benefitType: 'PERCENT_50',
      label: 'Descuento del 50%',
      benefitLabel: 'Descuento del 50%',
      originalPriceArs: 25000,
      discountAmountArs: 12500,
      finalPriceArs: 12500,
      onlineDepositArs: 5000,
      inPersonBalanceArs: 7500,
      skipOnlinePayment: false,
    });

    await waitFor(() => {
      expect(onPaymentRequest).toHaveBeenCalledTimes(1);
    });
    expect(onPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        benefitCode: 'KANI-AUTO-50',
        benefitQuote: expect.objectContaining({
          type: 'PERCENT_50',
          finalPriceArs: 12500,
        }),
      }),
    );
  });

  it('3. Auto-aplica "Servicio gratuito" (FREE_SERVICE) al pulsar "Pagar seña" y deriva a confirmación directa sin seña', async () => {
    vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
      valid: true,
      code: 'KANI-FREE-AUTO',
      type: 'FREE_SERVICE',
      benefitType: 'FREE_SERVICE',
      label: 'Servicio gratuito',
      benefitLabel: 'Servicio gratuito',
      originalPriceArs: 25000,
      discountAmountArs: 25000,
      finalPriceArs: 0,
      onlineDepositArs: 0,
      inPersonBalanceArs: 0,
      skipOnlinePayment: true,
      buttonLabel: 'Reservar turno',
    });
    const onPaymentRequest = vi.fn().mockResolvedValue(undefined);

    renderLiquidBooking({ onPaymentRequest });

    const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX');
    fireEvent.change(input, { target: { value: 'KANI-FREE-AUTO' } });

    fireEvent.click(screen.getByRole('button', { name: /Pagar seña/i }));

    await waitFor(() => {
      expect(onPaymentRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          benefitCode: 'KANI-FREE-AUTO',
          benefitQuote: expect.objectContaining({
            type: 'FREE_SERVICE',
            skipOnlinePayment: true,
            onlineDepositArs: 0,
            finalPriceArs: 0,
          }),
        }),
      );
    });
    expect(screen.getByText('Servicio 100% bonificado. Total a abonar: $0.')).toHaveClass('summary-free-service-note');
  });

  it('4. Código vencido o inválido en /reservar-turno-liquid continúa directo a Payway con importe habitual, aviso y conserva el código', async () => {
    const validateSpy = vi
      .spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn')
      .mockResolvedValueOnce({
        valid: false,
        message: 'Este código se encuentra vencido.',
      })
      .mockResolvedValueOnce({
        valid: true,
        code: 'KANI-CORREGIDO',
        type: 'PERCENT_10',
        benefitType: 'PERCENT_10',
        label: 'Descuento del 10%',
        benefitLabel: 'Descuento del 10%',
        originalPriceArs: 25000,
        discountAmountArs: 2500,
        finalPriceArs: 22500,
        onlineDepositArs: 5000,
        inPersonBalanceArs: 17500,
        skipOnlinePayment: false,
      });
    const onPaymentRequest = vi.fn().mockResolvedValue(undefined);

    const { container } = renderLiquidBooking({ onPaymentRequest });

    const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'KANI-VENCIDO' } });
    fireEvent.click(screen.getByRole('button', { name: /Pagar seña/i }));

    await waitFor(() => {
      expect(onPaymentRequest).toHaveBeenCalledTimes(1);
    });
    // Abre Payway sin aplicar descuento y con aviso breve para el modal
    expect(onPaymentRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        benefitCode: undefined,
        benefitQuote: undefined,
        invalidBenefitNotice: 'No pudimos aplicar el código de descuento. Podés continuar con el importe habitual.',
      }),
    );
    expect(container.querySelector('.discount-applied-card')).toBeNull();
    // Conserva el código escrito por si vuelve atrás para corregirlo
    expect(input.value).toBe('KANI-VENCIDO');

    // Al corregir el código y volver a pulsar "Pagar seña", aplica el nuevo código válido sin aviso
    fireEvent.change(input, { target: { value: 'KANI-CORREGIDO' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Pagar seña/i }));

    await waitFor(() => {
      expect(validateSpy).toHaveBeenCalledTimes(2);
      expect(onPaymentRequest).toHaveBeenCalledTimes(2);
    });
    expect(onPaymentRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        benefitCode: 'KANI-CORREGIDO',
        benefitQuote: expect.objectContaining({
          type: 'PERCENT_10',
          finalPriceArs: 22500,
        }),
      }),
    );
  });

  it('5. Reserva sin Payway ante código inválido muestra advertencia visible, "Quitar" y permite "Continuar sin descuento"', async () => {
    vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
      valid: false,
      message: 'El código de beneficio no existe o es inválido.',
    });

    const { container } = renderLiquidBooking({ onPaymentRequest: undefined });

    const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'MAL-ESCRITO' } });
    fireEvent.click(screen.getByRole('button', { name: /Pagar seña/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Código inválido');
      expect(screen.getByRole('button', { name: 'Continuar sin descuento' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Quitar' })).toBeInTheDocument();
    });
    expect(container.querySelector('.discount-applied-card')).toBeNull();
    expect(input.value).toBe('MAL-ESCRITO');
  });
});
