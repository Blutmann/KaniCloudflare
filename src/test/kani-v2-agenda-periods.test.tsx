import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { businessDateToday, addCalendarDays, startOfBusinessWeek } from '@/lib/kani-mobile-appointments';
import { formatRangeLabel, dateLabel, formatAdminV2Date, formatAdminV2Range } from '@/lib/kani-model';

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

import { formatV2AgendaPeriodLabel } from '@/lib/kani-mobile-appointments';

describe('V2Appointments periods and historical queries', () => {
  it('renders default Próximos 10 días view with title group and exact 9 period options', () => {
    window.localStorage?.clear();
    const { container } = render(<V2Appointments />);

    const toolbar = container.querySelector('.v2-section-toolbar');
    expect(toolbar).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(formatAdminV2Range(today, tenDaysEnd));

    // Selector Período has exact 9 options in exact order
    const periodSelect = screen.getByLabelText('Período') as HTMLSelectElement;
    expect(periodSelect.value).toBe('NEXT_10_DAYS');
    const optionTexts = Array.from(periodSelect.options).map((opt) => opt.text);

    expect(optionTexts).toEqual([
      formatV2AgendaPeriodLabel('TODAY', today),
      formatV2AgendaPeriodLabel('NEXT_5_DAYS', today),
      formatV2AgendaPeriodLabel('THIS_WEEK', today),
      formatV2AgendaPeriodLabel('NEXT_10_DAYS', today),
      formatV2AgendaPeriodLabel('THIS_MONTH', today),
      formatV2AgendaPeriodLabel('PREVIOUS_MONTH', today),
      formatV2AgendaPeriodLabel('THIS_YEAR', today),
      formatV2AgendaPeriodLabel('CUSTOM', today),
      formatV2AgendaPeriodLabel('DATE', today),
    ]);

    // Shows appointments for today and 10th day
    expect(screen.getByText('Cliente Hoy')).toBeInTheDocument();
    expect(screen.getByText('Cliente Próximos 10 Días')).toBeInTheDocument();
  });

  it('filters Esta semana (Monday to Sunday) when selecting Esta semana', () => {
    render(<V2Appointments />);
    const periodSelect = screen.getByLabelText('Período');
    fireEvent.change(periodSelect, { target: { value: 'THIS_WEEK' } });

    // Expect week header
    const expectedHeader = formatAdminV2Range(mondayOfWeek, sundayOfWeek);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(expectedHeader);

    // Cliente Esta Semana should be present
    expect(screen.getByText('Cliente Esta Semana')).toBeInTheDocument();
  });

  it('filters Próximos 10 días when selecting Próximos 10 días', () => {
    render(<V2Appointments />);
    const periodSelect = screen.getByLabelText('Período');
    fireEvent.change(periodSelect, { target: { value: 'NEXT_10_DAYS' } });

    // Expect 10-day header
    const expectedHeader = formatAdminV2Range(today, tenDaysEnd);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(expectedHeader);

    // Should include appointment on the 10th day
    expect(screen.getByText('Cliente Próximos 10 Días')).toBeInTheDocument();
  });

  it('allows querying custom range in the past (historical queries) via Rango personalizado (Fecha desde + Fecha hasta)', () => {
    render(<V2Appointments />);
    const periodSelect = screen.getByLabelText('Período');
    fireEvent.change(periodSelect, { target: { value: 'CUSTOM' } });

    // Existing Fecha acts as Fecha desde and Fecha hasta appears
    const fechaInput = screen.getByLabelText('Fecha desde');
    const hastaInput = screen.getByLabelText('Fecha hasta');
    expect(fechaInput).toBeInTheDocument();
    expect(hastaInput).toBeInTheDocument();
    expect(screen.queryByLabelText('Desde')).toBeNull();

    // Query August 2026
    fireEvent.change(fechaInput, { target: { value: pastDateAugustStart } });
    fireEvent.change(hastaInput, { target: { value: pastDateAugustEnd } });

    // Header updates to historical range with year
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      formatAdminV2Range(pastDateAugustStart, pastDateAugustEnd),
    );

    // Historical appointment in August is shown
    expect(screen.getByText('Cliente Pasado Histórico')).toBeInTheDocument();
  });

  it('validates Fecha <= Fecha hasta and provides feedback without breaking', () => {
    render(<V2Appointments />);
    const periodSelect = screen.getByLabelText('Período');
    fireEvent.change(periodSelect, { target: { value: 'CUSTOM' } });

    const fechaInput = screen.getByLabelText('Fecha desde');
    const hastaInput = screen.getByLabelText('Fecha hasta');

    // Invalid range: Fecha after Fecha hasta
    fireEvent.change(fechaInput, { target: { value: '2026-09-01' } });
    fireEvent.change(hastaInput, { target: { value: '2026-08-01' } });

    expect(screen.getByRole('alert')).toHaveTextContent(
      "La fecha 'Fecha hasta' debe ser igual o posterior a 'Fecha'.",
    );
    expect(
      screen.getByText("Revisá el rango seleccionado: la fecha 'Fecha hasta' debe ser igual o posterior a 'Fecha'."),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Rango no válido');
  });

  it('switches to Fecha exacta when picking a date in Fecha and allows resetting to Hoy', () => {
    render(<V2Appointments />);
    const fechaInput = screen.getByLabelText('Fecha');
    const periodSelect = screen.getByLabelText('Período') as HTMLSelectElement;

    // User chooses past date in Fecha
    fireEvent.change(fechaInput, { target: { value: pastDate } });
    expect(periodSelect.value).toBe('DATE');

    // Header reflects concrete date
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(formatAdminV2Date(pastDate));

    // Shows appointment for that date
    expect(screen.getByText('Cliente Pasado Histórico')).toBeInTheDocument();

    // Resetting via Período 'Hoy' returns to today cleanly
    fireEvent.change(periodSelect, { target: { value: 'TODAY' } });

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(formatAdminV2Date(today));
    expect((screen.getByLabelText('Fecha') as HTMLInputElement).value).toBe(today);
  });
});
