import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Booking } from '@/components/kani/booking';
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';
import { KaniProvider } from '@/components/kani/store';
import { dateLabel } from '@/lib/kani-model';
import { liquidGlassMotionAdapter } from '@/components/kani/experimental/liquid-glass-motion';
import {
  __resetLiquidGlassFeedbackForTests,
  playConfirmationChime,
  readConfirmationSoundEnabled,
} from '@/components/kani/experimental/liquid-glass-feedback';
import {
  __resetBenefitQuoteRateLimitForTests,
  validateBenefitCodeQuote,
} from '@/lib/kani-benefit-codes.server';
import * as paymentDbModule from '@/lib/kani-payment-db.server';
import * as benefitFunctions from '@/lib/kani-benefit-codes.functions';

const mocks = vi.hoisted(() => ({
  readPublicBookingBarbers: vi.fn(),
  readPublicAvailabilityStarts: vi.fn(),
  readConfiguredServices: vi.fn(),
  preparePaywayCheckoutFn: vi.fn(),
}));

vi.mock('@/lib/kani-availability', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/kani-availability')>();
  return {
    ...actual,
    readPublicBookingBarbers: (...args: unknown[]) => mocks.readPublicBookingBarbers(...args),
    readPublicAvailabilityStarts: (...args: unknown[]) => mocks.readPublicAvailabilityStarts(...args),
    readConfiguredServices: (...args: unknown[]) => mocks.readConfiguredServices(...args),
  };
});

vi.mock('@/lib/kani-payway.functions', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/kani-payway.functions')>();
  return {
    ...actual,
    preparePaywayCheckoutFn: (...args: unknown[]) => mocks.preparePaywayCheckoutFn(...args),
  };
});

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

