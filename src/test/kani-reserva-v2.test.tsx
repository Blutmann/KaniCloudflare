import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { dateLabel } from '@/lib/kani-model';

const api = vi.hoisted(() => ({
  read: vi.fn(), create: vi.fn(), order: vi.fn(), checkout: vi.fn(),
}));
vi.mock('@/components/kani/store', () => ({ useKani: () => ({ mobileMenuOpen: false, setMobileMenuOpen: vi.fn() }) }));
vi.mock('@/lib/kani-availability', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/kani-availability')>(),
  readConfiguredServices: async () => [],
  readPublicAvailabilityStarts: (...args: unknown[]) => api.read(...args),
}));
vi.mock('@/lib/kani-appointments', () => ({ createRealAppointment: (...args: unknown[]) => api.create(...args), appointmentErrorMessage: String }));
vi.mock('@/lib/kani-mercadopago', () => ({ getDynamicDownPayment: async () => 5000 }));
vi.mock('@/lib/kani-mercadopago.functions', () => ({ createBookingOrderFn: (...args: unknown[]) => api.order(...args) }));
import { Booking } from '@/components/kani/booking';

const originalLocation = window.location;
const fixtures = ['2026-10-26', '2026-10-27'].flatMap(slot_date =>
  ['Lautaro', 'Gonzalo'].flatMap(barber_name => ['10:00', '11:30', '12:15'].map(start_time => ({
    barber_id: barber_name, barber_name, slot_date, start_time, is_exception: false,
    compatible_services: ['Corte', 'Barba', 'Corte y barba'],
  }))),
);
function next() { fireEvent.click(screen.getAllByRole('button', { name: 'Continuar' }).find(button => !button.hidden)!); }
async function selectServiceAndBarber(combined = true, deferred = false) {
  render(<Booking combinedDateTime={combined} />);
  fireEvent.click(screen.getByRole('button', { name: /^Corte 45/ }));
  next();
  fireEvent.click(screen.getByRole('button', { name: deferred ? /Elegir más adelante/ : /Lautaro/ }));
  await waitFor(() => expect(api.read).toHaveBeenCalled());
  next();
  await screen.findByRole('button', { name: dateLabel('2026-10-26') });
}
function chooseTime() { fireEvent.click(screen.getByRole('button', { name: '10:00' })); }
async function fillContact(combined = true) {
  await screen.findByRole('textbox', { name: /^Nombre/ });
  fireEvent.change(screen.getByRole('textbox', { name: /^Nombre/ }), { target: { value: 'Cliente de prueba' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^Email/ }), { target: { value: 'cliente@example.test' } });
  fireEvent.change(screen.getByPlaceholderText('11 2345-6789'), { target: { value: '1128436014' } });
  if (!combined) { next(); await screen.findByRole('heading', { name: 'Resumen' }); }
}
beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
  api.read.mockReset().mockResolvedValue(fixtures);
  api.create.mockReset().mockResolvedValue({ appointment_id: 'fixture-id', request_number: 42 });
  api.order.mockReset().mockResolvedValue({ success: true, checkoutUrl: 'https://payments.example.test/checkout' });
  api.checkout.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: { search: '', assign: api.checkout } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); Object.defineProperty(window, 'location', { configurable: true, value: originalLocation }); });

