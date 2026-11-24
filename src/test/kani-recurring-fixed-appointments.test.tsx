import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { ManualAppointmentDialog } from "@/components/kani/v2/manual-appointment-dialog";
import { V2Appointments } from "@/components/kani/v2/agenda";
import type { RealAppointment } from "@/lib/kani-appointments";
import { addCalendarDays, businessDateToday } from "@/lib/kani-mobile-appointments";
import {
  sendPontiunAppointmentReminder,
  sendPontiunRecurringSeriesBarberConfirmation,
  sendPontiunRecurringSeriesClientConfirmation,
} from "@/lib/kani-pontiun";

const mockRefresh = vi.fn().mockResolvedValue(undefined);
const mockCreateRecurringManualSeries = vi.fn();
const mockModifyRecurringAppointmentSeries = vi.fn();
const mockUpdateRealAppointmentStatus = vi.fn();
const mockSendSeriesNotifications = vi.fn().mockResolvedValue({
  clientWhatsappSent: true,
  barberWhatsappSent: true,
  emailSent: true,
  warnings: [],
});

const mockState = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "BARBER",
  appointments: [] as Partial<RealAppointment>[],
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className }: { children: ReactNode; to?: string; className?: string }) => (
    <a href={typeof to === "string" ? to : "#"} className={className}>
      {children}
    </a>
  ),
  useLocation: ({ select }: { select?: (loc: { pathname: string }) => string } = {}) => {
    const loc = { pathname: "/panel-turnos" };
    return select ? select(loc) : loc;
  },
}));

vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    profile: {
      user_id: "user-1",
      role: mockState.role,
      barber_id: "barber-1",
      display_name: mockState.role === "BARBER" ? "Tomi" : "Admin",
      active: true,
    },
    barbers: [
      { id: "barber-1", name: "Tomi" },
      { id: "barber-2", name: "Valentín" },
    ],
  }),
}));

vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    barberId: "ALL",
    setBarberId: vi.fn(),
    services: [
      { id: "srv-1", dbId: "srv-1", name: "Corte", price: 30000, duration: 45 },
    ],
    clients: [
      { id: "client-1", name: "Lucas Gómez", phone: "1155551234", email: "lucas@test.com" },
    ],
    appointments: mockState.appointments,
    payments: [],
    depositSupported: true,
    refresh: mockRefresh,
  }),
}));

vi.mock("@/lib/kani-recurrences-memberships", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kani-recurrences-memberships")>();
  return {
    ...actual,
    createRecurringManualSeries: (...args: unknown[]) => mockCreateRecurringManualSeries(...args),
    modifyRecurringAppointmentSeries: (...args: unknown[]) =>
      mockModifyRecurringAppointmentSeries(...args),
  };
});

vi.mock("@/lib/kani-appointments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kani-appointments")>();
  return {
    ...actual,
    updateRealAppointmentStatus: (...args: unknown[]) => mockUpdateRealAppointmentStatus(...args),
  };
});

vi.mock("@/lib/kani-recurring-notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kani-recurring-notifications")>();
  return {
    ...actual,
    sendRecurringSeriesCreatedNotificationsServerFn: (...args: unknown[]) =>
      mockSendSeriesNotifications(...args),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "tok-123" } } }),
    },
  },
}));

