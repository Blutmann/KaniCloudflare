import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { dateLabel } from '@/lib/kani-model';

const api = vi.hoisted(() => ({
  read: vi.fn(),
  create: vi.fn(),
  order: vi.fn(),
  checkout: vi.fn(),
}));

vi.mock('@/components/kani/store', () => ({
  useKani: () => ({ mobileMenuOpen: false, setMobileMenuOpen: vi.fn() }),
}));

vi.mock('@/lib/kani-availability', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/kani-availability')>(),
  readConfiguredServices: async () => [],
  readPublicAvailabilityStarts: (...args: unknown[]) => api.read(...args),
}));

vi.mock('@/lib/kani-appointments', () => ({
  createRealAppointment: (...args: unknown[]) => api.create(...args),
  appointmentErrorMessage: String,
}));

vi.mock('@/lib/kani-mercadopago', () => ({
  getDynamicDownPayment: async () => 5000,
}));

vi.mock('@/lib/kani-down-payment', () => ({
  getDynamicDownPayment: async () => 5000,
}));

vi.mock('@/lib/kani-mercadopago.functions', () => ({
  createBookingOrderFn: (...args: unknown[]) => api.order(...args),
}));

import { Booking } from '@/components/kani/booking';

const originalLocation = window.location;
const fixtures = ['2026-10-26', '2026-10-27'].flatMap(slot_date =>
  ['Lautaro', 'Gonzalo'].flatMap(barber_name =>
    ['10:00', '11:30', '12:15'].map(start_time => ({
      barber_id: barber_name,
      barber_name,
      slot_date,
      start_time,
      is_exception: false,
      compatible_services: ['Corte', 'Barba', 'Corte y barba'],
    }))
  )
);

function next() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Continuar' }).find(button => !button.hidden)!);
}

async function selectServiceAndBarberV3(deferred = false) {
  render(<Booking variant="v3" />);
  fireEvent.click(screen.getByRole('button', { name: /^Corte 45/ }));
  next();
  fireEvent.click(screen.getByRole('button', { name: deferred ? /Elegir más adelante/ : /Lautaro/ }));
  await waitFor(() => expect(api.read).toHaveBeenCalled());
  next();
  await screen.findByRole('button', { name: dateLabel('2026-10-26') });
}

function chooseTime() {
  fireEvent.click(screen.getByRole('button', { name: '10:00' }));
}

