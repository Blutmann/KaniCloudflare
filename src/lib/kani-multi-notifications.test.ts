import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBarberContact, KANI_BARBER_CONTACTS } from "./kani-barber-contacts";
import {
  sendPontiunAppointmentConfirmation,
  sendPontiunBarberAppointmentConfirmation,
  sendPontiunClientAppointmentCancellation,
  sendPontiunBarberAppointmentCancellation,
} from "./kani-pontiun";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("./kani-notifications.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./kani-notifications.server")>();
  return {
    ...actual,
    createNotificationSupabaseClient: vi.fn(async () => ({
      rpc: mocks.rpc,
      from: mocks.from,
    })),
    createRequestSupabaseClient: vi.fn(async () => ({
      rpc: mocks.rpc,
      from: mocks.from,
    })),
    getRequestAuthToken: vi.fn(() => undefined),
  };
});

function buildSupabaseTableMock(tables: Record<string, any[]>) {
  return (table: string) => {
    const rows = tables[table] ?? [];
    const chain: any = {
      _filters: [] as Array<(r: any) => boolean>,
      select: () => chain,
      eq: (col: string, val: any) => {
        chain._filters.push((r: any) => r?.[col] === val);
        return chain;
      },
      in: (col: string, vals: any[]) => {
        chain._filters.push((r: any) => vals.includes(r?.[col]));
        return chain;
      },
      is: (col: string, val: any) => {
        chain._filters.push((r: any) => (r?.[col] ?? null) === val);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        const filtered = rows.filter((r) => chain._filters.every((fn: any) => fn(r)));
        return { data: filtered[0] ?? null, error: null };
      },
      then: (resolve: any) => {
        const filtered = rows.filter((r) => chain._filters.every((fn: any) => fn(r)));
        return Promise.resolve({ data: filtered, error: null }).then(resolve);
      },
    };
    return chain;
  };
}

describe("Kani Barber Contacts Registry", () => {
  it("resolves all 4 official barbers with accent/case normalization", () => {
    expect(KANI_BARBER_CONTACTS).toHaveLength(4);
    expect(resolveBarberContact({ barberId: "uuid-1", barberName: "Lautaro" })).toMatchObject({
      whatsapp: "5491131486834",
      email: "lautarodejesus08@gmail.com",
      source: "registry",
    });
    expect(resolveBarberContact({ barberId: "uuid-2", barberName: "gonzalo" })).toMatchObject({
      whatsapp: "5491136360003",
      email: "gonzalomatiasss123@gmail.com",
    });
    expect(resolveBarberContact({ barberId: "uuid-3", barberName: "Valentin" })).toMatchObject({
      whatsapp: "5491133992102",
      email: "carrizovalentin10@gmail.com",
    });
    expect(resolveBarberContact({ barberId: "uuid-4", barberName: "Franco" })).toMatchObject({
      whatsapp: "5491139566333",
      email: "Franco.dejesus.02@gmail.com",
    });
  });

  it("returns missing contact safely when barber is unknown", () => {
    expect(resolveBarberContact({ barberId: "uuid-x", barberName: "Desconocido" })).toEqual({
      barberId: "uuid-x",
      barberName: "Desconocido",
      whatsapp: null,
      email: null,
      source: "missing",
    });
  });
});