describe('isolated four-stage booking presentation', () => {
  it('combines date/time, resets a changed date, and preserves a valid selection when returning from contact', async () => {
    await selectServiceAndBarber();
    expect(screen.getByLabelText('Paso 3 de 4: Fecha y horario')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Elegir una fecha' })).toBeInTheDocument();
    expect(screen.queryByText('Atendemos de lunes a sábado de 10 a 20 hs.')).not.toBeInTheDocument();
    expect(document.querySelector('.booking-v2-selected-date')).toBeNull();
    expect(screen.queryByText(/horarios disponibles/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Elegir un horario' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Elegí una fecha y horario' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Horarios disponibles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    chooseTime();
    fireEvent.click(screen.getByRole('button', { name: dateLabel('2026-10-27') }));
    expect(screen.getByRole('button', { name: '10:00' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    chooseTime(); next();
    await screen.findByRole('heading', { name: 'Completá tus datos' });
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.getByRole('button', { name: dateLabel('2026-10-27') })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '10:00' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Paso 3 de 4: Fecha y horario')).toBeInTheDocument();
  });

  it('requires the deferred barber choice as well as a date and time', async () => {
    await selectServiceAndBarber(true, true);
    chooseTime();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    fireEvent.click(within(screen.getByText('¿Quién te va a atender?').parentElement!).getByRole('button', { name: 'Gonzalo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: dateLabel('2026-10-27') }));
    expect(screen.queryByText('¿Quién te va a atender?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it.each([false, true])('keeps future stages disabled and allows revisiting service with combined=%s', async combined => {
    render(<Booking combinedDateTime={combined} />);
    const progress = screen.getByLabelText(`Paso 1 de ${combined ? 4 : 6}: Servicio`);
    expect(within(progress).getByRole('button', { name: /Barbero/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Corte 45/ })); next();
    fireEvent.click(within(progress).getByRole('button', { name: /Servicio/ }));
    expect(screen.getByRole('heading', { name: 'Elegí un servicio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Corte 45/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows no empty time card before a date is available', async () => {
    api.read.mockResolvedValue([]);
    await selectServiceAndBarber();
    expect(screen.queryByRole('heading', { name: 'Elegir un horario' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Horarios disponibles' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('returns to the combined screen if the selected time expires before submission', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    await selectServiceAndBarber(); chooseTime(); next(); await fillContact();
    await act(async () => {
      vi.setSystemTime(new Date('2026-10-26T13:30:00Z'));
      vi.advanceTimersByTime(30_000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));
    expect(screen.getByLabelText('Paso 3 de 4: Fecha y horario')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Ese horario ya no está disponible');
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it.each([false, true])('submits identical appointment/payment inputs with combined=%s and preserves the original stage count', async combined => {
    await selectServiceAndBarber(combined);
    if (!combined) {
      expect(screen.getByLabelText('Paso 3 de 6: Fecha')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '10:00' })).not.toBeInTheDocument();
      next();
      expect(screen.getByLabelText('Paso 4 de 6: Horario')).toBeInTheDocument();
    }
    chooseTime(); next(); await fillContact(combined);
    expect(screen.getByLabelText(`Paso ${combined ? 4 : 6} de ${combined ? 4 : 6}: ${combined ? 'Datos' : 'Resumen'}`)).toBeInTheDocument();
    expect(screen.getByText('Fecha', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('Horario', { selector: 'dt' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith('https://payments.example.test/checkout'));
    expect(api.create).toHaveBeenCalledExactlyOnceWith({
      barber: 'Lautaro', serviceName: 'Corte', date: '2026-10-26', time: '10:00',
      name: 'Cliente de prueba', email: 'cliente@example.test', phone: '+5491128436014', notes: '',
    });
    expect(api.order).toHaveBeenCalledExactlyOnceWith({ data: {
      appointmentId: 'fixture-id', serviceName: 'Corte', barberName: 'Lautaro', servicePrice: 25000,
      clientName: 'Cliente de prueba', clientEmail: 'cliente@example.test', clientPhone: '+5491128436014',
    } });
  });
  it('keeps contact data while editing the time and updates the integrated review', async () => {
    await selectServiceAndBarber(); chooseTime(); next(); await fillContact();
    expect(screen.getByLabelText('Paso 4 de 4: Datos')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Resumen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuar' })).not.toBeInTheDocument();
    expect(screen.queryByText('Duración', { selector: 'dt' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.booking-v2-unified-summary dt')).toHaveLength(7);
    expect(screen.queryByRole('heading', { name: 'Pago' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tu turno' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.booking-v2-unified-summary')).toHaveLength(1);
    expect(document.querySelector('.booking-v2-unified-summary .booking-summary-card')).toBeNull();
    expect(screen.getByText('Tu turno se confirma únicamente cuando abonas la seña')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    fireEvent.click(screen.getByRole('button', { name: '11:30', exact: true })); next();
    expect(screen.getByRole('textbox', { name: /^Nombre/ })).toHaveValue('Cliente de prueba');
    expect(screen.getByRole('textbox', { name: /^Email/ })).toHaveValue('cliente@example.test');
    expect(screen.getByText('11:30', { selector: 'dd' })).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pagar seña' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ time: '11:30' })));
  });

  it('does not start payment with incomplete contact data or on form submit', async () => {
    await selectServiceAndBarber(); chooseTime(); next();
    expect(screen.getByRole('button', { name: 'Pagar seña' })).toBeDisabled();
    const name = await screen.findByRole('textbox', { name: /^Nombre/ });
    fireEvent.submit(name.closest('form')!);
    expect(api.create).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Paso 4 de 4: Datos')).toBeInTheDocument();
    await fillContact();
    fireEvent.submit(name.closest('form')!);
    expect(api.create).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Pagar seña' })).toBeEnabled();
  });

  it.each(['service', 'barber', 'date'])('preserves contact data and refreshes the review after editing %s', async field => {
    await selectServiceAndBarber(); chooseTime(); next(); await fillContact();
    const progress = screen.getByLabelText('Paso 4 de 4: Datos');
    if (field === 'service') {
      fireEvent.click(within(progress).getByRole('button', { name: /Servicio/ }));
      fireEvent.click(screen.getByRole('button', { name: /^Barba/ })); next(); next();
    } else if (field === 'barber') {
      fireEvent.click(within(progress).getByRole('button', { name: /Barbero/ }));
      fireEvent.click(screen.getByRole('button', { name: /Gonzalo/ })); next();
    } else {
      fireEvent.click(within(progress).getByRole('button', { name: /Fecha y horario/ }));
      fireEvent.click(screen.getByRole('button', { name: dateLabel('2026-10-27') }));
    }
    await screen.findByRole('button', { name: '10:00' }); chooseTime(); next();
    expect(screen.getByRole('textbox', { name: /^Nombre/ })).toHaveValue('Cliente de prueba');
    expect(screen.getByRole('textbox', { name: /^Email/ })).toHaveValue('cliente@example.test');
    expect(screen.getByRole('button', { name: 'Pagar seña' })).toBeEnabled();
    const expected = field === 'service' ? 'Barba' : field === 'barber' ? 'Gonzalo' : dateLabel('2026-10-27');
    expect(screen.getByText(expected, { selector: 'dd' })).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('applies 66px stepper height with 13px labels and Fecha/Hora single line in mobile', () => {
    const css = fs.readFileSync('src/components/kani/experimental/reserva-v2.css', 'utf8');
    expect(css).toMatch(/\.booking-page\.booking-v2\s*\.booking-progress\s*\{[^}]*height:\s*66px/);
    expect(css).toMatch(/\.booking-page\.booking-v2\s*\.booking-progress\s*>\s*button\s*\{[^}]*height:\s*66px/);
    expect(css).toMatch(/\.booking-page\.booking-v2\s*\.booking-progress\s*>\s*button\s*\{[^}]*min-height:\s*66px/);
    expect(css).toMatch(/\.booking-page\.booking-v2\s*\.booking-progress\s*small\s*\{[^}]*font-size:\s*13px/);
    expect(css).toMatch(/\.booking-page\.booking-v2\s*\.booking-progress\s*small\s*\{[^}]*white-space:\s*nowrap/);
  });

  it('applies 48px height and 12px font-size to mobile contact inputs, placeholders, and phone trigger', () => {
    const css = fs.readFileSync('src/components/kani/experimental/reserva-v2.css', 'utf8');
    expect(css).toMatch(/main\.booking-page\.booking-v2\.booking-v2-final\s*\.booking-contact-form\s*input[^{]*\{[^}]*font-size:\s*12px\s*!important/);
    expect(css).toMatch(/main\.booking-page\.booking-v2\.booking-v2-final\s*\.booking-contact-form\s*input[^{]*\{[^}]*height:\s*48px\s*!important/);
    expect(css).toMatch(/\.booking-v2-final\s*\.booking-contact-form\s*\.phone-country-trigger\s*\{[^}]*height:\s*48px\s*!important/);
    expect(css).toMatch(/\.booking-v2-final\s*\.booking-contact-form\s*\.phone-country-trigger\s*\{[^}]*font-size:\s*12px\s*!important/);
    expect(css).toMatch(/main\.booking-page\.booking-v2\.booking-v2-final\s*\.booking-contact-form\s*:is\(input,\s*textarea\)::placeholder\s*\{[^}]*font-size:\s*12px\s*!important/);
    expect(css).toMatch(/main\.booking-page\.booking-v2\.booking-v2-final\s*\.booking-contact-form\s*input:-webkit-autofill[^{]*\{[^}]*font-size:\s*12px\s*!important/);
  });

});
