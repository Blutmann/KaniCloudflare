import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { businessDateToday } from "@/lib/kani-mobile-appointments";

const mockStaff = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "BARBER",
  barber_id: null as string | null,
}));

vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    barbers: [
      { id: "b1", name: "Lautaro", active: true },
      { id: "b2", name: "Gonzalo", active: true },
    ],
    profile: {
      role: mockStaff.role,
      barber_id: mockStaff.barber_id,
      display_name: "Lautaro",
    },
  }),
}));

const mockAppointments: any[] = [];
const mockRefresh = vi.fn();

vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    barberId: "ALL",
    setBarberId: vi.fn(),
    barbers: [
      { id: "b1", name: "Lautaro", active: true },
      { id: "b2", name: "Gonzalo", active: true },
    ],
    services: [
      { id: "s1", name: "Corte", price: 25000 },
      { id: "s2", name: "Barba", price: 18000 },
    ],
    clients: [],
    appointments: mockAppointments,
    payments: [],
    depositSupported: true,
    loading: false,
    refresh: mockRefresh,
  }),
}));

const { mockRetryServerFn } = vi.hoisted(() => ({
  mockRetryServerFn: vi.fn(),
}));

vi.mock("@/lib/kani-notifications.functions", () => ({
  retryNotificationChannelServerFn: (args: any) => mockRetryServerFn(args),
  sendAppointmentNotification: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "mock-admin-token" } },
        error: null,
      }),
    },
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
  useSearch: () => ({}),
}));

import { V2Appointments } from "@/components/kani/v2/agenda";