describe('Kani — V12.46.4 Finalización: validación automática debounced, Payway directo y sonido cristalino', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    __resetLiquidGlassFeedbackForTests();
    __resetBenefitQuoteRateLimitForTests();
    mocks.readPublicBookingBarbers.mockReset().mockResolvedValue(
      ['Lautaro', 'Gonzalo', 'Valentín'].map(name => ({ id: name, name })),
    );
    mocks.readPublicAvailabilityStarts.mockReset().mockResolvedValue([]);
    mocks.readConfiguredServices.mockReset().mockResolvedValue([
      { id: 'corte', name: 'Corte', price: 25000, duration: 45 },
    ]);
    mocks.preparePaywayCheckoutFn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. Auto-valida con debounce (~600ms), ignora textos cortos/incompletos y aplica automáticamente códigos válidos', async () => {
    vi.useFakeTimers();
    const validateSpy = vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
      valid: true,
      code: 'KANI-LIVE-50',
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

    fireEvent.change(input, { target: { value: 'KAN' } });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(validateSpy).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'KANI-' } });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(validateSpy).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'KANI-LI' } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.change(input, { target: { value: 'KANI-LIVE-50' } });
    await act(async () => {
      vi.advanceTimersByTime(550);
    });
    expect(validateSpy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(validateSpy).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.discount-applied-card')).not.toBeNull();
    });
    expect(container.querySelector('.discount-applied-card')?.textContent).toContain('KANI-LIVE-50');
    expect(container.querySelector('.summary-discount-row')?.textContent).toContain('Descuento del 50%');
  });

  it('2. No muestra errores prematuros al escribir, mantiene editable el campo e ignora respuestas obsoletas', async () => {
    vi.useFakeTimers();
    let resolveStale!: (val: any) => void;
    const validateSpy = vi
      .spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValueOnce({
        valid: false,
        message: 'El código no existe.',
      })
      .mockResolvedValueOnce({
        valid: true,
        code: 'KANI-FINAL-10',
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

    const { container } = renderLiquidBooking();
    const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'KANI-VIEJO' } });
    await act(async () => {
      vi.advanceTimersByTime(650);
    });
    expect(validateSpy).toHaveBeenCalledTimes(1);
    expect(input.disabled).toBe(false);

    fireEvent.change(input, { target: { value: 'KANI-NO-EXISTE' } });

    await act(async () => {
      resolveStale({
        valid: true,
        code: 'KANI-VIEJO',
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
      await Promise.resolve();
    });
    expect(container.querySelector('.discount-applied-card')).toBeNull();
    expect(input.value).toBe('KANI-NO-EXISTE');

    await act(async () => {
      vi.advanceTimersByTime(650);
      await Promise.resolve();
    });
    expect(validateSpy).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.change(input, { target: { value: 'KANI-FINAL-10' } });
    await act(async () => {
      vi.advanceTimersByTime(650);
      await Promise.resolve();
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(container.querySelector('.discount-applied-card')).not.toBeNull();
    });
    expect(container.querySelector('.discount-applied-card')?.textContent).toContain('KANI-FINAL-10');
  });

  it('3. Deduplica código inválido ya validado al pulsar "Pagar seña" y abre Payway directo con aviso', async () => {
    vi.useFakeTimers();
    const validateSpy = vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
      valid: false,
      message: 'El código de beneficio no existe o es inválido.',
    });
    const onPaymentRequest = vi.fn().mockResolvedValue(undefined);

    renderLiquidBooking({ onPaymentRequest });
    const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'KANI-INVALID-99' } });
    await act(async () => {
      vi.advanceTimersByTime(650);
      await Promise.resolve();
    });
    expect(validateSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();

    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: /Pagar seña/i }));

    await waitFor(() => {
      expect(onPaymentRequest).toHaveBeenCalledTimes(1);
    });
    // Reutiliza la validación reciente sin duplicar llamada al servidor
    expect(validateSpy).toHaveBeenCalledTimes(1);
    expect(onPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        benefitCode: undefined,
        benefitQuote: undefined,
        invalidBenefitNotice: 'Descuento no aplicado.',
      }),
    );
    expect(input.value).toBe('KANI-INVALID-99');
  });

  it('4. PaywayBooking en /reservar-turno-liquid muestra el aviso en el modal ante código inválido, mantiene importe habitual y permite corregir al cerrar', async () => {
    const validateSpy = vi
      .spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn')
      .mockResolvedValueOnce({
        valid: false,
        message: 'Este código se encuentra vencido.',
      })
      .mockResolvedValueOnce({
        valid: true,
        code: 'KANI-VALIDO-50',
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

    const prepareSpy = mocks.preparePaywayCheckoutFn.mockResolvedValue({
      ready: true,
      checkout: {
        appointmentId: 'apt-modal-1',
        attemptId: 'att-modal-1',
        accessToken: 'tok-modal-1-1234567890123456789012345678',
        depositArs: 5000,
        publicKey: 'pk_test',
        apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2',
        methods: [{ id: 1, label: 'Visa' }],
      },
    });

    mocks.readPublicAvailabilityStarts.mockResolvedValue([
      {
        barber_id: 'Lautaro',
        barber_name: 'Lautaro',
        slot_date: '2026-11-20',
        start_time: '14:30',
        is_exception: true,
        compatible_services: ['Corte'],
      },
      {
        barber_id: 'Lautaro',
        barber_name: 'Lautaro',
        slot_date: '2026-11-20',
        start_time: '15:15',
        is_exception: true,
        compatible_services: ['Corte'],
      },
    ]);

    render(
      <KaniProvider>
        <PaywayBooking homeUrl="/reservar-turno-liquid" experimentalMotion={liquidGlassMotionAdapter} />
      </KaniProvider>,
    );

    // Seleccionar servicio -> Continuar
    fireEvent.click(await screen.findByRole('button', { name: /^Corte,/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    // Seleccionar barbero -> Continuar
    fireEvent.click(await screen.findByRole('button', { name: /Lautaro/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    // Seleccionar fecha habilitada en calendario -> Continuar
    const dateBtn = await screen.findByRole('button', { name: new RegExp('^' + dateLabel('2026-11-20')) });
    await waitFor(() => expect(dateBtn).not.toBeDisabled());
    fireEvent.click(dateBtn);
    await waitFor(() => expect(screen.getByRole('button', { name: /Continuar/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    // Seleccionar horario -> Continuar
    fireEvent.click(await screen.findByRole('button', { name: /14:30/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    // Paso Datos: completar campos e ingresar código inválido
    const nameInput = await screen.findByPlaceholderText('Tu nombre completo');
    const phoneInput = (await screen.findByPlaceholderText('11 2345-6789')) as HTMLInputElement;
    const emailInput = screen.getByPlaceholderText('nombre@email.com');
    const discountInput = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX') as HTMLInputElement;

    fireEvent.change(nameInput, { target: { value: 'Tomas Cliente' } });
    fireEvent.change(phoneInput, { target: { value: '1122334455' } });
    fireEvent.change(emailInput, { target: { value: 'tomas@example.com' } });
    fireEvent.change(discountInput, { target: { value: 'KANI-NO-SIRVE' } });

    // Pulsar directo "Pagar seña" sin pulsar "Aplicar"
    fireEvent.click(screen.getByRole('button', { name: /Pagar seña/i }));

    await waitFor(() => {
      expect(prepareSpy).toHaveBeenCalledTimes(1);
    });
    expect(prepareSpy.mock.calls[0]?.[0]?.data).not.toHaveProperty('benefitCode');

    // Dentro del modal Payway se ve el aviso compacto y el importe habitual ($5.000)
    await waitFor(() => {
      expect(
        screen.getByText(/Descuento no aplicado\.\s*Seña:/i),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Pagar seña \$5\.000/i })).toBeInTheDocument();
    });

    // Cerrar Payway con Escape: el código escrito sigue conservado para corregirse
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(
        screen.queryByText(/Descuento no aplicado\.\s*Seña:/i),
      ).toBeNull();
    });
    expect(discountInput.value).toBe('KANI-NO-SIRVE');

    // Corregir código, aplicar y volver a Payway sin aviso de error
    fireEvent.change(discountInput, { target: { value: 'KANI-VALIDO-50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    await waitFor(() => {
      expect(validateSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByText('KANI-VALIDO-50')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Pagar seña/i }));
    await waitFor(() => {
      expect(prepareSpy).toHaveBeenCalledTimes(2);
    });
    expect(prepareSpy.mock.calls[1]?.[0]?.data).toMatchObject({ benefitCode: 'KANI-VALIDO-50' });
    expect(
      screen.queryByText(/Descuento no aplicado\.\s*Seña:/i),
    ).toBeNull();
  });

  it('5. Sonido al confirmar activo por defecto en Liquid Glass sin switch visible y tolerante si AudioContext está bloqueado', async () => {
    expect(readConfirmationSoundEnabled()).toBe(true);

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

    await screen.findByPlaceholderText('Tu nombre completo');
    // V12.47 FASE 2: El control visual «Sonido al confirmar» ya no se renderiza en la UI
    expect(screen.queryByRole('switch', { name: /sonido al confirmar/i })).toBeNull();
    expect(screen.queryByText(/Sonido al confirmar/i)).toBeNull();
    expect(readConfirmationSoundEnabled()).toBe(true);

    // Simula bloqueo de AudioContext en navegador estricto: jamás lanza ni rompe confirmación
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: class BlockedAudioContext {
        state = 'suspended';
        currentTime = 0;
        resume = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
      },
    });
    expect(() => playConfirmationChime('apt-blocked-1', { enabled: true })).not.toThrow();
    expect(playConfirmationChime('apt-blocked-1', { enabled: true })).toBe(true);
  });

  it('6. Servidor rechaza entradas malformadas y aplica límite razonable contra enumeración masiva sin exponer detalles', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({ data: { valid: false }, error: null });
    vi.spyOn(paymentDbModule, 'createPaymentSupabaseClient').mockResolvedValue({
      rpc: rpcSpy,
    } as any);

    const shortRes = await validateBenefitCodeQuote({
      code: 'AB',
      serviceName: 'Corte',
      barberName: 'Lautaro',
    });
    expect(shortRes.valid).toBe(false);
    expect(shortRes.message).toBe('Código no válido o no disponible.');
    expect(rpcSpy).not.toHaveBeenCalled();

    // 24 intentos con formato sintáctico válido consumen el cupo por ventana de 60s
    for (let i = 0; i < 24; i++) {
      await validateBenefitCodeQuote({
        code: `KANI-ENUM-${String(i).padStart(4, '0')}`,
        serviceName: 'Corte',
        barberName: 'Lautaro',
      });
    }
    const callsBeforeLimit = rpcSpy.mock.calls.length;
    const rateLimited = await validateBenefitCodeQuote({
      code: 'KANI-TEST-9999',
      serviceName: 'Corte',
      barberName: 'Lautaro',
    });
    expect(rateLimited.valid).toBe(false);
    expect(rateLimited.error).toBe('RATE_LIMITED');
    expect(rateLimited.message).toContain('Demasiados intentos en poco tiempo');
    // No consulta la DB cuando el límite de frecuencia está superado
    expect(rpcSpy).toHaveBeenCalledTimes(callsBeforeLimit);
  });
});