describe("Pontiun 4 WhatsApp Templates & Parameters", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.PONTIUN_API_KEY = "pk_test_123";
    process.env.PONTIUN_PHONE_NUMBER_ID = "1443960902134586";
    process.env.PONTIUN_TEMPLATE_LANGUAGE = "es_AR";
    delete process.env.PONTIUN_CLIENT_CONFIRMED_TEMPLATE_NAME;
    delete process.env.PONTIUN_TEMPLATE_NAME;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("sends Client Confirmed with 5 exact params and operational template by default", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ resender: { messageId: "wa-c-1" } }), { status: 200 }),
    );

    const res = await sendPontiunAppointmentConfirmation({
      appointmentId: "apt-1",
      clientName: "Juan Pérez",
      clientPhone: "+54 9 11 5555-1234",
      barberName: "Lautaro",
      serviceName: "Corte + barba",
      bookingDate: "2026-11-20",
      startTime: "15:30:00",
    });

    expect(res.success).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://pontiun.com/api/meta/whatsapp/templates/send");
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      "kani-appointment-apt-1-confirmed",
    );
    const body = JSON.parse(String(init?.body));
    expect(body.template.name).toBe("kani_cliente_turno_confirmado_v2");
    expect(body.template.language).toBe("es_AR");
    expect(body.template.components[0].parameters.map((p: any) => p.text)).toEqual([
      "Juan Pérez",
      "20/11/2026",
      "15:30",
      "Corte y barba",
      "Lautaro",
    ]);
  });

  it("sends Barber Confirmed with 11 exact params and distinct Idempotency-Key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ resender: { messageId: "wa-b-1" } }), { status: 200 }),
    );

    const res = await sendPontiunBarberAppointmentConfirmation({
      appointmentId: "apt-1",
      barberName: "Gonzalo",
      barberPhone: "5491136360003",
      clientName: "Juan Pérez",
      bookingDate: "2026-11-20",
      startTime: "15:30:00",
      serviceName: "Corte",
      clientWhatsApp: "5491155551234",
      clientEmail: "juan@example.com",
      totalPriceArs: 25000,
      accreditedAmountArs: 5000,
      accreditedPaymentMethod: "Transferencia",
      remainingBalanceArs: 20000,
    });

    expect(res.success).toBe(true);
    const [, init] = fetchSpy.mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      "kani-appointment-apt-1-confirmed-barber",
    );
    const body = JSON.parse(String(init?.body));
    expect(body.recipientId).toBe("5491136360003");
    expect(body.template.name).toBe("kani_barbero_turno_confirmado");
    expect(body.template.components[0].parameters.map((p: any) => p.text)).toEqual([
      "Gonzalo",
      "Juan Pérez",
      "20/11/2026",
      "15:30",
      "Corte de cabello",
      "5491155551234",
      "juan@example.com",
      "$25.000",
      "$5.000",
      "Transferencia",
      "$20.000",
    ]);
  });

  it("sends Client Cancelled (4 params) and Barber Cancelled (6 params)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ resender: { messageId: "wa-cancel" } }), { status: 200 }),
    );

    await sendPontiunClientAppointmentCancellation({
      appointmentId: "apt-2",
      clientName: "Ana",
      clientPhone: "1144445555",
      barberName: "Valentín",
      bookingDate: "2026-11-21",
      startTime: "11:00:00",
    });

    await sendPontiunBarberAppointmentCancellation({
      appointmentId: "apt-2",
      barberName: "Valentín",
      barberPhone: "5491133992102",
      clientName: "Ana",
      bookingDate: "2026-11-21",
      startTime: "11:00:00",
      clientWhatsApp: "5491144445555",
      clientEmail: "ana@example.com",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const clientBody = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body));
    expect(clientBody.template.name).toBe("kani_cliente_turno_cancelado");
    expect(clientBody.template.components[0].parameters.map((p: any) => p.text)).toEqual([
      "Ana",
      "Valentín",
      "21/11/2026",
      "11:00",
    ]);

    const barberBody = JSON.parse(String(fetchSpy.mock.calls[1]![1]?.body));
    expect(barberBody.template.name).toBe("kani_barbero_turno_cancelado");
    expect(barberBody.template.components[0].parameters.map((p: any) => p.text)).toEqual([
      "Valentín",
      "Ana",
      "21/11/2026",
      "11:00",
      "5491144445555",
      "ana@example.com",
    ]);
  });

  it("handles 409 template_not_approved without retry loops", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: "template_not_approved", templateStatus: "PENDING" }),
        { status: 409 },
      ),
    );

    const res = await sendPontiunBarberAppointmentConfirmation({
      appointmentId: "apt-409",
      barberName: "Franco",
      barberPhone: "5491139566333",
      clientName: "Pedro",
      bookingDate: "2026-11-22",
      startTime: "16:00:00",
      serviceName: "Barba",
      clientWhatsApp: "5491122223333",
      clientEmail: "pedro@example.com",
      totalPriceArs: 5000,
      accreditedAmountArs: 5000,
      accreditedPaymentMethod: "Mercado Pago",
      remainingBalanceArs: 0,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("TEMPLATE_NOT_APPROVED");
    expect(res.retryable).toBe(false);
  });
});

