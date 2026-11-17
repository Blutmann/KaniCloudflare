import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingConfirmedScreen } from '@/components/kani/booking-confirmed-screen';

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
  readPublicAvailabilityStarts: async () => [],
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

describe('V12.47.24 · Booking Confirmation — Footer Navigation & UX Writing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
    Element.prototype.scrollTo = vi.fn();
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.localStorage.clear();
    document.documentElement.style.removeProperty('--booking-cta-height');
  });

  it('reutiliza la estructura .booking-page / .booking-cta / .booking-next-button con el copy "Reservar otro turno"', () => {
    const { container } = render(
      <BookingConfirmedScreen
        confirmed={{
          appointmentId: 'apt-v12-47-24',
          serviceName: 'Corte',
          barber: 'Lautaro',
          date: '2026-11-22',
          time: '10:00',
          servicePriceArs: 25000,
          depositArs: 5000,
        }}
        onHomeClick={vi.fn()}
      />,
    );

    expect(container.querySelector('.booking-page.kani-confirmed-booking-page')).toBeTruthy();
    expect(container.querySelector('.booking-scroll-content.kani-confirmed-scroll-content')).toBeTruthy();
    const cta = container.querySelector('.booking-cta.kani-confirmed-cta');
    expect(cta).toBeTruthy();
    const inner = cta?.querySelector('.booking-cta-inner');
    expect(inner).toBeTruthy();

    const btn = screen.getByRole('button', { name: 'Reservar otro turno' });
    expect(btn).toHaveClass('booking-next-button', 'kani-confirmed-home-btn');
    expect(screen.queryByRole('button', { name: 'Volver al inicio' })).not.toBeInTheDocument();
  });

  it('al pulsar "Reservar otro turno" vuelve al inicio del flujo de servicios sin reutilizar datos previos', async () => {
    window.sessionStorage.setItem(
      'kani:payway:confirmed-booking',
      JSON.stringify({
        appointmentId: 'apt-prev-1',
        serviceName: 'Corte y Barba',
        barber: 'Gonzalo',
        date: '2026-11-22',
        time: '11:30',
        clientName: 'Juan Pérez',
        servicePriceArs: 32000,
        depositArs: 5000,
      }),
    );

    render(<PaywayBooking homeUrl="/reservar" />);

    expect(await screen.findByRole('heading', { name: '¡Turno confirmado!' })).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Reservar otro turno' });
    fireEvent.click(btn);

    // Regresa a la selección de servicios (paso 0)
    expect(await screen.findByRole('button', { name: /^Corte,/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '¡Turno confirmado!' })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem('kani:payway:confirmed-booking')).toBeNull();
  });

  it('V12.47.26.2: no reserva espacio de stepper en .kani-confirmed-scroll-content y compacta la fila fecha/horario', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const css = fs.readFileSync(
      path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css'),
      'utf8',
    );
    expect(css).toMatch(/\.booking-scroll-content\.kani-confirmed-scroll-content[\s\S]*?padding-top:\s*78px\s*!important;/);
    expect(css).toMatch(/\.booking-scroll-content\.kani-confirmed-scroll-content[\s\S]*?padding-top:\s*0\s*!important;/);

    const { container } = render(
      <BookingConfirmedScreen
        confirmed={{
          appointmentId: 'apt-v12-47-26-2',
          serviceName: 'Corte y barba',
          barber: 'Lautaro',
          date: '2026-11-22',
          time: '14:30',
          servicePriceArs: 30000,
          depositArs: 0,
          benefitType: 'FREE_SERVICE',
          inPersonBalanceArs: 0,
        }}
        onHomeClick={vi.fn()}
      />,
    );

    expect(container.querySelector('.kani-confirmed-date-text')).toBeTruthy();
    expect(container.querySelector('.kani-confirmed-time-pill')).toBeTruthy();
    expect(screen.getByText('Sin saldo pendiente')).toBeInTheDocument();
  });
});