async function fillContactV3() {
  await screen.findByRole('textbox', { name: /^Nombre/ });
  fireEvent.change(screen.getByRole('textbox', { name: /^Nombre/ }), { target: { value: 'Cliente Reserva V3' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^Email/ }), { target: { value: 'cliente.v3@example.test' } });
  fireEvent.change(await screen.findByPlaceholderText('11 2345-6789'), { target: { value: '1128436014' } });
}

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
  api.read.mockReset().mockResolvedValue(fixtures);
  api.create.mockReset().mockResolvedValue({ appointment_id: 'v3-fixture-id', request_number: 103 });
  api.order.mockReset().mockResolvedValue({ success: true, checkoutUrl: 'https://payments.example.test/checkout-v3' });
  api.checkout.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: { search: '', assign: api.checkout } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('Reserva V3 — 5-step booking flow', () => {
  it('displays 5 steps in the stepper with correct labels and isolated date/time steps', async () => {
    render(<Booking variant="v3" />);
    const progress = screen.getByLabelText('Paso 1 de 5: Servicio');
    expect(progress).toBeInTheDocument();

    const buttons = within(progress).getAllByRole('button');
    expect(buttons).toHaveLength(5);
    expect(buttons[0]).toHaveTextContent('Servicio');
    expect(buttons[1]).toHaveTextContent('Barbero');
    expect(buttons[2]).toHaveTextContent('Fecha');
    expect(buttons[3]).toHaveTextContent('Horario');
    expect(buttons[4]).toHaveTextContent('Datos');

    // Step 1: Servicio
    expect(screen.getByRole('heading', { name: 'Elegí un servicio' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Corte 45/ }));
    next();

    // Step 2: Barbero
    expect(screen.getByRole('heading', { name: 'Elegí un barbero' })).toBeInTheDocument();
    expect(screen.getByLabelText('Paso 2 de 5: Barbero')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Lautaro/ }));
    await waitFor(() => expect(api.read).toHaveBeenCalled());
    next();

    // Step 3: Fecha (Paso 3 de 5)
    expect(screen.getByLabelText('Paso 3 de 5: Fecha')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Elegí una fecha' })).toBeInTheDocument();
    // In Step 3, time slots MUST NOT be rendered
    expect(screen.queryByRole('group', { name: 'Horarios disponibles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Elegí un horario' })).not.toBeInTheDocument();
    expect(screen.getByText('Atendemos de lunes a sábado de 10 a 20 hs.')).toBeInTheDocument();

    // Select date and continue to Horario
    fireEvent.click(screen.getByRole('button', { name: dateLabel('2026-10-26') }));
    next();

    // Step 4: Horario (Paso 4 de 5)
    expect(screen.getByLabelText('Paso 4 de 5: Horario')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Elegí un horario' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Horarios disponibles' })).toBeInTheDocument();
    // Monthly calendar MUST NOT be rendered in Step 4
    expect(document.querySelector('.calendar-panel')).toBeNull();

    // Single date reference under Elegí un horario: formatted as "Lunes 26/10"
    expect(screen.getByText('Lunes 26/10')).toBeInTheDocument();
    // NO duplicate date pill and NO Cambiar button
    expect(screen.queryByRole('button', { name: /Cambiar/ })).not.toBeInTheDocument();
    expect(document.querySelector('.booking-v3-date-pill')).toBeNull();

    // Continuar is disabled until slot is picked
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    chooseTime();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    next();

    // Step 5: Datos (Paso 5 de 5)
    expect(screen.getByLabelText('Paso 5 de 5: Datos')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Completá tus datos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pagar seña' })).toBeInTheDocument();
    // Summary card displays "Lunes 26/10"
    expect(screen.getByText('Lunes 26/10')).toBeInTheDocument();
  });

  it('resets selected time when changing date in Step 3 and preserves navigation history', async () => {
    await selectServiceAndBarberV3();

    // Step 3: Fecha
    fireEvent.click(screen.getByRole('button', { name: dateLabel('2026-10-26') }));
    next();

    // Step 4: Horario
    chooseTime();
    expect(screen.getByRole('button', { name: '10:00' })).toHaveAttribute('aria-pressed', 'true');
    next();

    // Step 5: Datos
    await fillContactV3();

    // Return to Step 4 (Horario)
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.getByRole('heading', { name: 'Elegí un horario' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '10:00' })).toHaveAttribute('aria-pressed', 'true');

    // Return to Step 3 (Fecha)
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.getByRole('heading', { name: 'Elegí una fecha' })).toBeInTheDocument();

    // Change date to 2026-10-27
    fireEvent.click(screen.getByRole('button', { name: dateLabel('2026-10-27') }));
    next();

    // In Step 4: Previous time 10:00 is reset / not preselected
    expect(screen.getByRole('heading', { name: 'Elegí un horario' })).toBeInTheDocument();
    expect(screen.getByText('Martes 27/10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '10:00' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();

    // Choose time for the new date and advance to Step 5
    chooseTime();
    next();

    // Step 5: Contact info entered before must be preserved!
    expect(screen.getByRole('heading', { name: 'Completá tus datos' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Nombre/ })).toHaveValue('Cliente Reserva V3');
    expect(screen.getByRole('textbox', { name: /^Email/ })).toHaveValue('cliente.v3@example.test');
    expect(screen.getByText('Martes 27/10')).toBeInTheDocument();
  });

  it('handles deferred barber choice during Step 4 (Horario)', async () => {
    await selectServiceAndBarberV3(true);

    // Step 3: Fecha
    fireEvent.click(screen.getByRole('button', { name: dateLabel('2026-10-26') }));
    next();

    // Step 4: Horario
    chooseTime();
    // Continuar disabled until barber is picked from candidate list
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    expect(screen.getByText('¿Quién te va a atender?')).toBeInTheDocument();

    fireEvent.click(within(screen.getByText('¿Quién te va a atender?').parentElement!).getByRole('button', { name: 'Gonzalo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled());

    next();
    await screen.findByRole('heading', { name: 'Completá tus datos' });
    expect(screen.getByText('Gonzalo')).toBeInTheDocument();
  });

  it('submits Mercado Pago order from Step 5 with $5.000 seña and redirects correctly', async () => {
    await selectServiceAndBarberV3();
    fireEvent.click(screen.getByRole('button', { name: dateLabel('2026-10-26') }));
    next();
    chooseTime();
    next();
    await fillContactV3();

    const payButton = screen.getByRole('button', { name: 'Pagar seña' });
    expect(payButton).toBeEnabled();
    fireEvent.click(payButton);

    await waitFor(() => {
      expect(api.create).toHaveBeenCalledWith({
        barber: 'Lautaro',
        serviceName: 'Corte',
        date: '2026-10-26',
        time: '10:00',
        name: 'Cliente Reserva V3',
        phone: '+5491128436014',
        email: 'cliente.v3@example.test',
        notes: '',
      });
    });

    await waitFor(() => {
      expect(api.order).toHaveBeenCalledWith({
        data: {
          appointmentId: 'v3-fixture-id',
          serviceName: 'Corte',
          barberName: 'Lautaro',
          servicePrice: 25000,
          clientName: 'Cliente Reserva V3',
          clientEmail: 'cliente.v3@example.test',
          clientPhone: '+5491128436014',
        },
      });
    });

    await waitFor(() => {
      expect(api.checkout).toHaveBeenCalledWith('https://payments.example.test/checkout-v3');
    });
  });

  it('allows returning from Step 4 (Horario) to Step 3 (Fecha) via Volver button without duplicate Cambiar link', async () => {
    await selectServiceAndBarberV3();
    fireEvent.click(screen.getByRole('button', { name: dateLabel('2026-10-26') }));
    next();

    expect(screen.getByRole('heading', { name: 'Elegí un horario' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cambiar/ })).not.toBeInTheDocument();

    const backBtn = screen.getByRole('button', { name: 'Volver' });
    fireEvent.click(backBtn);

    expect(screen.getByRole('heading', { name: 'Elegí una fecha' })).toBeInTheDocument();
  });

  it('verifies that Reserva V3 CSS rules meet visual and desktop width requirements', () => {
    const cssPath = 'src/components/kani/experimental/reserva-v3.css';
    const css = fs.readFileSync(cssPath, 'utf8');

    // Stepper 5 columns and 23px mobile circles
    expect(css).toMatch(/grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/width:\s*23px\s*!important/);

    // Desktop calendar full content width (100%)
    expect(css).toMatch(/\.booking-v3-date\s+\.calendar-panel\s*\{[^}]*width:\s*100%;\s*max-width:\s*100%;/);

    // Desktop time grid full content width (100%)
    expect(css).toMatch(/\.booking-v3-times\s*\{[^}]*width:\s*100%;\s*max-width:\s*100%;/);

    // Time grid 3 columns in mobile
    expect(css).toMatch(/\.booking-v3-times\s+\.booking-time-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);

    // Time grid 5 columns on desktop
    expect(css).toMatch(/grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);

    // Observaciones textarea reduced height in mobile (~52px)
    expect(css).toMatch(/min-height:\s*52px\s*!important/);

    // Clear separation between form and summary
    expect(css).toMatch(/\.booking-v3\s+\.booking-v2-final-layout\s*\{[^}]*gap:\s*28px/);

    // Separation between appointment details and financial details
    expect(css).toMatch(/\.booking-v3\s+\.summary-pricing-card\s*\{[^}]*border-top:\s*1px\s*solid/);

    // Step 4 heading and date in the same row (flex-direction: row, space-between, align-items: center)
    expect(css).toMatch(/\.booking-v3\s+\.booking-time-heading\s*\{[^}]*flex-direction:\s*row\s*!important/);
    expect(css).toMatch(/\.booking-v3\s+\.booking-time-heading\s*\{[^}]*justify-content:\s*space-between\s*!important/);
    expect(css).toMatch(/\.booking-v3\s+\.booking-time-heading\s*\{[^}]*align-items:\s*center\s*!important/);
    expect(css).toMatch(/\.booking-v3\s+\.booking-time-heading-date\s*\{[^}]*margin-left:\s*auto/);
  });
});
