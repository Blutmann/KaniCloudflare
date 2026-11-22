import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addCalendarDays,
  businessDateToday,
  dateRangeForV2AgendaPeriod,
  formatV2AgendaPeriodLabel,
  isAppointmentTemporallyFinished,
  sortV2AgendaAppointments,
} from '@/lib/kani-mobile-appointments';
import { getWhatsAppDirectSendUrl } from '@/lib/kani-phone';

const testState = vi.hoisted(() => ({
  role: 'ADMIN' as 'ADMIN' | 'BOSS' | 'BARBER',
  barberId: null as string | null,
  appointments: [] as any[],
  refresh: vi.fn(),
  retryServerFn: vi.fn(),
}));

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    barbers: [
      { id: 'b1', name: 'Lautaro', active: true },
      { id: 'b2', name: 'Gonzalo', active: true },
    ],
    profile: { role: testState.role, barber_id: testState.barberId, display_name: 'Admin' },
  }),
}));

vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => ({
    barberId: 'ALL',
    setBarberId: vi.fn(),
    barbers: [
      { id: 'b1', name: 'Lautaro', active: true },
      { id: 'b2', name: 'Gonzalo', active: true },
    ],
    services: [{ id: 'corte', dbId: 's1', name: 'Corte', price: 25000, duration: 45 }],
    clients: [],
    payments: [],
    depositSupported: true,
    loading: false,
    refresh: testState.refresh,
    appointments: testState.appointments,
  }),
}));

vi.mock('@/lib/kani-notifications.functions', () => ({
  retryNotificationChannelServerFn: (args: any) => testState.retryServerFn(args),
  sendAppointmentNotification: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'mock-token' } },
        error: null,
      }),
    },
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className, ...props }: any) => (
    <a href={typeof to === 'string' ? to : '#'} className={className} {...props}>
      {children}
    </a>
  ),
}));

import { V2Appointments } from '@/components/kani/v2/agenda';

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage?.clear();
  testState.role = 'ADMIN';
  testState.barberId = null;
  testState.appointments = [];
});

afterEach(() => {
  cleanup();
});

describe('V12.47.25 — Helpers de períodos, ordenamiento y WhatsApp directo', () => {
  it('calcula Mes anterior con cambio de año (enero -> diciembre anterior) y febrero bisiesto', () => {
    expect(dateRangeForV2AgendaPeriod('PREVIOUS_MONTH', '2026-01-15')).toEqual({
      start: '2025-12-01',
      end: '2025-12-31',
    });
    expect(dateRangeForV2AgendaPeriod('PREVIOUS_MONTH', '2024-03-10')).toEqual({
      start: '2024-02-01',
      end: '2024-02-29',
    });
    expect(formatV2AgendaPeriodLabel('PREVIOUS_MONTH', '2026-01-15')).toBe(
      'Diciembre 2025',
    );
    expect(formatV2AgendaPeriodLabel('THIS_YEAR', '2026-11-16')).toBe('2026');
  });

  it('determina horario finalizado usando duración real del servicio sin mutar estado', () => {
    // 2026-11-16 14:00 UTC = 11:00 ART
    const now = new Date('2026-11-16T14:00:00.000Z');
    // 10:00 + 45 min = 10:45 <= 11:00 -> finalizado
    expect(
      isAppointmentTemporallyFinished(
        { date: '2026-11-16', time: '10:00', service: 'corte', serviceDuration: 45 },
        now,
      ),
    ).toBe(true);
    // 10:30 + 45 min = 11:15 > 11:00 -> en curso (no finalizado)
    expect(
      isAppointmentTemporallyFinished(
        { date: '2026-11-16', time: '10:30', service: 'corte', serviceDuration: 45 },
        now,
      ),
    ).toBe(false);
    // Mañana -> no finalizado
    expect(
      isAppointmentTemporallyFinished(
        { date: '2026-11-17', time: '09:00', service: 'corte', serviceDuration: 45 },
        now,
      ),
    ).toBe(false);
  });

  it('ordena turnos de hoy próximos/en curso primero y finalizados después, antes de los días futuros', () => {
    const now = new Date('2026-11-16T14:00:00.000Z'); // 11:00 ART
    const list: any[] = [
      { id: 'past-1', date: '2026-11-16', time: '09:00', service: 'corte', serviceDuration: 45 },
      { id: 'future-day', date: '2026-11-17', time: '09:00', service: 'corte', serviceDuration: 45 },
      { id: 'upcoming-1', date: '2026-11-16', time: '12:00', service: 'corte', serviceDuration: 45 },
      { id: 'in-progress', date: '2026-11-16', time: '10:30', service: 'corte', serviceDuration: 45 },
    ];
    const sorted = sortV2AgendaAppointments(list, 'NEXT_10_DAYS', now);
    expect(sorted.map((a) => a.id)).toEqual([
      'in-progress',
      'upcoming-1',
      'past-1',
      'future-day',
    ]);
  });

  it('genera URL directa de WhatsApp solo con dígitos y sin inventar código de país ambiguo', () => {
    expect(getWhatsAppDirectSendUrl('+54 9 11 2843-6014')).toBe(
      'https://api.whatsapp.com/send/?phone=5491128436014&text&type=phone_number&app_absent=0',
    );
    // Ambiguo sin código de país -> null (no inventa 54)
    expect(getWhatsAppDirectSendUrl('12345678')).toBeNull();
    expect(getWhatsAppDirectSendUrl('')).toBeNull();
  });
});