describe("Diagnóstico de notificación: Modal y acción de reintento en UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppointments.length = 0;
  });

  it("1. Abre modal con 'No hay despacho registrado', muestra destinatario y botón 'Reintentar envío'", () => {
    mockAppointments.push({
      id: "apt-pending-no-disp",
      clientId: "c-1",
      barberId: "b1",
      date: businessDateToday(),
      time: "15:00",
      startTime: "15:00:00",
      name: "Juan Pérez",
      phone: "1122334455",
      clientEmail: "juan@example.com",
      serviceName: "Corte y Barba",
      servicePrice: 30000,
      barber: "Lautaro",
      statusCode: "CONFIRMED",
      depositPaid: true,
      dispatches: undefined, // Sin despacho registrado
    });

    render(<V2Appointments />);

    // Buscar la píldora de email pendiente
    const emailPill = screen.getByRole("button", { name: /diagnóstico email: email: pendiente/i });
    expect(emailPill).toBeInTheDocument();

    // Abrir modal
    fireEvent.click(emailPill);

    // Encabezado
    expect(screen.getByRole("heading", { name: "Diagnóstico de notificación: Email" })).toBeInTheDocument();
    // Contexto del turno
    expect(screen.getAllByText(/Juan Pérez/)[0]).toBeInTheDocument();
    // Mensaje de sin despacho
    expect(screen.getByText("No hay despacho registrado para este canal.")).toBeInTheDocument();
    expect(screen.getByText("juan@example.com")).toBeInTheDocument();

    // Botón disponible
    const retryBtn = screen.getByRole("button", { name: "Reintentar envío" });
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).not.toBeDisabled();
  });

  it("2. Ejecuta reintento exitoso: muestra spinner, banner de éxito y actualiza el despacho en el modal", async () => {
    mockAppointments.push({
      id: "apt-pending-retry-ok",
      clientId: "c-1",
      barberId: "b1",
      date: businessDateToday(),
      time: "16:00",
      startTime: "16:00:00",
      name: "Esteban Quito",
      phone: "1199887766",
      clientEmail: "esteban@example.com",
      serviceName: "Corte",
      servicePrice: 25000,
      barber: "Lautaro",
      statusCode: "CONFIRMED",
      depositPaid: true,
      dispatches: undefined,
    });

    mockRetryServerFn.mockResolvedValue({
      success: true,
      status: "SENT",
      providerMessageId: "resend-msg-success-999",
      message: "Correo aceptado por el proveedor Resend (ID: resend-msg-success-999). Estado: En tránsito.",
      dispatch: {
        id: "disp-new-ok",
        appointmentId: "apt-pending-retry-ok",
        channel: "EMAIL",
        provider: "RESEND",
        recipient: "esteban@example.com",
        status: "SENT",
        providerMessageId: "resend-msg-success-999",
        attempts: 1,
        updatedAt: "2026-11-02T01:00:00Z",
      },
    });

    render(<V2Appointments />);

    const emailPill = screen.getByRole("button", { name: /diagnóstico email: email: pendiente/i });
    fireEvent.click(emailPill);

    const retryBtn = screen.getByRole("button", { name: "Reintentar envío" });
    fireEvent.click(retryBtn);

    // Debe invocar la server fn con el token
    await waitFor(() => {
      expect(mockRetryServerFn).toHaveBeenCalledWith({
        data: {
          appointmentId: "apt-pending-retry-ok",
          channel: "EMAIL",
          token: "mock-admin-token",
        },
      });
    });

    // Esperar resultado en el modal
    await waitFor(() => {
      expect(screen.getByText(/Correo aceptado por el proveedor Resend/)).toBeInTheDocument();
    });

    expect(screen.getByText("resend-msg-success-999")).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("3. Maneja error de envío: muestra feedback de error sin romper el diálogo", async () => {
    mockAppointments.push({
      id: "apt-retry-fail",
      clientId: "c-1",
      barberId: "b1",
      date: businessDateToday(),
      time: "17:00",
      startTime: "17:00:00",
      name: "Carlos Error",
      phone: "1155443322",
      clientEmail: "carlos@example.com",
      serviceName: "Corte",
      servicePrice: 25000,
      barber: "Lautaro",
      statusCode: "CONFIRMED",
      depositPaid: true,
      dispatches: {
        email: {
          id: "disp-prev-fail",
          status: "FAILED",
          errorCode: "RESEND_422",
          errorDescription: "Invalid recipient email address",
        },
      },
    });

    mockRetryServerFn.mockResolvedValue({
      success: false,
      status: "FAILED",
      error: "Error al enviar correo: RESEND_422: Invalid domain",
    });

    render(<V2Appointments />);

    const emailPill = screen.getByRole("button", { name: /diagnóstico email: email: error/i });
    fireEvent.click(emailPill);

    const retryBtn = screen.getByRole("button", { name: "Reintentar envío" });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText(/Error al enviar correo: RESEND_422: Invalid domain/)).toBeInTheDocument();
    });
  });

  it("4. No permite reenvío duplicado si el correo ya fue aceptado o entregado", () => {
    mockAppointments.push({
      id: "apt-already-sent",
      clientId: "c-1",
      barberId: "b1",
      date: businessDateToday(),
      time: "18:00",
      startTime: "18:00:00",
      name: "Mariano Sent",
      phone: "1144332211",
      clientEmail: "mariano@example.com",
      serviceName: "Corte",
      servicePrice: 25000,
      barber: "Lautaro",
      statusCode: "CONFIRMED",
      depositPaid: true,
      dispatches: {
        email: {
          id: "disp-sent-1",
          status: "SENT",
          providerMessageId: "resend-existing-123",
          provider: "RESEND",
        },
      },
    });

    render(<V2Appointments />);

    const emailPill = screen.getByRole("button", { name: /diagnóstico email: email: enviado/i });
    fireEvent.click(emailPill);

    // Aviso de duplicado
    expect(screen.getByText(/El correo ya fue aceptado por el proveedor/i)).toBeInTheDocument();
    // Botón de reintento NO debe estar presente
    expect(screen.queryByRole("button", { name: "Reintentar envío" })).toBeNull();
  });

  it("5. Turno en estado PENDING (sin confirmar): muestra explicación y no ofrece botón de envío", () => {
    mockAppointments.push({
      id: "apt-pending-state",
      clientId: "c-1",
      barberId: "b1",
      date: businessDateToday(),
      time: "19:00",
      startTime: "19:00:00",
      name: "Pedro Pendiente",
      phone: "1166778899",
      clientEmail: "pedro@example.com",
      serviceName: "Corte",
      servicePrice: 25000,
      barber: "Lautaro",
      statusCode: "PENDING", // Estado no compatible
      depositPaid: false,
      dispatches: undefined,
    });

    render(<V2Appointments />);

    const emailPill = screen.getByRole("button", { name: /diagnóstico email: email: pendiente/i });
    fireEvent.click(emailPill);

    expect(screen.getByText(/Solo los turnos confirmados o cancelados admiten notificaciones automáticas por correo/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar envío" })).toBeNull();
  });
});
