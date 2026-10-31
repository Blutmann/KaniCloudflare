import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { businessDateToday } from '@/lib/kani-mobile-appointments';

// Mocks
const mockStaff = vi.hoisted(() => ({
  role: 'ADMIN' as 'ADMIN' | 'BARBER',
  barber_id: null as string | null,
}));

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    barbers: [
      { id: 'b1', name: 'Lautaro', active: true },
      { id: 'b2', name: 'Gonzalo', active: true },
    ],
    profile: {
      role: mockStaff.role,
      barber_id: mockStaff.barber_id,
      display_name: 'Lautaro',
    },
  }),
}));

const mockClients = vi.hoisted(() => [
  { id: 'c1', name: 'Alejo Test', phone: '1133445566', email: 'alejo@test.com', created_at: '2026-10-01T00:00:00Z', archived: false },
  { id: 'c2', name: 'Gonzalo Otro', phone: '1199887766', email: 'gonzalo@test.com', created_at: '2026-10-02T00:00:00Z', archived: false },
]);

const mockAppointments = vi.hoisted(() => [
  {
    id: 'apt-1',
    clientId: 'c1',
    barberId: 'b1',
    date: '2026-10-31',
    statusCode: 'CONFIRMED',
    time: '14:00',
    name: 'Alejo Test',
    phone: '1133445566',
    email: 'alejo@test.com',
    serviceName: 'Corte',
    servicePrice: 25000,
    barber: 'Lautaro',
    depositPaid: true,
    depositAmountArs: 5000,
    dispatches: {
      whatsapp: {
        status: 'FAILED',
        errorCode: '131042',
        errorDescription: 'Your WhatsApp Business account currency is not configured.',
      },
      email: {
        status: 'SENT',
        provider: 'RESEND',
      },
    },
  },
]);

const mockPayments = vi.hoisted(() => [
  {
    id: 'p1',
    barberId: 'b1',
    barberName: 'Lautaro',
    serviceName: 'Corte',
    servicePriceArs: 25000,
    collectedAmountArs: 20000,
    discountArs: 0,
    paymentMethod: 'Efectivo',
    paymentDate: '2026-10-31',
    paymentTime: '14:45',
    clientName: 'Alejo Test',
    clientContact: '1133445566',
    isDepositMovement: false,
    appointmentId: 'apt-1',
  },
]);

vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => ({
    barberId: 'ALL',
    setBarberId: vi.fn(),
    barbers: [
      { id: 'b1', name: 'Lautaro', active: true },
      { id: 'b2', name: 'Gonzalo', active: true },
    ],
    services: [
      { id: 's1', name: 'Corte', price: 25000 },
      { id: 's2', name: 'Barba', price: 18000 },
    ],
    clients: mockClients,
    appointments: mockAppointments,
    payments: mockPayments,
    depositSupported: true,
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, search, ...props }: any) => <a href={to} {...props}>{children}</a>,
  useSearch: () => ({}),
}));

import { V2Clients } from '@/components/kani/v2/clients';
import { V2Payments } from '@/components/kani/v2/payments';
import { V2Appointments } from '@/components/kani/v2/agenda';

afterEach(() => {
  cleanup();
  mockStaff.role = 'ADMIN';
  mockStaff.barber_id = null;
});

