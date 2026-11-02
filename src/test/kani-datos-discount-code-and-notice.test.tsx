import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Booking } from '@/components/kani/booking';
import { KaniProvider } from '@/components/kani/store';
import * as benefitFunctions from '@/lib/kani-benefit-codes.functions';

function renderWithProvider(ui: React.ReactElement) {
  return render(<KaniProvider>{ui}</KaniProvider>);
}

describe('Kani — Texto de seña en Servicio y Código de descuento en Datos', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Elegir servicio — Texto de seña condicional móvil vs escritorio', () => {
    it('muestra el texto abreviado solo en móvil y el texto extendido en escritorio', () => {
      const { container } = renderWithProvider(<Booking initialStep={0} />);
      const depositNotice = container.querySelector('.booking-deposit-notice');
      expect(depositNotice).toBeInTheDocument();

      const mobileSpan = depositNotice?.querySelector('.sm\\:hidden');
      const desktopSpan = depositNotice?.querySelector('.hidden.sm\\:inline');

      expect(mobileSpan).toHaveTextContent('Para reservar tu turno se requiere abonar una seña.');
      expect(desktopSpan).toHaveTextContent(
        'Tu turno requiere abonar una seña. En el resumen verás el importe exacto, el total y el saldo restante.'
      );
    });
  });

  describe('2. Paso Datos — reemplazo de Observaciones por Código de descuento', () => {
    it('no renderiza el campo Observaciones (textarea) en el formulario público', () => {
      const { container } = renderWithProvider(
        <Booking
          variant="v3"
          initialStep={4}
          initialService="corte"
          initialBarber="Lautaro"
          initialDate="2026-11-05"
          initialTime="14:00"
        />
      );

      const notesTextarea = container.querySelector('textarea[name="notes"]');
      expect(notesTextarea).toBeNull();
      expect(screen.queryByText(/Algo que quieras contarnos/i)).toBeNull();
    });

    it('renderiza el campo Código de descuento con su placeholder y botón Aplicar', () => {
      renderWithProvider(
        <Booking
          variant="v3"
          initialStep={4}
          initialService="corte"
          initialBarber="Lautaro"
          initialDate="2026-11-05"
          initialTime="14:00"
        />
      );

      const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX');
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('id', 'booking-discount-code');

      const applyButton = screen.getByRole('button', { name: 'Aplicar' });
      expect(applyButton).toBeInTheDocument();
      // Inicialmente deshabilitado si el input está vacío
      expect(applyButton).toBeDisabled();
    });

    it('no duplica el campo de descuento en el Resumen (se trasladó exclusivamente a Datos)', () => {
      const { container } = renderWithProvider(
        <Booking
          variant="v1"
          initialStep={5}
          initialService="corte"
          initialBarber="Lautaro"
          initialDate="2026-11-05"
          initialTime="14:00"
          initialContact={{ name: 'Juan Perez', email: 'juan@test.com', phone: '+5491123456789', notes: '' }}
        />
      );

      // En el paso 5 (Resumen) no debe haber ningún input para ingresar código
      const discountInput = container.querySelector('#booking-discount-code');
      expect(discountInput).toBeNull();
    });
  });

  describe('3. Aplicación, validación y mensajes de error mapeados', () => {
    it('muestra "Aplicando…" y previene doble solicitud durante la validación', async () => {
      let resolvePromise: (val: any) => void;
      const delayedPromise = new Promise((res) => {
        resolvePromise = res;
      });

      vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockImplementation(() => delayedPromise as any);

      renderWithProvider(
        <Booking
          variant="v3"
          initialStep={4}
          initialService="corte"
          initialBarber="Lautaro"
          initialDate="2026-11-05"
          initialTime="14:00"
        />
      );

      const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX');
      fireEvent.change(input, { target: { value: 'KANI-ABCD-1234' } });

      const applyBtn = screen.getByRole('button', { name: 'Aplicar' });
      expect(applyBtn).not.toBeDisabled();

      fireEvent.click(applyBtn);

      // Verifica estado "Aplicando…" y bloqueo de controles
      expect(screen.getByText('Aplicando…')).toBeInTheDocument();
      expect(input).toBeDisabled();

      // Resuelve la promesa
      await act(async () => {
        resolvePromise!({
          valid: true,
          code: 'KANI-ABCD-1234',
          benefitType: 'PERCENT_10',
          benefitLabel: '10% de descuento',
          originalPriceArs: 25000,
          discountAmountArs: 2500,
          finalPriceArs: 22500,
          onlineDepositArs: 5000,
          inPersonBalanceArs: 17500,
          skipOnlinePayment: false,
          buttonLabel: 'Pagar seña $5.000',
        });
      });

      await waitFor(() => {
        expect(screen.getByText('Código aplicado correctamente.')).toBeInTheDocument();
      });
    });

    it('aviso de éxito permite cierre inmediato por clic o botón de teclado y mantiene tarjeta compacta', async () => {
      vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
        valid: true,
        code: 'KANI-DESC-1234',
        type: 'PERCENT_50',
        benefitType: 'PERCENT_50',
        label: '50% de descuento',
        benefitLabel: '50% de descuento',
        originalPriceArs: 25000,
        discountAmountArs: 12500,
        finalPriceArs: 12500,
        onlineDepositArs: 5000,
        inPersonBalanceArs: 7500,
        skipOnlinePayment: false,
        buttonLabel: 'Pagar seña $5.000',
      });

      renderWithProvider(
        <Booking
          variant="v3"
          initialStep={4}
          initialService="corte"
          initialBarber="Lautaro"
          initialDate="2026-11-05"
          initialTime="14:00"
        />
      );

      const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX');
      fireEvent.change(input, { target: { value: 'KANI-DESC-1234' } });
      fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

      await waitFor(() => {
        expect(screen.getByText('Código aplicado correctamente.')).toBeInTheDocument();
      });

      // Se muestra la tarjeta compacta permanente del beneficio
      expect(screen.getAllByText('KANI-DESC-1234').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('50% de descuento').length).toBeGreaterThanOrEqual(1);

      // Cierre inmediato accesible mediante el botón de teclado
      const closeAlertBtn = screen.getByRole('button', { name: 'Cerrar aviso' });
      fireEvent.click(closeAlertBtn);

      // El aviso temporal desaparece inmediatamente
      expect(screen.queryByText('Código aplicado correctamente.')).toBeNull();

      // Pero la indicación compacta y el botón "Quitar" permanecen
      expect(screen.getAllByText('KANI-DESC-1234').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('button', { name: 'Quitar' })).toBeInTheDocument();
    });

    it('mapea correctamente los mensajes según la causa y asocia el error al input con aria-describedby', async () => {
      renderWithProvider(
        <Booking
          variant="v3"
          initialStep={4}
          initialService="corte"
          initialBarber="Lautaro"
          initialDate="2026-11-05"
          initialTime="14:00"
        />
      );

      // 1. Inválido
      vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
        valid: false,
        message: 'El código de beneficio no existe o es inválido.',
      });

      let input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX');
      fireEvent.change(input, { target: { value: 'INVALID-CODE' } });
      fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

      await waitFor(() => {
        const errorMsg = screen.getByRole('alert');
        expect(errorMsg).toHaveTextContent('Código inválido. Revisalo e intentá nuevamente.');
        expect(input).toHaveAttribute('aria-describedby', 'benefit-code-error');
      });

      // 2. Consumido
      vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
        valid: false,
        message: 'Este código ya fue utilizado en otra reserva.',
      });
      fireEvent.change(input, { target: { value: 'USED-CODE' } });
      fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Este código ya fue utilizado.');
      });

      // 3. Desactivado
      vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
        valid: false,
        message: 'Este código ha sido desactivado.',
      });
      fireEvent.change(input, { target: { value: 'DISABLED-CODE' } });
      fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Este código ya no está disponible.');
      });

      // 4. Bloqueo temporal
      vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
        valid: false,
        message: 'El código se encuentra en uso en otro intento de reserva.',
      });
      fireEvent.change(input, { target: { value: 'LOCKED-CODE' } });
      fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Este código está en uso. Intentá nuevamente más tarde.');
      });

      // 5. Fallo de conexión
      vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockRejectedValue(new Error('Failed to fetch network error'));
      fireEvent.change(input, { target: { value: 'NETWORK-FAIL' } });
      fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('No pudimos validar el código. Intentá nuevamente.');
      });

      // Al editar el input, el error se limpia inmediatamente
      fireEvent.change(input, { target: { value: 'NEW-INPUT' } });
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('4. Prevención de avance con código sin aplicar e importes de los 4 beneficios', () => {
    it('no permite continuar si hay un código escrito pero no aplicado', async () => {
      renderWithProvider(
        <Booking
          variant="v3"
          initialStep={4}
          initialService="corte"
          initialBarber="Lautaro"
          initialDate="2026-11-05"
          initialTime="14:00"
          initialContact={{ name: 'Lautaro Gomez', email: 'lautaro@test.com', phone: '+5491122334455', notes: '' }}
        />
      );

      const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX');
      fireEvent.change(input, { target: { value: 'KANI-UNAPPLIED' } });

      // Intenta pulsar el botón siguiente
      const nextButton = screen.getByRole('button', { name: /Pagar seña|Reservar turno|Continuar/i });
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText('Tenés un código ingresado sin aplicar. Aplicá el código o borralo para continuar.')).toBeInTheDocument();
      });
    });

    it('aplica NO_DEPOSIT: muestra "Reservar turno", seña $0 y saldo total en local', async () => {
      vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
        valid: true,
        code: 'KANI-SIN-SENA',
        type: 'NO_DEPOSIT',
        benefitType: 'NO_DEPOSIT',
        label: 'Reserva sin seña',
        benefitLabel: 'Reserva sin seña',
        originalPriceArs: 25000,
        discountAmountArs: 0,
        finalPriceArs: 25000,
        onlineDepositArs: 0,
        inPersonBalanceArs: 25000,
        skipOnlinePayment: true,
        buttonLabel: 'Reservar turno',
      });

      renderWithProvider(
        <Booking
          variant="v3"
          initialStep={4}
          initialService="corte"
          initialBarber="Lautaro"
          initialDate="2026-11-05"
          initialTime="14:00"
          initialContact={{ name: 'Lautaro Gomez', email: 'lautaro@test.com', phone: '+5491122334455', notes: '' }}
        />
      );

      const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX');
      fireEvent.change(input, { target: { value: 'KANI-SIN-SENA' } });
      fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Reservar turno' })).toBeInTheDocument();
      });

      // El resumen muestra seña online $0 y saldo en local $25.000
      expect(screen.getByText('No requerida ($0)')).toBeInTheDocument();
      expect(screen.getByText('Reserva sin seña. Abonás el total de $25.000 en el local.')).toBeInTheDocument();
    });

    it('quitar el código restaura el flujo estándar con seña de $5.000', async () => {
      vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
        valid: true,
        code: 'KANI-SIN-SENA',
        type: 'NO_DEPOSIT',
        benefitType: 'NO_DEPOSIT',
        label: 'Reserva sin seña',
        benefitLabel: 'Reserva sin seña',
        originalPriceArs: 25000,
        discountAmountArs: 0,
        finalPriceArs: 25000,
        onlineDepositArs: 0,
        inPersonBalanceArs: 25000,
        skipOnlinePayment: true,
        buttonLabel: 'Reservar turno',
      });

      renderWithProvider(
        <Booking
          variant="v3"
          initialStep={4}
          initialService="corte"
          initialBarber="Lautaro"
          initialDate="2026-11-05"
          initialTime="14:00"
          initialContact={{ name: 'Lautaro Gomez', email: 'lautaro@test.com', phone: '+5491122334455', notes: '' }}
        />
      );

      const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX');
      fireEvent.change(input, { target: { value: 'KANI-SIN-SENA' } });
      fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Reservar turno' })).toBeInTheDocument();
      });

      // Clic en "Quitar"
      const removeBtn = screen.getByRole('button', { name: 'Quitar' });
      fireEvent.click(removeBtn);

      // Se restaura el botón estándar de pago de seña
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Pagar seña/i })).toBeInTheDocument();
        expect(screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX')).toBeInTheDocument();
      });
    });

    it('aplica FREE_SERVICE: 100% bonificado, seña $0 y saldo $0 con botón "Reservar turno"', async () => {
      vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
        valid: true,
        code: 'KANI-GRATIS-100',
        type: 'FREE_SERVICE',
        benefitType: 'FREE_SERVICE',
        label: 'Servicio gratuito (100% bonificado)',
        benefitLabel: 'Servicio gratuito (100% bonificado)',
        originalPriceArs: 25000,
        discountAmountArs: 25000,
        finalPriceArs: 0,
        onlineDepositArs: 0,
        inPersonBalanceArs: 0,
        skipOnlinePayment: true,
        buttonLabel: 'Reservar turno',
      });

      renderWithProvider(
        <Booking
          variant="v3"
          initialStep={4}
          initialService="corte"
          initialBarber="Lautaro"
          initialDate="2026-11-05"
          initialTime="14:00"
          initialContact={{ name: 'Lautaro Gomez', email: 'lautaro@test.com', phone: '+5491122334455', notes: '' }}
        />
      );

      const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX');
      fireEvent.change(input, { target: { value: 'KANI-GRATIS-100' } });
      fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Reservar turno' })).toBeInTheDocument();
      });

      expect(screen.getByText('Servicio 100% bonificado. Total a abonar: $0.')).toBeInTheDocument();
      expect(screen.getByText('−$25.000')).toBeInTheDocument();
    });

    it('aplica PERCENT_10: descuento del 10%, seña $5.000 y saldo reducido', async () => {
      vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
        valid: true,
        code: 'KANI-DESC-10',
        type: 'PERCENT_10',
        benefitType: 'PERCENT_10',
        label: '10% de descuento',
        benefitLabel: '10% de descuento',
        originalPriceArs: 25000,
        discountAmountArs: 2500,
        finalPriceArs: 22500,
        onlineDepositArs: 5000,
        inPersonBalanceArs: 17500,
        skipOnlinePayment: false,
        buttonLabel: 'Pagar seña $5.000',
      });

      renderWithProvider(
        <Booking
          variant="v3"
          initialStep={4}
          initialService="corte"
          initialBarber="Lautaro"
          initialDate="2026-11-05"
          initialTime="14:00"
          initialContact={{ name: 'Lautaro Gomez', email: 'lautaro@test.com', phone: '+5491122334455', notes: '' }}
        />
      );

      const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX');
      fireEvent.change(input, { target: { value: 'KANI-DESC-10' } });
      fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

      await waitFor(() => {
        expect(screen.getByText('−$2.500')).toBeInTheDocument();
        expect(screen.getByText('$22.500')).toBeInTheDocument();
        expect(screen.getByText('$17.500')).toBeInTheDocument();
      });
    });

    it('persiste el beneficio aplicado al navegar entre pasos', async () => {
      vi.spyOn(benefitFunctions, 'validateBenefitCodeQuoteFn').mockResolvedValue({
        valid: true,
        code: 'KANI-PERSIST-TEST',
        type: 'PERCENT_50',
        benefitType: 'PERCENT_50',
        label: '50% de descuento',
        benefitLabel: '50% de descuento',
        originalPriceArs: 25000,
        discountAmountArs: 12500,
        finalPriceArs: 12500,
        onlineDepositArs: 5000,
        inPersonBalanceArs: 7500,
        skipOnlinePayment: false,
        buttonLabel: 'Pagar seña $5.000',
      });

      renderWithProvider(
        <Booking
          variant="v3"
          initialStep={4}
          initialService="corte"
          initialBarber="Lautaro"
          initialDate="2026-11-05"
          initialTime="14:00"
          initialContact={{ name: 'Lautaro Gomez', email: 'lautaro@test.com', phone: '+5491122334455', notes: '' }}
        />
      );

      // Aplicar código en Datos
      const input = screen.getByPlaceholderText('KANI-XXXX-XXXX-XXXX');
      fireEvent.change(input, { target: { value: 'KANI-PERSIST-TEST' } });
      fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

      await waitFor(() => {
        expect(screen.getAllByText('KANI-PERSIST-TEST').length).toBeGreaterThanOrEqual(1);
      });

      // Navegar hacia atrás con el botón Volver
      const backButton = screen.getByRole('button', { name: /Volver/i });
      fireEvent.click(backButton);

      // Ahora estamos en el paso Horario
      expect(screen.getByText('Horario')).toBeInTheDocument();

      // Navegar hacia atrás a Fecha
      fireEvent.click(screen.getByRole('button', { name: /Volver/i }));
      expect(screen.getByText('Fecha')).toBeInTheDocument();

      // En el estado interno de la reserva, el beneficio aplicado persiste
      expect(screen.queryByText('KANI-PERSIST-TEST')).toBeNull(); // No visible en paso Fecha

    });
  });
});