describe("dispatchAppointmentNotification multi-recipient & edge cases", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    process.env.PONTIUN_API_KEY = "pk_test_123";
    process.env.PONTIUN_PHONE_NUMBER_ID = "1443960902134586";
    process.env.RESEND_API_KEY = "re_test_123";
    process.env.RESEND_FROM_EMAIL = "Kani Barber <turnos@kanibarber.com>";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("dispatches 4 notifications (CLIENT+BARBER x WA+EMAIL) for CONFIRMED with Transferencia & discount", async () => {
    const { dispatchAppointmentNotification } = await import("./kani-notifications.functions");

    mocks.from.mockImplementation(
      buildSupabaseTableMock({
        appointments: [
          {
            id: "apt-conf-1",
            status: "CONFIRMED",
            barber_id: "barber-franco",
            service_price_ars: 20000,
            deposit_paid: true,
            deposit_amount_ars: 5000,
            balance_paid: false,
            benefit_final_price_ars: 18000,
            barbers: { id: "barber-franco", name: "Franco" },
            services: { id: "srv-1", name: "Corte + barba", price_ars: 20000 },
            clients: { id: "cli-1", name: "Lucas", email: "lucas@test.com", phone: "1155550000" },
          },
        ],
        payment_attempts: [],
        mercadopago_orders: [],
        service_payments: [{ appointment_id: "apt-conf-1", amount_ars: 5000, payment_method: "TRANSFER" }],
        appointment_notification_dispatches: [],
      }),
    );

    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "claim_appointment_notification") {
        return {
          data: [
            {
              notification_id: "ev-conf-1",
              notification_type: "CONFIRMED",
              recipient_email: "lucas@test.com",
              recipient_phone: "1155550000",
              client_name: "Lucas",
              barber_name: "Franco",
              service_name: "Corte + barba",
              booking_date: "2026-11-28",
              start_time: "17:00:00",
              end_time: "17:45:00",
              client_notes: null,
              service_price_ars: 20000,
              service_duration_minutes: 45,
              down_payment_ars: 5000,
              dispatch_status: "READY",
              attempt: 1,
            },
          ],
          error: null,
        };
      }
      return { data: "ok", error: null };
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("pontiun.com")) {
        return new Response(JSON.stringify({ resender: { messageId: "wa-ok" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "email-ok" }), { status: 200 });
    });

    const res = await dispatchAppointmentNotification({
      appointmentId: "apt-conf-1",
      claimToken: "claim-tok-1",
    });

    expect(res).toEqual({ sent: true, status: "SENT" });
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    // Verify Barber WA got Transferencia and $18.000 - $5.000 = $13.000
    const barberWaCall = fetchSpy.mock.calls.find(
      ([u, i]) =>
        String(u).includes("pontiun.com") &&
        JSON.parse(String(i?.body)).template.name === "kani_barbero_turno_confirmado",
    );
    expect(barberWaCall).toBeTruthy();
    const barberWaParams = JSON.parse(String(barberWaCall![1]?.body)).template.components[0].parameters.map(
      (p: any) => p.text,
    );
    expect(barberWaParams[7]).toBe("$18.000");
    expect(barberWaParams[8]).toBe("$5.000");
    expect(barberWaParams[9]).toBe("Transferencia");
    expect(barberWaParams[10]).toBe("$13.000");

    // Verify all 4 dispatches were recorded with distinct recipient_role
    const dispatchRpcCalls = mocks.rpc.mock.calls.filter(([fn]) => fn === "record_channel_dispatch_status");
    expect(dispatchRpcCalls).toHaveLength(4);
    expect(
      dispatchRpcCalls.map(([, args]) => `${args.p_recipient_role}:${args.p_channel}:${args.p_status}`),
    ).toEqual([
      "CLIENT:WHATSAPP:PROVIDER_ACCEPTED",
      "BARBER:WHATSAPP:PROVIDER_ACCEPTED",
      "CLIENT:EMAIL:SENT",
      "BARBER:EMAIL:SENT",
    ]);
  });

  it("aborts stale CONFIRMED event when appointment is PENDING or already CANCELLED (race condition)", async () => {
    const { dispatchAppointmentNotification } = await import("./kani-notifications.functions");

    mocks.from.mockImplementation(
      buildSupabaseTableMock({
        appointments: [{ id: "apt-race", status: "CANCELLED", barber_id: "b1" }],
      }),
    );
    mocks.rpc.mockResolvedValue({
      data: [
        {
          notification_id: "ev-race",
          notification_type: "CONFIRMED",
          recipient_email: "lucas@test.com",
          recipient_phone: "1155550000",
          client_name: "Lucas",
          barber_name: "Lautaro",
          service_name: "Corte",
          booking_date: "2026-11-28",
          start_time: "17:00:00",
          end_time: "17:45:00",
          dispatch_status: "READY",
          attempt: 1,
        },
      ],
      error: null,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await dispatchAppointmentNotification({
      appointmentId: "apt-race",
      claimToken: "claim-tok-race",
    });

    expect(res).toEqual({ sent: false, status: "SKIPPED", errorCode: "STALE_CONFIRMED_EVENT" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("isolates 409 template_not_approved on Barber WA without blocking Client WA or Emails", async () => {
    const { dispatchAppointmentNotification } = await import("./kani-notifications.functions");

    mocks.from.mockImplementation(
      buildSupabaseTableMock({
        appointments: [
          {
            id: "apt-partial",
            status: "CANCELLED",
            barber_id: "b1",
            barbers: { id: "b1", name: "Lautaro" },
          },
        ],
        payment_attempts: [],
        mercadopago_orders: [],
        service_payments: [],
        appointment_notification_dispatches: [],
      }),
    );

    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "claim_appointment_notification") {
        return {
          data: [
            {
              notification_id: "ev-cancel-partial",
              notification_type: "CANCELLED",
              recipient_email: "cli@test.com",
              recipient_phone: "1155550000",
              client_name: "Sofía",
              barber_name: "Lautaro",
              service_name: "Corte",
              booking_date: "2026-11-29",
              start_time: "12:00:00",
              end_time: "12:45:00",
              dispatch_status: "READY",
              attempt: 1,
            },
          ],
          error: null,
        };
      }
      return { data: "ok", error: null };
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).includes("pontiun.com")) {
        const body = JSON.parse(String(init?.body));
        if (body.template.name === "kani_barbero_turno_cancelado") {
          return new Response(
            JSON.stringify({ error: "template_not_approved", templateStatus: "PENDING" }),
            { status: 409 },
          );
        }
        return new Response(JSON.stringify({ resender: { messageId: "wa-cli-ok" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "email-ok" }), { status: 200 });
    });

    const res = await dispatchAppointmentNotification({
      appointmentId: "apt-partial",
      claimToken: "claim-tok-partial",
    });

    expect(res.sent).toBe(false);
    expect(res.status).toBe("FAILED");
    expect(res.errorCode).toContain("PARTIAL_DISPATCH_FAILURE");

    const dispatchRpcCalls = mocks.rpc.mock.calls.filter(([fn]) => fn === "record_channel_dispatch_status");
    expect(
      dispatchRpcCalls.map(([, args]) => `${args.p_recipient_role}:${args.p_channel}:${args.p_status}:${args.p_error_code ?? ""}`),
    ).toEqual([
      "CLIENT:WHATSAPP:PROVIDER_ACCEPTED:",
      "BARBER:WHATSAPP:FAILED:TEMPLATE_NOT_APPROVED",
      "CLIENT:EMAIL:SENT:",
      "BARBER:EMAIL:SENT:",
    ]);
  });
});