describe('V12.47.25 — UI /admin/turnos (V2Appointments)', () => {
  it('muestra Cobrar antes que Cancelar turno en el orden de acciones', () => {
    const today = businessDateToday();
    testState.appointments = [
      {
        id: 'apt-order',
        barberId: 'b1',
        barber: 'Lautaro',
        date: today,
        time: '23:00',
        endTime: '23:45',
        name: 'Orden Acciones',
        phone: '+5491122334455',
        statusCode: 'CONFIRMED',
        serviceName: 'Corte',
        servicePrice: 25000,
      },
    ];

    const { container } = render(<V2Appointments />);
    const grid = container.querySelector('.v2-appointment-actions-grid');
    expect(grid).toBeInTheDocument();
    const labels = Array.from(grid!.querySelectorAll('.v2-action-btn')).map((el) =>
      el.textContent?.trim(),
    );
    const cobrarIdx = labels.findIndex((t) => t === 'Cobrar');
    const cancelIdx = labels.findIndex((t) => t === 'Cancelar turno');
    expect(cobrarIdx).toBe(0);
    expect(cancelIdx).toBe(1);
  });

  it('inicia en Próximos 10 días y respeta preferencia guardada en localStorage', () => {
    const { unmount } = render(<V2Appointments />);
    const select1 = screen.getByLabelText('Período') as HTMLSelectElement;
    expect(select1.value).toBe('NEXT_10_DAYS');

    fireEvent.change(select1, { target: { value: 'THIS_MONTH' } });
    unmount();

    render(<V2Appointments />);
    const select2 = screen.getByLabelText('Período') as HTMLSelectElement;
    expect(select2.value).toBe('THIS_MONTH');
  });

  it('seleccionar fecha cambia automáticamente a Fecha exacta y Rango personalizado usa solo Fecha hasta', () => {
    const today = businessDateToday();
    const tomorrow = addCalendarDays(today, 1);
    render(<V2Appointments />);

    const periodSelect = screen.getByLabelText('Período') as HTMLSelectElement;
    const fechaInput = screen.getByLabelText('Fecha') as HTMLInputElement;

    // Seleccionar fecha manualmente cambia a Fecha exacta
    fireEvent.change(fechaInput, { target: { value: tomorrow } });
    expect(periodSelect.value).toBe('DATE');

    // Cambiar a Rango personalizado muestra solo Fecha hasta y preserva su valor al cambiar y volver
    fireEvent.change(periodSelect, { target: { value: 'CUSTOM' } });
    const hastaInput = screen.getByLabelText('Fecha hasta') as HTMLInputElement;
    fireEvent.change(hastaInput, { target: { value: tomorrow } });
    expect(screen.queryByLabelText('Desde')).toBeNull();

    fireEvent.change(periodSelect, { target: { value: 'TODAY' } });
    expect(screen.queryByLabelText('Fecha hasta')).toBeNull();

    fireEvent.change(periodSelect, { target: { value: 'CUSTOM' } });
    expect((screen.getByLabelText('Fecha hasta') as HTMLInputElement).value).toBe(tomorrow);
  });

  it('simplifica selector de Estado a Todos, Confirmado, Cancelado sin romper badges históricos', () => {
    const today = businessDateToday();
    testState.appointments = [
      {
        id: 'apt-comp',
        barberId: 'b1',
        barber: 'Lautaro',
        date: today,
        time: '10:00',
        name: 'Histórico Realizado',
        phone: '+5491122334455',
        statusCode: 'COMPLETED',
        serviceName: 'Corte',
      },
    ];

    render(<V2Appointments />);
    const statusSelect = screen.getByLabelText('Estado') as HTMLSelectElement;
    const optionTexts = Array.from(statusSelect.options).map((o) => o.text);
    expect(optionTexts).toEqual(['Todos', 'Confirmado', 'Cancelado']);

    // Registro histórico sigue mostrando su badge en Todos
    expect(screen.getByText('Realizado')).toBeInTheDocument();
  });

  it('diferencia turnos con horario finalizado con clase atenuada y badge Horario finalizado sin bloquear acciones', () => {
    const yesterday = addCalendarDays(businessDateToday(), -1);
    testState.appointments = [
      {
        id: 'apt-finished',
        barberId: 'b1',
        barber: 'Lautaro',
        date: yesterday,
        time: '10:00',
        endTime: '10:45',
        name: 'Turno Finalizado',
        phone: '+5491122334455',
        email: 'fin@test.com',
        statusCode: 'CONFIRMED',
        serviceName: 'Corte',
        servicePrice: 25000,
      },
    ];

    const { container } = render(<V2Appointments />);
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: yesterday } });

    const card = container.querySelector('.v2-appointment');
    expect(card).toHaveClass('v2-appointment--past');
    expect(screen.getByText('Horario finalizado')).toBeInTheDocument();
    // Sigue mostrando estado Confirmado y acciones habilitadas
    expect(container.querySelector('.v2-status-confirmed')).toHaveTextContent('Confirmado');
    expect(screen.getByRole('link', { name: 'Cobrar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar turno' })).not.toBeDisabled();
  });

  it('muestra Reenviar notificación del turno en WhatsApp y Email incluso si ya fue DELIVERED y previene doble clic', async () => {
    const today = businessDateToday();
    testState.appointments = [
      {
        id: 'apt-wa-delivered',
        barberId: 'b1',
        barber: 'Lautaro',
        date: today,
        time: '23:00',
        name: 'Cliente Entregado',
        phone: '+5491122334455',
        email: 'cliente@test.com',
        statusCode: 'CONFIRMED',
        serviceName: 'Corte',
        dispatches: {
          whatsapp: {
            id: 'd-wa',
            channel: 'WHATSAPP',
            provider: 'PONTIUN',
            status: 'DELIVERED',
            recipient: '+5491122334455',
            attempts: 1,
          },
        },
      },
    ];

    let resolveRetry!: (v: any) => void;
    testState.retryServerFn.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve;
        }),
    );

    render(<V2Appointments />);

    fireEvent.click(screen.getByRole('button', { name: /Diagnóstico WhatsApp/i }));
    expect(
      screen.getByRole('heading', { name: 'Diagnóstico de notificación: WhatsApp' }),
    ).toBeInTheDocument();

    const resendBtn = screen.getByRole('button', { name: 'Reenviar notificación del turno' });
    expect(resendBtn).not.toBeDisabled();

    fireEvent.click(resendBtn);
    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
    await waitFor(() => {
      expect(testState.retryServerFn).toHaveBeenCalledTimes(1);
    });

    resolveRetry({
      success: true,
      channel: 'WHATSAPP',
      status: 'PROVIDER_ACCEPTED',
      providerMessageId: 'pontiun-123',
      message: 'Aceptado por Pontiun',
    });

    await waitFor(() => {
      expect(screen.getByText(/Aceptado por Pontiun/i)).toBeInTheDocument();
    });
  });

  it('explica cuando el teléfono es ambiguo sin inventar código de país', () => {
    const today = businessDateToday();
    testState.appointments = [
      {
        id: 'apt-ambig-phone',
        barberId: 'b1',
        barber: 'Lautaro',
        date: today,
        time: '23:00',
        name: 'Tel Ambiguo',
        phone: '12345678',
        statusCode: 'CONFIRMED',
        serviceName: 'Corte',
      },
    ];

    render(<V2Appointments />);
    const waBtn = screen.getByRole('button', { name: 'WhatsApp' });
    fireEvent.click(waBtn);
    expect(
      screen.getByRole('heading', { name: 'Número de teléfono inválido o ambiguo' }),
    ).toBeInTheDocument();
  });

  it('Mobile Product Designer Card: sin bolitas permanentes ni Seña: No abonada, Seña $X y Error aviso condicionales, fecha corta, barra 50/50 Cobrar + Opciones y bandeja de 2 filas', () => {
    const origMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 639px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    try {
      const today = businessDateToday();
      // Calcular un lunes y martes dentro de los próximos 10 días para verificar fecha corta en modo multi-día
      const monday = '2026-11-23';
      const tuesday = '2026-11-24';
      const inRange = monday >= today && tuesday <= addCalendarDays(today, 9);
      const d1 = inRange ? monday : today;
      const d2 = inRange ? tuesday : addCalendarDays(today, 1);

      testState.appointments = [
        {
          id: 'apt-pd-1',
          barberId: 'b1',
          barber: 'Lautaro',
          date: d1,
          time: '10:00',
          endTime: '10:30',
          name: 'Matias Zarate',
          phone: '+5491122334455',
          email: 'matias@test.com',
          statusCode: 'CONFIRMED',
          serviceName: 'Corte',
          servicePrice: 25000,
          depositPaid: false,
          isManual: true,
          dispatches: {
            whatsapp: { id: 'w1', channel: 'WHATSAPP', provider: 'PONTIUN', status: 'DELIVERED', recipient: '+5491122334455', attempts: 1 },
            email: { id: 'e1', channel: 'EMAIL', provider: 'RESEND', status: 'SENT', recipient: 'matias@test.com', attempts: 1 },
          },
        },
        {
          id: 'apt-pd-2',
          barberId: 'b1',
          barber: 'Lautaro',
          date: d2,
          time: '11:00',
          endTime: '11:45',
          name: 'Lucas Pérez',
          phone: '+5491122334456',
          statusCode: 'CANCELLED',
          serviceName: 'Barba',
          servicePrice: 15000,
          depositPaid: true,
          depositAmountArs: 5000,
          isManual: false,
          dispatches: {
            whatsapp: { id: 'w2', channel: 'WHATSAPP', provider: 'PONTIUN', status: 'FAILED', recipient: '+5491122334456', attempts: 1, errorMessage: 'No WA' },
          },
        },
      ];

      const { container } = render(<V2Appointments />);

      // Sin bolitas permanentes ni "Seña: No abonada"
      expect(container.querySelector('.v2-app-mobile-notif-inline')).toBeNull();
      expect(screen.queryByText(/Seña:\s*No abonada/i)).toBeNull();

      // Seña $5.000 solo cuando depositPaid: true, y Error aviso solo en FAILED
      expect(screen.getByText(/Seña \$5\.000/)).toBeInTheDocument();
      const errorAvisoBtns = screen.getAllByRole('button', { name: /Error en aviso/i });
      expect(errorAvisoBtns).toHaveLength(1);
      expect(errorAvisoBtns[0]).toHaveTextContent('Error aviso');

      // Fecha corta en modo multi-día (NEXT_10_DAYS)
      if (inRange) {
        expect(screen.getByText('Lun 23/11')).toBeInTheDocument();
        expect(screen.getByText('Mar 24/11')).toBeInTheDocument();
      }

      // Jerarquía por estado y barras 50/50 vs 100%
      const cards = container.querySelectorAll('.v2-appointment');
      expect(cards[0]).not.toHaveClass('v2-appointment--cancelled');
      expect(cards[1]).toHaveClass('v2-appointment--cancelled');

      expect(container.querySelectorAll('.v2-app-mobile-bar--split')).toHaveLength(1);
      expect(container.querySelectorAll('.v2-app-mobile-bar--single')).toHaveLength(1);
      expect(screen.getAllByRole('link', { name: 'Cobrar' })).toHaveLength(1);

      const opcionesBtns = screen.getAllByRole('button', { name: /Opciones/i });
      expect(opcionesBtns).toHaveLength(2);
      expect(opcionesBtns[0]).toHaveAttribute('aria-expanded', 'false');

      // Abrir bandeja en la tarjeta CONFIRMED (manual con email)
      fireEvent.click(opcionesBtns[0]!);
      expect(opcionesBtns[0]).toHaveAttribute('aria-expanded', 'true');
      expect(cards[0]).toHaveClass('v2-appointment--drawer-open');

      // Fila 1: WhatsApp + Mail, Fila 2: Avisos + Editar + Cancelar
      expect(screen.getByRole('link', { name: 'WhatsApp' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Mail' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Avisos' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();

      // Al abrir bandeja en tarjeta CANCELLED, recupera opacidad (v2-appointment--drawer-open)
      fireEvent.click(opcionesBtns[1]!);
      expect(cards[1]).toHaveClass('v2-appointment--drawer-open');
    } finally {
      window.matchMedia = origMatchMedia;
    }
  });
});