describe("Turno fijo (se repite) — UI & Pontiun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.role = "ADMIN";
    mockState.appointments = [];
    vi.stubEnv("PONTIUN_API_KEY", "pk_test_123");
    vi.stubEnv("PONTIUN_PHONE_NUMBER_ID", "1443960902134586");
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders Turno fijo switch in CREATE mode with WEEKLY/BIWEEKLY and 60-day UNTIL_DATE default, and reports omittedCount", async () => {
    mockCreateRecurringManualSeries.mockResolvedValue({
      ruleId: "rule-99",
      createdCount: 7,
      omittedCount: 2,
      createdAppointments: [
        { id: "apt-1", bookingDate: "2026-11-27", startTime: "10:00", endTime: "10:45", servicePriceArs: 30000 },
        { id: "apt-2", bookingDate: "2026-12-04", startTime: "10:00", endTime: "10:45", servicePriceArs: 30000 },
      ],
      omittedConflicts: [],
    });

    const onSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate="2026-11-27"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    const toggle = screen.getByRole("switch", { name: /Turno fijo \(se repite\)/i });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);

    const freqSelect = screen.getByLabelText("Frecuencia") as HTMLSelectElement;
    const freqValues = Array.from(freqSelect.options).map((o) => o.value);
    expect(freqValues).toEqual(["WEEKLY", "BIWEEKLY"]);

    const durationSelect = screen.getByLabelText("Duración") as HTMLSelectElement;
    expect(durationSelect.value).toBe("60_DAYS");

    expect(screen.getByTestId("recurring-series-summary").textContent).toContain("26/01/2027");

    fireEvent.change(freqSelect, { target: { value: "BIWEEKLY" } });
    fireEvent.change(screen.getByLabelText(/Nombre del cliente/i), { target: { value: "Lucas Gómez" } });
    fireEvent.change(screen.getByLabelText(/Celular/i), { target: { value: "1155551234" } });

    fireEvent.click(screen.getByRole("button", { name: "Crear turno" }));

    await waitFor(() => expect(mockCreateRecurringManualSeries).toHaveBeenCalledTimes(1));

    const [inputArg] = mockCreateRecurringManualSeries.mock.calls[0]!;
    expect(inputArg).toMatchObject({
      frequencyType: "BIWEEKLY",
      endType: "UNTIL_DATE",
      endDate: "2027-01-26",
      pricingMode: "CURRENT_RATE",
      horizonDays: 60,
    });

    await waitFor(() => expect(mockSendSeriesNotifications).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith(
        "Serie fija creada (7 turnos). Se omitieron 2 fechas por estar ocupadas.",
      ),
    );
  });

  it("shows 🔁 Fijo badge and two cancellation options for recurring appointments as BARBER", async () => {
    mockState.role = "BARBER";
    mockState.appointments = [
      {
        id: "apt-rec-1",
        clientId: "client-1",
        barberId: "barber-1",
        barber: "Tomi",
        serviceId: "srv-1",
        serviceName: "Corte",
        serviceDuration: 45,
        servicePrice: 30000,
        date: addCalendarDays(businessDateToday(), 1),
        time: "10:00",
        endTime: "10:45",
        statusCode: "CONFIRMED",
        name: "Lucas Gómez",
        phone: "1155551234",
        isManual: true,
        recurringRuleId: "rule-99",
      },
    ];

    mockUpdateRealAppointmentStatus.mockResolvedValue({});
    mockModifyRecurringAppointmentSeries.mockResolvedValue({
      ruleId: "rule-99",
      scope: "THIS_AND_FOLLOWING",
      action: "CANCEL",
      affectedCount: 5,
      affectedAppointmentIds: ["apt-rec-1"],
      affectedDates: ["2099-11-27"],
    });

    render(<V2Appointments />);

    expect(screen.getByText("🔁 Fijo")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar turno" }));

    expect(screen.getByRole("button", { name: "Cancelar solo esta fecha" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finalizar toda la serie fija" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Finalizar toda la serie fija" }));

    await waitFor(() => expect(mockModifyRecurringAppointmentSeries).toHaveBeenCalledTimes(1));
    expect(mockModifyRecurringAppointmentSeries.mock.calls[0]![0]).toEqual({
      appointmentId: "apt-rec-1",
      scope: "THIS_AND_FOLLOWING",
      action: "CANCEL",
    });
  });

  it("builds Pontiun payloads for kani_cliente_turno_fijo_creado, kani_barbero_turno_fijo_creado, kani_cliente_recordatorio_turno and handles TEMPLATE_NOT_APPROVED", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messageId: "msg-1", metaMessageId: "wamid-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendPontiunRecurringSeriesClientConfirmation({
      ruleId: "rule-1",
      clientName: "Lucas Gómez",
      clientPhone: "1155551234",
      frequencyType: "WEEKLY",
      startDate: "2026-11-27",
      startTime: "10:00",
      lastAppointmentDate: "2027-01-22",
      barberName: "Valentín",
      serviceName: "Corte",
      bookedDates: ["2026-11-27", "2026-12-04", "2026-12-11"],
    });

    const clientBody = JSON.parse(fetchMock.mock.calls[0]![1].body) as {
      template: { name: string; language: string; components: Array<{ parameters: Array<{ text: string }> }> };
    };
    expect(clientBody.template.name).toBe("kani_cliente_turno_fijo_creado");
    expect(clientBody.template.language).toBe("es_AR");
    expect(clientBody.template.components[0]!.parameters.map((p) => p.text)).toEqual([
      "Lucas Gómez",
      "Todos los viernes a las 10:00 hs",
      "Viernes 22/01/2027",
      "Valentín",
      "Corte de cabello",
      "27/11 · 04/12 · 11/12",
    ]);

    await sendPontiunRecurringSeriesBarberConfirmation({
      ruleId: "rule-1",
      barberName: "Valentín",
      barberPhone: "1144445555",
      clientName: "Lucas Gómez",
      clientPhone: "1155551234",
      frequencyType: "WEEKLY",
      startDate: "2026-11-27",
      startTime: "10:00",
      lastAppointmentDate: "2027-01-22",
      serviceName: "Corte",
      bookedDates: ["2026-11-27", "2026-12-04", "2026-12-11"],
    });

    const barberBody = JSON.parse(fetchMock.mock.calls[1]![1].body) as {
      template: { name: string; language: string; components: Array<{ parameters: Array<{ text: string }> }> };
    };
    expect(barberBody.template.name).toBe("kani_barbero_turno_fijo_creado");
    expect(barberBody.template.language).toBe("es_AR");
    expect(barberBody.template.components[0]!.parameters.map((p) => p.text)).toEqual([
      "Valentín",
      "Lucas Gómez",
      "1155551234",
      "Todos los viernes a las 10:00 hs",
      "Viernes 22/01/2027",
      "Corte de cabello",
      "27/11 · 04/12 · 11/12",
    ]);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ code: "template_not_approved", templateStatus: "PENDING" }),
    });

    const remRes = await sendPontiunAppointmentReminder({
      appointmentId: "apt-1",
      clientName: "Lucas Gómez",
      clientPhone: "1155551234",
      bookingDate: "2026-11-27",
      startTime: "10:00",
      serviceName: "Corte",
      barberName: "Valentín",
      amountArs: 30000,
      cancellationUrl: "https://www.kanibarber.com/cancelar-turno?id=apt-1",
    });

    const remBody = JSON.parse(fetchMock.mock.calls[2]![1].body) as {
      template: { name: string; language: string; components: Array<{ parameters: Array<{ text: string }> }> };
    };
    expect(remBody.template.name).toBe("kani_cliente_recordatorio_turno");
    expect(remBody.template.components[0]!.parameters.map((p) => p.text)).toEqual([
      "Lucas Gómez",
      "Viernes 27/11/2026",
      "10:00",
      "Corte de cabello",
      "Valentín",
      "$ 30.000",
      "https://www.kanibarber.com/cancelar-turno?id=apt-1",
    ]);
    expect(remRes.success).toBe(false);
    expect(remRes.templatePendingOrUnapproved).toBe(true);
    expect(remRes.errorCode).toBe("TEMPLATE_NOT_APPROVED");
  });
});
