import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSelectFromDispatches,
  mockSelectFromAppointments,
  mockSelectFromStaffProfiles,
  mockSelectFromEvents,
  mockGetUser,
  mockRecordChannelDispatchStatus,
} = vi.hoisted(() => ({
  mockSelectFromDispatches: vi.fn(),
  mockSelectFromAppointments: vi.fn(),
  mockSelectFromStaffProfiles: vi.fn(),
  mockSelectFromEvents: vi.fn(),
  mockGetUser: vi.fn(),
  mockRecordChannelDispatchStatus: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: (jwt?: string) => mockGetUser(jwt),
    },
    rpc: (fn: string, params: any) => {
      if (fn === "record_channel_dispatch_status") return mockRecordChannelDispatchStatus(params);
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      if (table === "staff_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => mockSelectFromStaffProfiles(),
            }),
          }),
        };
      }
      if (table === "appointment_notification_dispatches") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => mockSelectFromDispatches(),
              }),
            }),
          }),
        };
      }
      if (table === "appointments") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => mockSelectFromAppointments(),
            }),
          }),
        };
      }
      if (table === "appointment_notification_events") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => mockSelectFromEvents(),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      };
    },
  }),
}));

import { retryNotificationChannel } from "@/lib/kani-notifications.functions";

