import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { businessDateToday, addCalendarDays, startOfBusinessWeek } from '@/lib/kani-mobile-appointments';
import { formatRangeLabel, dateLabel } from '@/lib/kani-model';

const today = businessDateToday();
const mondayOfWeek = startOfBusinessWeek(today);
const sundayOfWeek = addCalendarDays(mondayOfWeek, 6);
const tenDaysEnd = addCalendarDays(today, 9);
const pastDate = '2026-08-15';
const pastDateAugustStart = '2026-08-01';
const pastDateAugustEnd = '2026-08-31';

const sampleAppointments = [
  {
    id: 'apt-today',
    barberId: 'b1',
    date: today,
    statusCode: 'CONFIRMED' as const,
    time: '10:00',
    name: 'Cliente Hoy',
    phone: '+54 9 11 1111-1111',
    serviceName: 'Corte',
    barber: 'Lautaro',
  },
  {
    id: 'apt-week',
    barberId: 'b1',
    date: mondayOfWeek,
    statusCode: 'CONFIRMED' as const,
    time: '11:00',
    name: 'Cliente Esta Semana',
    phone: '+54 9 11 2222-2222',
    serviceName: 'Barba',
    barber: 'Lautaro',
  },
  {
    id: 'apt-ten-days',
    barberId: 'b1',
    date: tenDaysEnd,
    statusCode: 'CONFIRMED' as const,
    time: '14:00',
    name: 'Cliente Próximos 10 Días',
    phone: '+54 9 11 3333-3333',
    serviceName: 'Corte',
    barber: 'Lautaro',
  },
  {
    id: 'apt-past',
    barberId: 'b1',
    date: pastDate,
    statusCode: 'CONFIRMED' as const,
    time: '16:00',
    name: 'Cliente Pasado Histórico',
    phone: '+54 9 11 4444-4444',
    serviceName: 'Corte y barba',
    barber: 'Gonzalo',
  },
];

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    barbers: [
      { id: 'b1', name: 'Lautaro' },
      { id: 'b2', name: 'Gonzalo' },
    ],
    profile: { role: 'ADMIN', barber_id: null },
  }),
}));

vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => ({
    barberId: 'ALL',
    setBarberId: vi.fn(),
    barbers: [],
    depositSupported: true,
    refresh: vi.fn(),
    appointments: sampleAppointments,
  }),
}));

vi.mock('@/lib/kani-appointments', () => ({
  updateRealAppointmentStatus: vi.fn(),
  appointmentErrorMessage: String,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: any) => <a>{children}</a>,
}));

import { V2Appointments } from '@/components/kani/v2/agenda';

afterEach(() => {
  cleanup();
});

describe('formatRangeLabel helper', () => {
  it('formats single day as dateLabel', () => {
    expect(formatRangeLabel('2026-10-27', '2026-10-27')).toBe(dateLabel('2026-10-27'));
  });

  it('formats Esta semana correctly (e.g. 26 oct. – 1 nov.)', () => {
    const formatted = formatRangeLabel('2026-10-26', '2026-11-01');
    expect(formatted).toMatch(/26 oct\. – 1 nov\./);
  });

  it('formats Próximos 10 días correctly (e.g. 27 oct. – 5 nov.)', () => {
    const formatted = formatRangeLabel('2026-10-27', '2026-11-05');
    expect(formatted).toMatch(/27 oct\. – 5 nov\./);
  });

  it('formats Personalizado with year (e.g. 1 ago. – 31 ago. 2026)', () => {
    const formatted = formatRangeLabel('2026-08-01', '2026-08-31', true);
    expect(formatted).toMatch(/1 ago\. – 31 ago\. 2026/);
  });

  it('formats cross-year range with both years', () => {
    const formatted = formatRangeLabel('2025-12-15', '2026-01-15', true);
    expect(formatted).toMatch(/15 dic\. 2025 – 15 ene\. 2026/);
  });
});

