import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealAppointment } from "@/lib/kani-appointments";
import { readRealAppointments } from "@/lib/kani-appointments";
import { businessDateToday } from "@/lib/kani-mobile-appointments";

const { mockSupabaseFrom, mockGetSession, mockRetryChannel, mockV2State, mockStaffState } = vi.hoisted(() => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    mockSupabaseFrom: vi.fn(),
    mockGetSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "test-token" } } }),
    mockRetryChannel: vi.fn(),
    mockStaffState: {
      profile: { role: "ADMIN", barber_id: null },
      barbers: [{ id: "barber-lautaro", name: "Lautaro" }],
    },
    mockV2State: {
      barberId: "ALL",
      setBarberId: vi.fn(),
      depositSupported: true,
      refresh: vi.fn(),
      appointments: [] as RealAppointment[],
      payments: [],
      services: [{ id: "corte", dbId: "svc-corte-id", name: "Corte", duration: 45, price: 25000 }],
      clients: [],
      today,
    },
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockSupabaseFrom(...args),
    auth: {
      getSession: (...args: any[]) => mockGetSession(...args),
    },
  },
}));

vi.mock("@/lib/kani-notifications.functions", () => ({
  retryNotificationChannelServerFn: (...args: any[]) => mockRetryChannel(...args),
}));

vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => mockStaffState,
}));

vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => mockV2State,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  useLocation: () => "/panel-v2/operacion/turnos",
}));

import {
  V2Appointments,
  formatCompactDispatchStatus,
  formatWhatsAppPhoneDisplay,
  translateDispatchError,
} from "@/components/kani/v2/agenda";

function makeMixedAppointment(): RealAppointment {
  return {
    id: "apt-mixed-1",
    requestNumber: 301,
    service: "corte",
    barber: "Lautaro",
    date: businessDateToday(),
    time: "11:00",
    endTime: "11:45",
    name: "Lucas Gómez",
    email: "lucas@example.com",
    phone: "+54 9 11 2843-6014",
    status: "Confirmado",
    statusCode: "CONFIRMED",
    notes: "",
    barberId: "barber-lautaro",
    serviceId: "svc-corte-id",
    serviceName: "Corte",
    serviceDuration: 45,
    servicePrice: 25000,
    isManual: true,
    origin: "MANUAL",
    dispatches: {
      whatsapp: {
        id: "disp-client-1",
        appointmentId: "apt-mixed-1",
        channel: "WHATSAPP",
        recipientRole: "CLIENT",
        provider: "PONTIUN",
        recipient: "+54 9 11 2843-6014",
        status: "SENT",
        attempts: 1,
        requestedAt: "2026-11-23T15:00:00Z",
        createdAt: "2026-11-23T15:00:00Z",
        updatedAt: "2026-11-23T15:00:05Z",
      },
      whatsappClient: {
        id: "disp-client-1",
        appointmentId: "apt-mixed-1",
        channel: "WHATSAPP",
        recipientRole: "CLIENT",
        provider: "PONTIUN",
        recipient: "+5491155551234",
        status: "SENT",
        attempts: 1,
        requestedAt: "2026-11-23T15:00:00Z",
        createdAt: "2026-11-23T15:00:00Z",
        updatedAt: "2026-11-23T15:00:05Z",
      },
      whatsappBarber: {
        id: "disp-barber-1",
        appointmentId: "apt-mixed-1",
        channel: "WHATSAPP",
        recipientRole: "BARBER",
        provider: "PONTIUN",
        recipient: "+5491166669999",
        status: "FAILED",
        errorCode: "TEMPLATE_NOT_APPROVED",
        errorDescription: "TEMPLATE_NOT_APPROVED",
        attempts: 1,
        requestedAt: "2026-11-23T15:00:00Z",
        createdAt: "2026-11-23T15:00:00Z",
        updatedAt: "2026-11-23T15:00:06Z",
      },
    },
  };
}