describe("Kani — Reintentos de notificaciones de email desde panel administrativo", () => {
  const baseAppointmentId = "apt-email-retry-001";
  const barberId = "barber-lautaro-uuid";

  const defaultAdminUser = {
    id: "admin-user-uuid",
    email: "admin@kanibarber.com",
  };

  const defaultStaffProfile = {
    role: "ADMIN",
    barber_id: null,
    active: true,
  };

  const defaultAppointment = {
    id: baseAppointmentId,
    booking_date: "2026-11-02",
    start_time: "15:00:00",
    end_time: "15:45:00",
    status: "CONFIRMED",
    notes: "Corte clásico",
    service_price_ars: 25000,
    custom_service_name: null,
    deposit_amount_ars: 5000,
    client_id: "c-1",
    barber_id: barberId,
    service_id: "s-1",
    clients: { id: "c-1", name: "Lautaro Cliente", phone: "+5491122334455", email: "cliente@example.com" },
    barbers: { id: barberId, name: "Lautaro" },
    services: { id: "s-1", name: "Corte", price_ars: 25000, duration_minutes: 45 },
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    process.env.SUPABASE_URL = "https://iockpxtkflyjfagkvgnr.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon-key";
    process.env.RESEND_API_KEY = "re_test_key_123456789";
    process.env.RESEND_FROM_EMAIL = "Kani Barber Studio <turnos@kanibarber.com>";

    mockGetUser.mockReset().mockResolvedValue({ data: { user: defaultAdminUser }, error: null });
    mockSelectFromStaffProfiles.mockReset().mockResolvedValue({ data: defaultStaffProfile, error: null });
    mockSelectFromDispatches.mockReset().mockResolvedValue({ data: null, error: null });
    mockSelectFromAppointments.mockReset().mockResolvedValue({ data: { ...defaultAppointment }, error: null });
    mockSelectFromEvents.mockReset().mockResolvedValue({ data: null, error: null });
    mockRecordChannelDispatchStatus.mockReset().mockResolvedValue({ data: "dispatch-uuid-1", error: null });
  });

  it("1. Validación: Turno confirmado sin despacho registrado permite generar la confirmación", async () => {
    mockSelectFromDispatches.mockResolvedValue({ data: null, error: null });
    mockSelectFromAppointments.mockResolvedValue({
      data: { ...defaultAppointment, status: "CONFIRMED" },
      error: null,
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "resend-confirmed-id-100" }),
    });
    globalThis.fetch = fetchSpy as any;

    const result = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: "valid-admin-token",
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("SENT");
    expect(result.providerMessageId).toBe("resend-confirmed-id-100");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": expect.stringContaining("kani-email-apt-email-retry-001-confirmed"),
        }),
      }),
    );

    const fetchBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(fetchBody.to).toEqual(["cliente@example.com"]);
    expect(fetchBody.subject).toContain("está confirmado");
    expect(fetchBody.html).toContain("KANI");
  });

  it("2. Validación: Turno cancelado sin despacho registrado permite generar la cancelación", async () => {
    mockSelectFromDispatches.mockResolvedValue({ data: null, error: null });
    mockSelectFromAppointments.mockResolvedValue({
      data: { ...defaultAppointment, status: "CANCELLED" },
      error: null,
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "resend-cancelled-id-200" }),
    });
    globalThis.fetch = fetchSpy as any;

    const result = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: "valid-admin-token",
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("SENT");
    expect(result.providerMessageId).toBe("resend-cancelled-id-200");

    const fetchBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(fetchBody.subject).toContain("canceló tu turno");
    expect(fetchBody.text).toContain("se canceló tu turno");
  });

  it("3. Validación: Notificación fallida permite reintentar y actualiza el diagnóstico", async () => {
    mockSelectFromDispatches.mockResolvedValue({
      data: {
        id: "disp-failed-id",
        appointment_id: baseAppointmentId,
        channel: "EMAIL",
        provider: "RESEND",
        status: "FAILED",
        error_code: "RESEND_500",
        error_description: "Internal Server Error",
        attempts: 2,
      },
      error: null,
    });
    mockSelectFromAppointments.mockResolvedValue({
      data: { ...defaultAppointment, status: "CONFIRMED" },
      error: null,
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "resend-recovered-id-300" }),
    });
    globalThis.fetch = fetchSpy as any;

    const result = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: "valid-admin-token",
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("SENT");
    expect(result.providerMessageId).toBe("resend-recovered-id-300");
    expect(result.dispatch?.attempts).toBe(3);
    expect(mockRecordChannelDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        p_channel: "EMAIL",
        p_status: "SENT",
        p_provider_message_id: "resend-recovered-id-300",
      }),
    );
  });

  it("4. Validación: Notificación ya enviada o entregada no genera un duplicado", async () => {
    mockSelectFromDispatches.mockResolvedValue({
      data: {
        id: "disp-sent-id",
        appointment_id: baseAppointmentId,
        channel: "EMAIL",
        status: "SENT",
        attempts: 1,
      },
      error: null,
    });
    mockSelectFromAppointments.mockResolvedValue({
      data: { ...defaultAppointment, status: "CONFIRMED" },
      error: null,
    });

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    const result = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: "valid-admin-token",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("RETRY_NOT_ALLOWED: La notificación ya fue aceptada por el proveedor");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("5. Validación: Doble clic o solicitudes concurrentes producen un solo despacho", async () => {
    mockSelectFromDispatches.mockResolvedValue({ data: null, error: null });
    mockSelectFromAppointments.mockResolvedValue({
      data: { ...defaultAppointment, status: "CONFIRMED" },
      error: null,
    });

    let delayResolve: (value: any) => void;
    const delayedPromise = new Promise((resolve) => {
      delayResolve = resolve;
    });

    const fetchSpy = vi.fn().mockImplementation(async () => {
      await delayedPromise;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "resend-concurrent-id" }),
      };
    });
    globalThis.fetch = fetchSpy as any;

    // Llamada 1
    const p1 = retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: "valid-admin-token",
    });

    // Llamada 2 concurrente (inmediatamente, antes de que p1 termine)
    const p2 = retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: "valid-admin-token",
    });

    const result2 = await p2;
    expect(result2.success).toBe(false);
    expect(result2.status).toBe("PROCESSING");
    expect(result2.error).toContain("RETRY_NOT_ALLOWED: Existe una operación de notificación en curso");

    // Completar llamada 1
    delayResolve!({});
    const result1 = await p1;
    expect(result1.success).toBe(true);

    // Resend solo fue invocado exactamente UNA vez
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("6. Validación: Turno en estado no compatible (PENDING, COMPLETED, NO_SHOW) no envía correo", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    // Estado PENDING
    mockSelectFromAppointments.mockResolvedValue({
      data: { ...defaultAppointment, status: "PENDING" },
      error: null,
    });
    let res = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: "valid-admin-token",
    });
    expect(res.success).toBe(false);
    expect(res.status).toBe("SKIPPED");
    expect(res.error).toContain("El turno se encuentra en estado 'Pendiente' (sin confirmar)");

    // Estado COMPLETED
    mockSelectFromAppointments.mockResolvedValue({
      data: { ...defaultAppointment, status: "COMPLETED" },
      error: null,
    });
    res = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: "valid-admin-token",
    });
    expect(res.success).toBe(false);
    expect(res.status).toBe("SKIPPED");
    expect(res.error).toContain("El turno ya fue realizado ('Ejecutado')");

    // Estado NO_SHOW
    mockSelectFromAppointments.mockResolvedValue({
      data: { ...defaultAppointment, status: "NO_SHOW" },
      error: null,
    });
    res = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: "valid-admin-token",
    });
    expect(res.success).toBe(false);
    expect(res.status).toBe("SKIPPED");
    expect(res.error).toContain("El turno fue registrado como 'Inasistencia'");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("7. Validación: Fallo del proveedor muestra el error sanitizado y registra FAILED", async () => {
    mockSelectFromDispatches.mockResolvedValue({ data: null, error: null });
    mockSelectFromAppointments.mockResolvedValue({
      data: { ...defaultAppointment, status: "CONFIRMED" },
      error: null,
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: "The recipient email with key re_secret_key_123 was invalid" }),
    });
    globalThis.fetch = fetchSpy as any;

    const result = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: "valid-admin-token",
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(result.error).not.toContain("re_secret_key_123");
    expect(result.error).toContain("[REDACTED_API_KEY]");
    expect(mockRecordChannelDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        p_channel: "EMAIL",
        p_status: "FAILED",
        p_error_code: "RESEND_422",
      }),
    );
  });

  it("8. Validación: Cambio de estado antes del despacho no envía una confirmación obsoleta", async () => {
    // Si el turno ahora está CANCELLED
    mockSelectFromDispatches.mockResolvedValue({ data: null, error: null });
    mockSelectFromAppointments.mockResolvedValue({
      data: { ...defaultAppointment, status: "CANCELLED" },
      error: null,
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "resend-cancelled-fresh-id" }),
    });
    globalThis.fetch = fetchSpy as any;

    const result = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: "valid-admin-token",
    });

    expect(result.success).toBe(true);
    const fetchBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(fetchBody.subject).toContain("canceló tu turno");
  });

  it("9. Validación: Usuario sin autorización administrativa es rechazado", async () => {
    // 9.1 Sin sesión / anónimo
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error("No session") });

    const resNoAuth = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: undefined,
    });
    expect(resNoAuth.success).toBe(false);
    expect(resNoAuth.error).toContain("AUTH_REQUIRED");

    // 9.2 Barbero ajeno intentando reintentar el turno de otro barbero
    mockGetUser.mockResolvedValue({ data: { user: { id: "other-barber-user" } }, error: null });
    mockSelectFromStaffProfiles.mockResolvedValue({
      data: { role: "BARBER", barber_id: "other-barber-uuid", active: true },
      error: null,
    });
    mockSelectFromAppointments.mockResolvedValue({
      data: { ...defaultAppointment, barber_id: barberId }, // barberId !== other-barber-uuid
      error: null,
    });

    const resForbidden = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: "barber-token",
    });
    expect(resForbidden.success).toBe(false);
    expect(resForbidden.error).toContain("ACCESS_DENIED");
  });

  it("10. Validación: Turnos pasados solo permiten confirmación con rol ADMIN", async () => {
    mockSelectFromDispatches.mockResolvedValue({ data: null, error: null });
    mockSelectFromAppointments.mockResolvedValue({
      data: {
        ...defaultAppointment,
        booking_date: "2026-10-25",
        start_time: "10:00:00",
        status: "CONFIRMED",
      },
      error: null,
    });

    // 10.1 Barbero intenta confirmar turno pasado -> bloqueado
    mockSelectFromStaffProfiles.mockResolvedValue({
      data: { role: "BARBER", barber_id: barberId, active: true },
      error: null,
    });

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    const resultBarber = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: "barber-token",
    });

    expect(resultBarber.success).toBe(false);
    expect(resultBarber.status).toBe("SKIPPED");
    expect(resultBarber.error).toContain("PAST_APPOINTMENT_CONFIRMATION_BLOCKED");
    expect(fetchSpy).not.toHaveBeenCalled();

    // 10.2 ADMIN autorizado -> permitido
    mockSelectFromStaffProfiles.mockResolvedValue({
      data: { role: "ADMIN", barber_id: null, active: true },
      error: null,
    });
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "resend-admin-past-id" }),
    });

    const resultAdmin = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
      token: "valid-admin-token",
    });

    expect(resultAdmin.success).toBe(true);
    expect(resultAdmin.status).toBe("SENT");
  });
});