describe('Admin V2 — Optimización de Clientes, Pagos y Turnos', () => {
  describe('1. CLIENTES (/admin-v2/clientes)', () => {
    it('1.1 Toolbar: renderiza buscador a ancho completo y fila 2 con Ordenar por y Nuevo cliente', () => {
      render(<V2Clients />);
      const searchInput = screen.getByLabelText('Buscar clientes');
      expect(searchInput).toBeInTheDocument();
      expect(searchInput.closest('.v2-client-search-row')).toBeInTheDocument();

      const orderSelect = screen.getByText('Ordenar por');
      expect(orderSelect.closest('.v2-client-controls-row')).toBeInTheDocument();

      const addBtn = screen.getByRole('button', { name: /nuevo cliente/i });
      expect(addBtn.closest('.v2-client-controls-row')).toBeInTheDocument();
    });

    it('1.2 Jerarquía de tarjetas: Nombre prominente, contacto y métricas verificadas', () => {
      render(<V2Clients />);
      expect(screen.getByText('Alejo Test')).toHaveClass('v2-client-name');
      expect(screen.getByText('1133445566')).toHaveClass('v2-client-phone');
      expect(screen.getByText('alejo@test.com')).toHaveClass('v2-client-email');
      expect(screen.getByText(/1 visita verificada/i)).toBeInTheDocument();
    });

    it('1.3 Permisos: ADMIN puede ver botones de Editar y Eliminar en tarjetas', () => {
      render(<V2Clients />);
      expect(screen.getByLabelText('Editar datos de Alejo Test')).toBeInTheDocument();
      expect(screen.getByLabelText('Eliminar cliente Alejo Test')).toBeInTheDocument();
    });

    it('1.3 Permisos: BARBER sólo puede editar clientes con su propio historial y NO puede eliminar', () => {
      mockStaff.role = 'BARBER';
      mockStaff.barber_id = 'b1'; // Vinculado con Alejo (apt-1)
      render(<V2Clients />);

      // Puede editar a Alejo (vinculado a b1)
      expect(screen.getByLabelText('Editar datos de Alejo Test')).toBeInTheDocument();
      // NO puede editar a Gonzalo Otro (no vinculado a b1)
      expect(screen.queryByLabelText('Editar datos de Gonzalo Otro')).toBeNull();
      // NUNCA puede eliminar clientes
      expect(screen.queryByLabelText(/eliminar cliente/i)).toBeNull();
    });

    it('1.4 Mobile Cards: Reemplaza flecha aislada por botón «Ver detalles» que abre la ficha del cliente', () => {
      mockStaff.role = 'ADMIN';
      render(<V2Clients />);

      // No existe flecha aislada ni selector arrow
      const detailsButtons = screen.getAllByRole('button', { name: /ver detalles/i });
      expect(detailsButtons.length).toBe(mockClients.length);
      expect(detailsButtons[0]).toHaveClass('v2-client-details-btn');

      // Al hacer clic en Ver detalles abre el diálogo de ficha
      fireEvent.click(detailsButtons[0]);
      expect(screen.getByText(/historial de atenciones registradas/i)).toBeInTheDocument();
    });

    it('1.5 Mobile Cards: Botones de editar y eliminar dispuestos horizontalmente en .v2-client-actions', () => {
      mockStaff.role = 'ADMIN';
      render(<V2Clients />);
      const editBtn = screen.getByLabelText('Editar datos de Alejo Test');
      const deleteBtn = screen.getByLabelText('Eliminar cliente Alejo Test');
      const actionsContainer = editBtn.closest('.v2-client-actions');
      expect(actionsContainer).toBeInTheDocument();
      expect(deleteBtn.closest('.v2-client-actions')).toBe(actionsContainer);
    });
  });

  describe('2. PAGOS (/admin-v2/pagos)', () => {
    it('2.1 y 2.2 Formulario compacto en 4 filas con dos columnas 50/50', () => {
      render(<V2Payments />);
      // Fila 1: Barbero | Servicio
      expect(screen.getAllByText('Barbero')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Servicio')[0]).toBeInTheDocument();

      // Fila 2: Método de cobro | Importe
      expect(screen.getByText('Método de cobro')).toBeInTheDocument();
      expect(screen.getByText('Importe ($ ARS)')).toBeInTheDocument();

      // Fila 3: Botones Agregar descuento | Asociar cliente
      expect(screen.getByRole('button', { name: /agregar descuento/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /asociar cliente/i })).toBeInTheDocument();

      // Fila 4: A cobrar ahora | Registrar cobro
      expect(screen.getByText('A cobrar ahora')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /registrar cobro/i })).toBeInTheDocument();
    });

    it('2.3 Sección renombrada: "Cobros registrados" reemplaza a "La cobranza"', () => {
      render(<V2Payments />);
      expect(screen.getByRole('heading', { name: 'Cobros registrados' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'La cobranza' })).toBeNull();
    });

    it('2.4 Presentación: Desktop table contiene importes con alineación tabular a la derecha', () => {
      render(<V2Payments />);
      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();

      const amountTh = table.querySelector('th.col-amount');
      expect(amountTh).toBeInTheDocument();

      const amountCell = table.querySelector('.v2-table-amount-cell');
      expect(amountCell).toBeInTheDocument();
      expect(amountCell?.textContent).toContain('$20.000');
    });

    it('2.5 Desktop table: Columnas equilibradas y acciones estables', () => {
      render(<V2Payments />);
      const table = screen.getByRole('table');
      expect(table.querySelector('th.col-datetime')).toBeInTheDocument();
      expect(table.querySelector('th.col-service')).toBeInTheDocument();
      expect(table.querySelector('th.col-client')).toBeInTheDocument();
      expect(table.querySelector('th.col-method')).toBeInTheDocument();
      expect(table.querySelector('th.col-amount')).toBeInTheDocument();
      expect(table.querySelector('th.col-actions')).toBeInTheDocument();

      // Cliente tiene nombre principal y contacto secundario
      expect(table.querySelector('.v2-table-client-name')).toBeInTheDocument();
      expect(table.querySelector('.v2-table-client-contact')).toBeInTheDocument();

      // Acciones estables
      const actionsCell = table.querySelector('.v2-table-actions-cell');
      expect(actionsCell).toBeInTheDocument();
      expect(within(table).getByRole('button', { name: 'Editar cobro' })).toBeInTheDocument();
      expect(within(table).getByRole('button', { name: 'Anular cobro' })).toBeInTheDocument();
    });

    it('2.6 Mobile cards: Estructura en 4 líneas con acciones compactas de 44px', () => {
      const { container } = render(<V2Payments />);
      const card = container.querySelector('.v2-payment-card-mobile');
      expect(card).toBeInTheDocument();

      // Línea 1: Servicio + Importe
      expect(card?.querySelector('.v2-pcm-row-top')).toBeInTheDocument();
      expect(card?.querySelector('.v2-pcm-service')).toBeInTheDocument();
      expect(card?.querySelector('.v2-pcm-amount')).toBeInTheDocument();

      // Línea 2: Cliente + Contacto
      expect(card?.querySelector('.v2-pcm-row-client')).toBeInTheDocument();
      expect(card?.querySelector('.v2-pcm-client-name')).toBeInTheDocument();
      expect(card?.querySelector('.v2-pcm-client-contact')).toBeInTheDocument();

      // Línea 3: Fecha/Hora + Método
      expect(card?.querySelector('.v2-pcm-row-meta')).toBeInTheDocument();
      expect(card?.querySelector('.v2-pcm-datetime')).toBeInTheDocument();

      // Línea 4: Acciones compactas
      const actions = card?.querySelector('.v2-pcm-actions');
      expect(actions).toBeInTheDocument();
      const buttons = actions?.querySelectorAll('.v2-pcm-btn');
      expect(buttons?.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('3. TURNOS (/admin-v2/turnos)', () => {
    it('3.1 Botón WhatsApp integrado con Pontiun: Bloqueo controlado en Error 131042', () => {
      render(<V2Appointments />);
      const waBtn = screen.getByRole('button', { name: 'WhatsApp' });
      expect(waBtn).toBeInTheDocument();
      fireEvent.click(waBtn);

      // Abre el modal explicativo de configuración pendiente en Meta
      expect(screen.getByRole('heading', { name: /configuración pendiente en meta/i })).toBeInTheDocument();
      expect(screen.getByText(/código 131042: la moneda no está configurada/i)).toBeInTheDocument();
    });

    it('3.2 Compactación de estados de notificación con diagnóstico accesible', () => {
      render(<V2Appointments />);
      // Pills compactas
      const waPill = screen.getByRole('button', { name: /diagnóstico whatsapp: whatsapp: error 131042/i });
      expect(waPill).toBeInTheDocument();
      expect(waPill.textContent).toContain('WhatsApp: Error 131042');

      const emailPill = screen.getByRole('button', { name: /diagnóstico email: email: enviado/i });
      expect(emailPill).toBeInTheDocument();
      expect(emailPill.textContent).toContain('Email: Enviado');

      // Al pulsar la pill, abre el modal de diagnóstico técnico completo
      fireEvent.click(waPill);
      expect(screen.getByRole('heading', { name: /diagnóstico de notificación: whatsapp/i })).toBeInTheDocument();
      expect(screen.getByText(/Your WhatsApp Business account currency is not configured/i)).toBeInTheDocument();
    });

    it('3.3 Grilla responsive de acciones para tarjetas de turnos', () => {
      render(<V2Appointments />);
      const grid = document.querySelector('.v2-appointment-actions-grid');
      expect(grid).toBeInTheDocument();
      // Confirmado tiene: Cancelar turno, Cobrar, WhatsApp, Mail = 4 acciones (2x2 grid)
      expect(grid).toHaveClass('count-4');
    });
  });

  describe('4. VERIFICACIÓN DE REGLAS CSS Y RESPONSIVE (360px a 1920px)', () => {
    const fs = require('fs');
    const path = require('path');
    const css = fs.readFileSync(path.resolve(__dirname, '../components/kani/v2/v2.css'), 'utf8');

    it('Clientes: Buscador a 100%, fila 2 con controles y tarjetas mobile con acciones horizontales y boton detalles 44px', () => {
      expect(css).toContain('.v2-client-toolbar-container');
      expect(css).toContain('.v2-client-search-row');
      expect(css).toContain('.v2-client-controls-row');
      expect(css).toContain('.v2-client-details-btn');
      expect(css).toMatch(/\.v2-client-actions\s*\{[^}]*flex-direction:\s*row/);
      expect(css).toMatch(/\.v2-client-action-btn\s*\{[^}]*min-width:\s*44px/);
      expect(css).toMatch(/\.v2-client-details-btn\s*\{[^}]*min-height:\s*44px/);
    });

    it('Pagos: Formulario compacto con 2 columnas (1fr 1fr) de 50/50 en desktop y mobile', () => {
      expect(css).toMatch(/\.v2-payment-row\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
      expect(css).toMatch(/\.v2-payment-row\s*\.v2-field\s*input[^}]*min-height:\s*44px/);
      expect(css).toMatch(/\.v2-payment-toggle-btn\s*\{[^}]*min-height:\s*44px/);
      expect(css).toMatch(/\.v2-payment-submit-btn\s*\{[^}]*min-height:\s*44px/);
    });

    it('Pagos: Tabla desktop usa table-layout fixed, alinea importes a la derecha y reserva espacio de acciones', () => {
      expect(css).toMatch(/\.v2-payments-table\s*\{[^}]*table-layout:\s*fixed/);
      expect(css).toMatch(/\.v2-payments-table\s*\.col-datetime\s*\{[^}]*width:\s*115px/);
      expect(css).toMatch(/\.v2-payments-table\s*\.col-amount[^}]*width:\s*110px/);
      expect(css).toMatch(/\.v2-payments-table\s*\.col-actions[^}]*width:\s*160px/);
      expect(css).toMatch(/\.v2-table-amount-cell\s*\{[^}]*text-align:\s*right/);
      expect(css).toMatch(/\.v2-table-amount-cell\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
      expect(css).toMatch(/\.v2-pcm-btn\s*\{[^}]*min-height:\s*44px/);
    });

    it('Turnos: Acciones en grilla dinámica 2x2 para 4 acciones y 1x2 para 2 acciones', () => {
      expect(css).toMatch(/\.v2-appointment-actions-grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
      expect(css).toMatch(/\.v2-appointment-actions-grid\.count-1\s*\{[^}]*grid-template-columns:\s*1fr/);
      expect(css).toMatch(/\.v2-action-btn\s*\{[^}]*min-height:\s*44px/);
      expect(css).toMatch(/\.v2-whatsapp\s*\{[^}]*background:\s*#25D366/);
    });
  });
});