function makeChain(result: { data: any; error: any }) {
  const chain: any = {
    select: () => chain,
    in: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: (val: any) => any) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

describe("WhatsApp dispatch recipient clarity (Client vs Barber) & error translation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockV2State.appointments = [makeMixedAppointment()];
  });

  afterEach(() => {
    cleanup();
  });

  it("translates technical error codes into clear Spanish messages", () => {
    expect(translateDispatchError("TEMPLATE_NOT_APPROVED", "TEMPLATE_NOT_APPROVED")).toBe(
      "Plantilla pendiente en Meta",
    );
    expect(translateDispatchError("131042", null)).toBe(
      "Configuración de facturación pendiente en Meta (131042)",
    );
    expect(translateDispatchError("RATE_LIMITED", "RATE_LIMITED")).toBe(
      "Límite temporal de envíos alcanzado; reintentá en unos minutos",
    );
    expect(translateDispatchError("SOME_RAW_CODE", "SOME_RAW_CODE")).toBe(
      "No se pudo completar el envío",
    );
    expect(formatCompactDispatchStatus(undefined)).toBe("Sin envío");
    expect(formatCompactDispatchStatus({ status: "SENT" } as any)).toBe("Enviado");
    expect(formatCompactDispatchStatus({ status: "FAILED" } as any)).toBe("Error");
  });

  it("separates whatsappClient and whatsappBarber in fetchRealAppointments without overwriting whatsapp", async () => {
    const today = businessDateToday();
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === "appointments") {
        return makeChain({
          data: [
            {
              id: "apt-db-1",
              request_number: 401,
              client_id: "c-1",
              barber_id: "barber-lautaro",
              service_id: "svc-corte-id",
              appointment_date: today,
              start_time: "11:00:00",
              end_time: "11:45:00",
              status: "CONFIRMED",
              notes: "",
              created_at: "2026-11-23T14:00:00Z",
              is_manual: true,
              origin: "MANUAL",
            },
          ],
          error: null,
        });
      }
      if (table === "clients") {
        return makeChain({
          data: [{ id: "c-1", name: "Lucas Gómez", email: "lucas@example.com", phone: "+5491155551234" }],
          error: null,
        });
      }
      if (table === "barbers") {
        return makeChain({
          data: [{ id: "barber-lautaro", name: "Lautaro" }],
          error: null,
        });
      }
      if (table === "services") {
        return makeChain({
          data: [{ id: "svc-corte-id", name: "Corte", duration_minutes: 45, price_ars: 25000 }],
          error: null,
        });
      }
      if (table === "appointment_notification_dispatches") {
        return makeChain({
          data: [
            {
              id: "d-client",
              appointment_id: "apt-db-1",
              channel: "WHATSAPP",
              recipient_role: "CLIENT",
              provider: "PONTIUN",
              recipient: "+5491155551234",
              status: "SENT",
              attempts: 1,
              requested_at: "2026-11-23T15:00:00Z",
              created_at: "2026-11-23T15:00:00Z",
              updated_at: "2026-11-23T15:00:05Z",
            },
            {
              id: "d-barber",
              appointment_id: "apt-db-1",
              channel: "WHATSAPP",
              recipient_role: "BARBER",
              provider: "PONTIUN",
              recipient: "+5491166669999",
              status: "FAILED",
              error_code: "TEMPLATE_NOT_APPROVED",
              error_description: "TEMPLATE_NOT_APPROVED",
              attempts: 1,
              requested_at: "2026-11-23T15:00:00Z",
              created_at: "2026-11-23T15:00:00Z",
              updated_at: "2026-11-23T15:00:06Z",
            },
          ],
          error: null,
        });
      }
      return makeChain({ data: [], error: null });
    });

    const result = await readRealAppointments({ bypassCache: true });
    expect(result).toHaveLength(1);
    const apt = result[0]!;
    expect(apt.dispatches?.whatsappClient?.status).toBe("SENT");
    expect(apt.dispatches?.whatsappBarber?.status).toBe("FAILED");
    expect(apt.dispatches?.whatsappBarber?.errorCode).toBe("TEMPLATE_NOT_APPROVED");
    expect(apt.dispatches?.whatsapp?.status).toBe("SENT");
  });

  it("shows separate Client (Enviado) and Barber (Error + Plantilla pendiente en Meta) in mobile channelModal", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("max-width: 639px"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<V2Appointments />);

    const waBtn = screen.getByRole("button", { name: "WhatsApp" });
    fireEvent.click(waBtn);

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Cliente (Lucas Gómez):");
    expect(dialog.textContent).toContain("Enviado");
    expect(dialog.textContent).toContain("Barbero (Lautaro):");
    expect(dialog.textContent).toContain("Error");
    expect(dialog.textContent).toContain("Barbero: Plantilla pendiente en Meta");
    expect(dialog.textContent).not.toContain("TEMPLATE_NOT_APPROVED");
    expect(screen.getByText(/Contactar cliente/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reenviar notificación/i })).toBeTruthy();
  });

  it("shows Client vs Barber breakdown and translated error in desktop selectedNotifDetail", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<V2Appointments />);

    const waBtn = screen.getByRole("button", { name: /Diagnóstico WhatsApp/i });
    fireEvent.click(waBtn);

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Cliente (Lucas Gómez):");
    expect(dialog.textContent).toContain("Barbero (Lautaro):");
    expect(dialog.textContent).toContain("Barbero: Plantilla pendiente en Meta");
    expect(dialog.textContent).not.toContain("TEMPLATE_NOT_APPROVED");
  });

  it("allows clicking Barber Error pill in channelModal to confirm and resend specifically to BARBER", async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("max-width: 639px"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    mockRetryChannel.mockResolvedValue({
      success: true,
      channel: "WHATSAPP",
      recipientRole: "BARBER",
      status: "SENT",
      providerMessageId: "wamid.barber.retry.1",
      dispatch: {
        id: "disp-barber-1",
        appointmentId: "apt-mixed-1",
        channel: "WHATSAPP",
        recipientRole: "BARBER",
        provider: "PONTIUN",
        recipient: "+5491166669999",
        status: "SENT",
        providerMessageId: "wamid.barber.retry.1",
        attempts: 2,
        requestedAt: "2026-11-23T15:00:00Z",
        createdAt: "2026-11-23T15:00:00Z",
        updatedAt: "2026-11-23T16:00:00Z",
      },
    });

    render(<V2Appointments />);

    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));
    const errorPillBtn = screen.getByRole("button", { name: /Error ↻/i });
    fireEvent.click(errorPillBtn);

    const confirmRegion = screen.getByRole("region", { name: /Confirmar reenvío por destinatario/i });
    expect(confirmRegion.textContent).toContain("¿Reenviar aviso de WhatsApp a Lautaro (+54 9 11 6666-9999)?");
    expect(formatWhatsAppPhoneDisplay("+541158810005")).toBe("+54 9 11 5881-0005");
    expect(formatWhatsAppPhoneDisplay("+5491158810005")).toBe("+54 9 11 5881-0005");

    fireEvent.click(screen.getByRole("button", { name: "Reenviar" }));

    await vi.waitFor(() => {
      expect(mockRetryChannel).toHaveBeenCalledWith({
        data: {
          appointmentId: "apt-mixed-1",
          channel: "WHATSAPP",
          recipientRole: "BARBER",
          forceResend: true,
          token: "test-token",
        },
      });
    });

    await vi.waitFor(() => {
      expect(screen.getByRole("dialog").textContent).toContain("Notificación de WhatsApp al barbero");
    });
  });

  it("renders Finalizado badge on finished appointments and highlights/scrolls to appointmentId from URL", () => {
    const yesterday = "2026-11-22";
    const pastApt = makeMixedAppointment();
    pastApt.id = "apt-target-url";
    pastApt.date = yesterday;
    mockV2State.appointments = [pastApt];

    window.history.replaceState({}, "", `/panel-turnos?appointmentId=apt-target-url&date=${yesterday}`);
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { container } = render(<V2Appointments />);
    const card = container.querySelector('[data-appointment-id="apt-target-url"]');
    expect(card).toBeTruthy();
    expect(card?.className).toContain("v2-appointment--highlighted");
    expect(screen.getByText("Finalizado")).toBeTruthy();
    expect(scrollIntoViewMock).toHaveBeenCalled();

    window.history.replaceState({}, "", "/");
  });
});