describe('V2Appointments periods and historical queries', () => {
  it('renders default Hoy view with title group and exact period options', () => {
    const { container } = render(<V2Appointments />);

    // Header has title group class for vertical spacing
    const titleGroup = container.querySelector('.v2-appointments-title-group');
    expect(titleGroup).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(dateLabel(today));

    // Selector Período has exact options in exact order
    const periodSelect = screen.getByLabelText('Período') as HTMLSelectElement;
    const optionTexts = Array.from(periodSelect.options)
      .filter((opt) => !opt.hidden)
      .map((opt) => opt.text);

    expect(optionTexts).toEqual([
      'Hoy',
      'Esta semana',
      'Próximos 10 días',
      'Personalizado',
    ]);

    // Shows appointments for today
    expect(screen.getByText('Cliente Hoy')).toBeInTheDocument();
  });

  it('filters Esta semana (Monday to Sunday) when selecting Esta semana', () => {
    render(<V2Appointments />);
    const periodSelect = screen.getByLabelText('Período');
    fireEvent.change(periodSelect, { target: { value: 'THIS_WEEK' } });

    // Expect week header
    const expectedHeader = formatRangeLabel(mondayOfWeek, sundayOfWeek);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(expectedHeader);

    // Cliente Esta Semana should be present
    expect(screen.getByText('Cliente Esta Semana')).toBeInTheDocument();
  });

  it('filters Próximos 10 días when selecting Próximos 10 días', () => {
    render(<V2Appointments />);
    const periodSelect = screen.getByLabelText('Período');
    fireEvent.change(periodSelect, { target: { value: 'NEXT_10_DAYS' } });

    // Expect 10-day header
    const expectedHeader = formatRangeLabel(today, tenDaysEnd);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(expectedHeader);

    // Should include appointment on the 10th day
    expect(screen.getByText('Cliente Próximos 10 Días')).toBeInTheDocument();
  });

  it('allows querying custom range in the past (historical queries) via Personalizado', () => {
    render(<V2Appointments />);
    const periodSelect = screen.getByLabelText('Período');
    fireEvent.change(periodSelect, { target: { value: 'CUSTOM' } });

    // Controls Desde and Hasta appear
    const desdeInput = screen.getByLabelText('Desde');
    const hastaInput = screen.getByLabelText('Hasta');
    expect(desdeInput).toBeInTheDocument();
    expect(hastaInput).toBeInTheDocument();

    // Query August 2026
    fireEvent.change(desdeInput, { target: { value: pastDateAugustStart } });
    fireEvent.change(hastaInput, { target: { value: pastDateAugustEnd } });

    // Header updates to historical range with year
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      formatRangeLabel(pastDateAugustStart, pastDateAugustEnd, true),
    );

    // Historical appointment in August is shown
    expect(screen.getByText('Cliente Pasado Histórico')).toBeInTheDocument();
  });

  it('validates Desde <= Hasta and provides feedback without breaking', () => {
    render(<V2Appointments />);
    const periodSelect = screen.getByLabelText('Período');
    fireEvent.change(periodSelect, { target: { value: 'CUSTOM' } });

    const desdeInput = screen.getByLabelText('Desde');
    const hastaInput = screen.getByLabelText('Hasta');

    // Invalid range: Desde after Hasta
    fireEvent.change(desdeInput, { target: { value: '2026-09-01' } });
    fireEvent.change(hastaInput, { target: { value: '2026-08-01' } });

    expect(screen.getByRole('alert')).toHaveTextContent(
      "La fecha 'Desde' debe ser anterior o igual a 'Hasta'.",
    );
    expect(
      screen.getByText("Revisá el rango seleccionado: la fecha 'Desde' debe ser anterior o igual a 'Hasta'."),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Rango no válido');
    expect(screen.getByText('0 turnos')).toBeInTheDocument();
  });

  it('allows querying a concrete historical day via Fecha selector', () => {
    render(<V2Appointments />);
    const fechaInput = screen.getByLabelText('Fecha');

    // User chooses past date in Fecha
    fireEvent.change(fechaInput, { target: { value: pastDate } });

    // Header reflects concrete date
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(dateLabel(pastDate));

    // Shows appointment for that date
    expect(screen.getByText('Cliente Pasado Histórico')).toBeInTheDocument();

    // Resetting via Período 'Hoy' returns to today cleanly
    const periodSelect = screen.getByLabelText('Período');
    fireEvent.change(periodSelect, { target: { value: 'TODAY' } });

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(dateLabel(today));
    expect((screen.getByLabelText('Fecha') as HTMLInputElement).value).toBe(today);
  });
});
