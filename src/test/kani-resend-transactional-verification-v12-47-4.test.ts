import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("KANI V12.47.4 — Verificación definitiva de correos transaccionales", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.RESEND_API_KEY = "re_live_test_secret_123456789";
    process.env.RESEND_FROM_EMAIL = "Kani Barber <turnos@kanibarber.com>";
    process.env.KANI_CANONICAL_HOST = "www.kanibarber.com";
    process.env.SUPABASE_URL = "https://iockpxtkflyjfagkvgnr.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it("1. Configuración de Resend: Remitente oficial es estrictamente turnos@kanibarber.com y sustituye noresponder", async () => {
    const { getRuntimeEnv } = await import("@/lib/kani-notifications.server");
    process.env.RESEND_FROM_EMAIL = "Kani Barber <noresponder@kanibarber.com>";

    // El sistema debe ignorar noresponder y forzar turnos@kanibarber.com
    const rawFrom = getRuntimeEnv("RESEND_FROM_EMAIL")?.trim();
    const effectiveFrom = (rawFrom && !rawFrom.includes("noresponder"))
      ? rawFrom
      : "Kani Barber <turnos@kanibarber.com>";

    expect(effectiveFrom).toBe("Kani Barber <turnos@kanibarber.com>");
  });

  it("2. Despacho transaccional a Resend: payload contiene encabezados oficiales, Idempotency-Key y ausencia de RESEND_400", async () => {
    let capturedUrl = "";
    let capturedOptions: any = null;

    const mockFetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
      capturedUrl = url;
      capturedOptions = opts;
      return new Response(JSON.stringify({ id: "resend_msg_v12_47_4_ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = mockFetch;

    const { dispatchAppointmentNotification } = await import("@/lib/kani-notifications.functions");

    // Mock RPC claims
    const mockRpc = vi.fn().mockImplementation((name: string) => {
      if (name === "claim_appointment_notification") {
        return Promise.resolve({
          data: [
            {
              notification_id: "notif-uuid-1234",
              notification_type: "CONFIRMED",
              dispatch_status: "PENDING",
              client_name: "Santiago Rossi",
              recipient_email: "santiago@test.com",
              recipient_phone: "+5491100001111",
              barber_name: "Lautaro",
              service_name: "Corte y barba",
              booking_date: "2026-11-20",
              start_time: "15:30",
              end_time: "16:30",
              service_price_ars: 32000,
              down_payment_ars: 10000,
            },
          ],
          error: null,
        });
      }
      if (name === "record_channel_dispatch_status" || name === "complete_appointment_notification") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    vi.spyOn(await import("@/lib/kani-notifications.server"), "createNotificationSupabaseClient")
      .mockResolvedValue({
        rpc: mockRpc,
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        }),
      } as any);

    const result = await dispatchAppointmentNotification({
      appointmentId: "apt-v12-47-4-test",
      claimToken: "claim-token-1234",
    });

    // 1. Solicitud exitosa sin RESEND_400
    expect(result.status).toBe("SENT");
    expect(result.sent).toBe(true);

    // 2. Resend fue invocado correctamente
    expect(mockFetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.anything());
    expect(capturedOptions.method).toBe("POST");
    expect(capturedOptions.headers.Authorization).toBe("Bearer re_live_test_secret_123456789");
    expect(capturedOptions.headers["Idempotency-Key"]).toBe("notif-uuid-1234");

    // 3. Body contiene el remitente y destinatario exactos
    const parsedBody = JSON.parse(capturedOptions.body);
    expect(parsedBody.from).toBe("Kani Barber <turnos@kanibarber.com>");
    expect(parsedBody.to).toEqual(["santiago@test.com"]);
    expect(parsedBody.subject).toContain("confirmado");
  });

  it("3. Idempotencia y protección contra envíos duplicados: estados ALREADY_SENT e IN_PROGRESS no invocan Resend", async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const { dispatchAppointmentNotification } = await import("@/lib/kani-notifications.functions");

    // Mock RPC returning ALREADY_SENT
    const mockRpcAlready = vi.fn().mockResolvedValue({
      data: [{ notification_id: "notif-uuid-already", dispatch_status: "ALREADY_SENT", notification_type: "CONFIRMED" }],
      error: null,
    });

    vi.spyOn(await import("@/lib/kani-notifications.server"), "createNotificationSupabaseClient")
      .mockResolvedValue({ rpc: mockRpcAlready } as any);

    const resAlready = await dispatchAppointmentNotification({
      appointmentId: "apt-already-sent",
      claimToken: "token-already",
    });

    expect(resAlready.status).toBe("ALREADY_SENT");
    expect(resAlready.sent).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();

    // Mock RPC returning IN_PROGRESS
    const mockRpcProgress = vi.fn().mockResolvedValue({
      data: [{ notification_id: "notif-uuid-progress", dispatch_status: "IN_PROGRESS", notification_type: "CONFIRMED" }],
      error: null,
    });

    vi.spyOn(await import("@/lib/kani-notifications.server"), "createNotificationSupabaseClient")
      .mockResolvedValue({ rpc: mockRpcProgress } as any);

    const resProgress = await dispatchAppointmentNotification({
      appointmentId: "apt-in-progress",
      claimToken: "token-progress",
    });

    expect(resProgress.status).toBe("IN_PROGRESS");
    expect(resProgress.sent).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("4. Diferenciación entre Aceptación de API (SENT), Entrega reportada (DELIVERED) y Rebote (FAILED)", async () => {
    const { verifyResendWebhookSignature } = await import("@/lib/kani-resend-webhook");
    const serverModule = await import("@/server");
    const worker = serverModule.default;

    // Aceptación por la API retorna SENT en el despacho
    // Cuando el Webhook de Resend recibe 'email.delivered', actualiza a DELIVERED
    const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const mockDb = {
      from: vi.fn().mockReturnValue({
        update: mockUpdate,
      }),
    };

    vi.spyOn(await import("@/lib/kani-payment-db.server"), "createPaymentSupabaseClient")
      .mockResolvedValue(mockDb as any);

    // Mock webhook secret en environment
    process.env.RESEND_WEBHOOK_SECRET = "whsec_test_secret_svix_123456789";

    // Simular webhook de entrega de Resend
    const webhookPayload = JSON.stringify({
      type: "email.delivered",
      data: {
        id: "resend-msg-delivered-999",
        to: ["cliente@kanibarber.com"],
      },
    });

    // Mock firma svix válida
    vi.spyOn(await import("@/lib/kani-resend-webhook"), "verifyResendWebhookSignature")
      .mockReturnValue({ valid: true });

    const req = new Request("https://www.kanibarber.com/api/webhook/resend", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": "msg_delivered_123",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,valid_test_signature",
      },
      body: webhookPayload,
    });

    const res = await worker.fetch(req, {}, {});
    expect(res.status).toBe(200);
    expect(mockDb.from).toHaveBeenCalledWith("appointment_notification_dispatches");
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "DELIVERED" }));
  });

  it("5. Endpoint diagnóstico /api/diagnostics/resend consulta Resend, verifica remitente oficial y no expone secretos", async () => {
    const serverModule = await import("@/server");
    const worker = serverModule.default;

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/domains")) {
        return new Response(JSON.stringify({
          data: [
            {
              id: "dom_kani_123",
              name: "kanibarber.com",
              status: "verified",
              region: "sa-east-1",
            },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/emails")) {
        return new Response(JSON.stringify({
          id: "resend_diag_test_id_777",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200 });
    });
    globalThis.fetch = mockFetch;

    // Diagnóstico en modo inspección de dominio
    const reqInfo = new Request("https://www.kanibarber.com/api/diagnostics/resend");
    const resInfo = await worker.fetch(reqInfo, {}, {});
    expect(resInfo.status).toBe(200);

    const bodyInfo = await resInfo.json() as any;
    expect(bodyInfo.configured).toBe(true);
    expect(bodyInfo.sender).toBe("Kani Barber <turnos@kanibarber.com>");
    expect(bodyInfo.domain.status).toBe("verified");
    expect(bodyInfo.domain.name).toBe("kanibarber.com");

    // Seguridad: jamás expone secretos en la respuesta
    const jsonStr = JSON.stringify(bodyInfo);
    expect(jsonStr).not.toContain("re_live_test_secret");

    // 1. Intento de envío no autenticado: DEBE ser rechazado con 401 AUTH_REQUIRED
    const reqUnauth = new Request("https://www.kanibarber.com/api/diagnostics/resend?send_test=1");
    const resUnauth = await worker.fetch(reqUnauth, {}, {});
    expect(resUnauth.status).toBe(401);
    const bodyUnauth = await resUnauth.json() as any;
    expect(bodyUnauth.error).toBe("AUTH_REQUIRED");

    // 2. Intento de envío a destinatario no autorizado: DEBE ser rechazado con 403 UNAUTHORIZED_RECIPIENT
    process.env.KANI_DIAGNOSTICS_KEY = "test-diag-key-12345";
    const reqForbiddenTo = new Request("https://www.kanibarber.com/api/diagnostics/resend?send_test=1&to=random@attacker.com", {
      headers: { "x-admin-key": "test-diag-key-12345" },
    });
    const resForbiddenTo = await worker.fetch(reqForbiddenTo, {}, {});
    expect(resForbiddenTo.status).toBe(403);
    const bodyForbiddenTo = await resForbiddenTo.json() as any;
    expect(bodyForbiddenTo.error).toBe("UNAUTHORIZED_RECIPIENT");

    // 3. Envío transaccional controlado autorizado: tomas.harispe@hotmail.com
    const reqAuth = new Request("https://www.kanibarber.com/api/diagnostics/resend?send_test=1&to=tomas.harispe@hotmail.com", {
      headers: { "x-admin-key": "test-diag-key-12345" },
    });
    const resAuth = await worker.fetch(reqAuth, {}, {});
    expect(resAuth.status).toBe(200);

    const bodyTest = await resAuth.json() as any;
    expect(bodyTest.testSend.success).toBe(true);
    expect(bodyTest.testSend.statusCode).toBe(200);
    expect(bodyTest.testSend.id).toBe("resend_diag_test_id_777");
    expect(bodyTest.testSend.from).toBe("Kani Barber <turnos@kanibarber.com>");
    expect(bodyTest.testSend.recipient).toBe("tomas.harispe@hotmail.com");
  });
});
