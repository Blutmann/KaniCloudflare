import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
async function fillContact() {
  await screen.findByRole('textbox', { name: /^Nombre/ });
  fireEvent.change(screen.getByRole('textbox', { name: /^Nombre/ }), { target: { value: 'Cliente de prueba' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^Email/ }), { target: { value: 'cliente@example.test' } });
  fireEvent.change(screen.getByPlaceholderText('11 2345-6789'), { target: { value: '1128436014' } });
  next();
  await screen.findByRole('heading', { name: 'Resumen' });
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

describe('isolated five-stage booking presentation', () => {
  it('combines date/time, resets a changed date, and preserves a valid selection when returning from contact', async () => {
    await selectServiceAndBarber();
    expect(screen.getByLabelText('Paso 3 de 5: Fecha y horario')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Elegí una fecha' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Elegí un horario' })).toBeInTheDocument();
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
    expect(screen.getByLabelText('Paso 3 de 5: Fecha y horario')).toBeInTheDocument();
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
    const progress = screen.getByLabelText(`Paso 1 de ${combined ? 5 : 6}: Servicio`);
    expect(within(progress).getByRole('button', { name: /Barbero/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Corte 45/ })); next();
    fireEvent.click(within(progress).getByRole('button', { name: /Servicio/ }));
    expect(screen.getByRole('heading', { name: 'Elegí un servicio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Corte 45/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows no empty time card before a date is available', async () => {
    api.read.mockResolvedValue([]);
    await selectServiceAndBarber();
    expect(screen.queryByRole('heading', { name: 'Elegí un horario' })).not.toBeInTheDocument();
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
    expect(screen.getByLabelText('Paso 3 de 5: Fecha y horario')).toBeInTheDocument();
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
    chooseTime(); next(); await fillContact();
    expect(screen.getByLabelText(`Paso ${combined ? 5 : 6} de ${combined ? 5 : 6}: Resumen`)).toBeInTheDocument();
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
});
