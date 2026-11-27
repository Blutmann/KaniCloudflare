// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServicePayment } from "@/lib/kani-payments";
import { deduplicatePaymentMovements, paymentSummary } from "@/lib/kani-v2";
import { businessDateToday } from "@/lib/kani-mobile-appointments";

const serverMocks = vi.hoisted(() => ({
  createRequestSupabaseClient: vi.fn(),
  createPaymentSupabaseClient: vi.fn(),
  v2Data: {
    appointments: [] as any[],
    payments: [] as ServicePayment[],
    clients: [] as any[],
    services: [{ id: "srv-corte", name: "Corte", price: 25000, duration: 45 }],
    barberId: "ALL",
    setBarberId: vi.fn(),
    loading: false,
    depositSupported: true,
    refresh: vi.fn(),
  },
  staff: {
    profile: { role: "ADMIN", barber_id: null, display_name: "Admin" },
    barbers: [
      { id: "barber-gonzalo", name: "Gonzalo" },
      { id: "barber-lautaro", name: "Lautaro" },
    ],
  },
}));

vi.mock("@/lib/kani-notifications.server", () => ({
  createRequestSupabaseClient: (...args: any[]) => serverMocks.createRequestSupabaseClient(...args),
}));

vi.mock("@/lib/kani-payment-db.server", () => ({
  createPaymentSupabaseClient: (...args: any[]) => serverMocks.createPaymentSupabaseClient(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({}),
  useLocation: ({ select }: any) => (select ? select({ pathname: "/panel-administracion/pagos" }) : { pathname: "/panel-administracion/pagos" }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn() },
}));

vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => serverMocks.staff,
}));

vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => serverMocks.v2Data,
}));

vi.mock("@/components/kani/v2/shared", () => ({
  BarberFilter: () => null,
  Empty: ({ children }: any) => <p>{children}</p>,
}));

import { readOnlineDepositMovementsServer } from "@/lib/kani-online-deposits.server";
import { V2Payments } from "@/components/kani/v2/payments";

function makeQueryMock(rows: any[], opts?: { failWith?: any; onEq?: (col: string, val: any) => void }) {
  let filtered = [...rows];
  const chain: any = {
    select: () => chain,
    eq: (col: string, val: any) => {
      opts?.onEq?.(col, val);
      filtered = filtered.filter((r) => r[col] === val);
      return chain;
    },
    in: (col: string, vals: any[]) => {
      filtered = filtered.filter((r) => vals.includes(r[col]));
      return chain;
    },
    order: () => chain,
    then: (resolve: any, reject: any) =>
      Promise.resolve(
        opts?.failWith
          ? { data: null, error: opts.failWith }
          : { data: filtered, error: null },
      ).then(resolve, reject),
  };
  return chain;
}

describe("Online deposit payment-date ledger (Mercado Pago + Payway)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverMocks.v2Data.appointments = [];
    serverMocks.v2Data.payments = [];
    serverMocks.v2Data.barberId = "ALL";
  });

  afterEach(() => {
    cleanup();
  });

  it("reads CONFIRMED Mercado Pago orders via service_role, sets paymentDate to real AR payment date, and preserves future appointmentDate", async () => {
    // Confirmed today at 2026-11-26 14:30 AR (17:30 UTC) for an appointment on 2026-12-03 15:00
    const mpConfirmedAt = "2026-11-26T17:30:00.000Z";
    const paywayApprovedAt = "2026-11-26T15:10:00.000Z";

    const appointments = [
      {
        id: "apt-mp-dec",
        barber_id: "barber-gonzalo",
        service_id: "srv-corte",
        custom_service_name: null,
        status: "CONFIRMED",
        deposit_paid: true,
        deposit_amount_ars: 5000,
        booking_date: "2026-12-03",
        start_time: "15:00:00",
        created_at: "2026-11-26T17:25:00.000Z",
        client_id: "cli-1",
      },
      {
        id: "apt-pw-dec",
        barber_id: "barber-lautaro",
        service_id: "srv-corte",
        custom_service_name: null,
        status: "CONFIRMED",
        deposit_paid: true,
        deposit_amount_ars: 5000,
        booking_date: "2026-12-05",
        start_time: "11:30:00",
        created_at: "2026-11-26T15:09:00.000Z",
        client_id: "cli-2",
      },
    ];

    const userClient = {
      from: (table: string) => {
        if (table === "payment_attempts") {
          return makeQueryMock([
            {
              id: "att-1",
              appointment_id: "apt-pw-dec",
              provider: "PAYWAY",
              amount_ars: 5000,
              state: "APPROVED",
              created_at: paywayApprovedAt,
              updated_at: paywayApprovedAt,
            },
          ]);
        }
        if (table === "appointments") return makeQueryMock(appointments);
        if (table === "clients") {
          return makeQueryMock([
            { id: "cli-1", name: "Juan Pérez", phone: "1155550001" },
            { id: "cli-2", name: "Lucas Gómez", phone: "1155550002" },
          ]);
        }
        if (table === "services") return makeQueryMock([{ id: "srv-corte", name: "Corte" }]);
        if (table === "barbers") {
          return makeQueryMock([
            { id: "barber-gonzalo", name: "Gonzalo" },
            { id: "barber-lautaro", name: "Lautaro" },
          ]);
        }
        return makeQueryMock([]);
      },
    };

    const serviceClient = {
      from: (table: string) => {
        if (table === "appointment_payment_orders") {
          return makeQueryMock([
            {
              appointment_id: "apt-mp-dec",
              order_id: "mp-order-1",
              expected_amount_ars: 5000,
              paid_amount_ars: 5000,
              reconciliation_status: "CONFIRMED",
              created_at: "2026-11-26T17:25:00.000Z",
              updated_at: mpConfirmedAt,
            },
          ]);
        }
        return makeQueryMock([]);
      },
    };

    serverMocks.createRequestSupabaseClient.mockResolvedValue(userClient);
    serverMocks.createPaymentSupabaseClient.mockResolvedValue(serviceClient);

    const movements = await readOnlineDepositMovementsServer(
      { date: "2026-11-26" },
      { profile: { role: "ADMIN", barber_id: null }, token: "valid-jwt" },
    );

    expect(serverMocks.createPaymentSupabaseClient).toHaveBeenCalledTimes(1);
    expect(movements).toHaveLength(2);

    const mpMove = movements.find((m) => m.appointmentId === "apt-mp-dec");
    expect(mpMove).toBeDefined();
    expect(mpMove?.paymentMethod).toBe("Mercado Pago");
    expect(mpMove?.paymentDate).toBe("2026-11-26");
    expect(mpMove?.paymentTime).toBe("14:30");
    expect(mpMove?.appointmentDate).toBe("2026-12-03");
    expect(mpMove?.appointmentTime).toBe("15:00");
    expect(mpMove?.collectedAmountArs).toBe(5000);
    expect(mpMove?.isDepositMovement).toBe(true);

    const pwMove = movements.find((m) => m.appointmentId === "apt-pw-dec");
    expect(pwMove?.paymentMethod).toBe("Tarjeta — Payway");
    expect(pwMove?.paymentDate).toBe("2026-11-26");
    expect(pwMove?.appointmentDate).toBe("2026-12-05");
  });

  it("enforces role scoping: BARBER only sees own Mercado Pago deposits; MANAGER/ADMIN see all", async () => {
    const appointments = [
      {
        id: "apt-gonzalo",
        barber_id: "barber-gonzalo",
        service_id: "srv-corte",
        custom_service_name: null,
        status: "CONFIRMED",
        deposit_paid: true,
        deposit_amount_ars: 5000,
        booking_date: "2026-12-03",
        start_time: "15:00:00",
        created_at: "2026-11-26T17:00:00.000Z",
        client_id: "cli-1",
      },
      {
        id: "apt-lautaro",
        barber_id: "barber-lautaro",
        service_id: "srv-corte",
        custom_service_name: null,
        status: "CONFIRMED",
        deposit_paid: true,
        deposit_amount_ars: 5000,
        booking_date: "2026-12-04",
        start_time: "16:00:00",
        created_at: "2026-11-26T17:10:00.000Z",
        client_id: "cli-2",
      },
    ];

    const userClient = {
      from: (table: string) => {
        if (table === "payment_attempts") return makeQueryMock([]);
        if (table === "appointments") return makeQueryMock(appointments);
        if (table === "clients") return makeQueryMock([]);
        if (table === "services") return makeQueryMock([{ id: "srv-corte", name: "Corte" }]);
        if (table === "barbers") {
          return makeQueryMock([
            { id: "barber-gonzalo", name: "Gonzalo" },
            { id: "barber-lautaro", name: "Lautaro" },
          ]);
        }
        return makeQueryMock([]);
      },
    };

    const serviceClient = {
      from: (table: string) => {
        if (table === "appointment_payment_orders") {
          return makeQueryMock([
            {
              appointment_id: "apt-gonzalo",
              expected_amount_ars: 5000,
              paid_amount_ars: 5000,
              reconciliation_status: "CONFIRMED",
              created_at: "2026-11-26T17:00:00.000Z",
              updated_at: "2026-11-26T17:05:00.000Z",
            },
            {
              appointment_id: "apt-lautaro",
              expected_amount_ars: 5000,
              paid_amount_ars: 5000,
              reconciliation_status: "CONFIRMED",
              created_at: "2026-11-26T17:10:00.000Z",
              updated_at: "2026-11-26T17:15:00.000Z",
            },
          ]);
        }
        return makeQueryMock([]);
      },
    };

    serverMocks.createRequestSupabaseClient.mockResolvedValue(userClient);
    serverMocks.createPaymentSupabaseClient.mockResolvedValue(serviceClient);

    // BARBER trying to request another barber's id must still only see own deposits
    const barberMovements = await readOnlineDepositMovementsServer(
      { barberId: "barber-lautaro" },
      { profile: { role: "BARBER", barber_id: "barber-gonzalo" }, token: "barber-jwt" },
    );
    expect(barberMovements.map((m) => m.barberId)).toEqual(["barber-gonzalo"]);

    // MANAGER sees all barbers
    const managerMovements = await readOnlineDepositMovementsServer(
      {},
      { profile: { role: "MANAGER", barber_id: null }, token: "manager-jwt" },
    );
    expect(managerMovements).toHaveLength(2);
  });

  it("prevents double counting when Mercado Pago deposit is paid today and salon balance is paid on the future appointment date", () => {
    const mpDepositToday: ServicePayment = {
      id: "deposit-apt-mp-dec",
      barberId: "barber-gonzalo",
      barberName: "Gonzalo",
      serviceId: "srv-corte",
      serviceName: "Seña — Corte" as any,
      serviceOtherDetail: null,
      servicePriceArs: 5000,
      discountArs: 0,
      finalAmountArs: 5000,
      paymentDate: "2026-11-26",
      paymentTime: "14:30",
      paymentMethod: "Mercado Pago",
      onlineDepositPaid: true,
      onlineDepositAmountArs: 5000,
      collectedAmountArs: 5000,
      clientName: "Juan Pérez",
      clientContact: "1155550001",
      appointmentId: "apt-mp-dec",
      appointmentDate: "2026-12-03",
      appointmentTime: "15:00",
      serviceOrigin: "online_deposit",
      createdByUserId: null,
      createdByDisplayName: "Mercado Pago",
      createdAt: "2026-11-26T17:30:00.000Z",
      isDepositMovement: true,
    };

    const salonBalanceDec: ServicePayment = {
      id: "pay-salon-dec",
      barberId: "barber-gonzalo",
      barberName: "Gonzalo",
      serviceId: "srv-corte",
      serviceName: "Corte",
      serviceOtherDetail: null,
      servicePriceArs: 25000,
      discountArs: 0,
      finalAmountArs: 25000,
      paymentDate: "2026-12-03",
      paymentTime: "15:45",
      paymentMethod: "Efectivo",
      onlineDepositPaid: true,
      onlineDepositAmountArs: 5000,
      collectedAmountArs: 20000,
      clientName: "Juan Pérez",
      clientContact: "1155550001",
      appointmentId: "apt-mp-dec",
      serviceOrigin: "appointment",
      createdByUserId: "u-1",
      createdByDisplayName: "Gonzalo",
      createdAt: "2026-12-03T18:45:00.000Z",
      isDepositMovement: false,
    };

    // Today's cash summary includes the $5.000 Mercado Pago deposit
    const todaySummary = paymentSummary([mpDepositToday]);
    expect(todaySummary.collected).toBe(5000);
    expect(todaySummary.deposits).toBe(5000);

    // Future appointment date summary includes only the $20.000 balance collected that day
    const futureDaySummary = paymentSummary([salonBalanceDec]);
    expect(futureDaySummary.collected).toBe(20000);
    expect(futureDaySummary.value).toBe(25000);

    // Combined period never double-counts collected, value, or deposits
    const combinedSummary = paymentSummary(
      deduplicatePaymentMovements([mpDepositToday, mpDepositToday, salonBalanceDec]),
    );
    expect(combinedSummary.collected).toBe(25000);
    expect(combinedSummary.value).toBe(25000);
    expect(combinedSummary.deposits).toBe(5000);
  });

  it("renders Mercado Pago deposit paid today for a future appointment in V2Payments Caja del día, breakdown, and method filter", () => {
    const today = businessDateToday();
    serverMocks.v2Data.payments = [
      {
        id: "deposit-apt-mp-dec",
        barberId: "barber-gonzalo",
        barberName: "Gonzalo",
        serviceId: "srv-corte",
        serviceName: "Seña — Corte" as any,
        serviceOtherDetail: null,
        servicePriceArs: 5000,
        discountArs: 0,
        finalAmountArs: 5000,
        paymentDate: today,
        paymentTime: "14:30",
        paymentMethod: "Mercado Pago",
        onlineDepositPaid: true,
        onlineDepositAmountArs: 5000,
        collectedAmountArs: 5000,
        clientName: "Juan Pérez",
        clientContact: "1155550001",
        appointmentId: "apt-mp-dec",
        appointmentDate: "2026-12-03",
        appointmentTime: "15:00",
        serviceOrigin: "online_deposit",
        createdByUserId: null,
        createdByDisplayName: "Mercado Pago",
        createdAt: `${today}T17:30:00.000Z`,
        isDepositMovement: true,
      },
      {
        id: "pay-cash-today",
        barberId: "barber-lautaro",
        barberName: "Lautaro",
        serviceId: "srv-corte",
        serviceName: "Corte",
        serviceOtherDetail: null,
        servicePriceArs: 25000,
        discountArs: 0,
        finalAmountArs: 25000,
        paymentDate: today,
        paymentTime: "11:00",
        paymentMethod: "Efectivo",
        onlineDepositPaid: false,
        onlineDepositAmountArs: 0,
        collectedAmountArs: 25000,
        clientName: "Carlos Ruiz",
        clientContact: null,
        appointmentId: null,
        serviceOrigin: "walk_in",
        createdByUserId: "u-1",
        createdByDisplayName: "Admin",
        createdAt: `${today}T14:00:00.000Z`,
        isDepositMovement: false,
      },
    ];

    render(<V2Payments />);

    const cashSummary = screen.getByRole("region", { name: "Resumen de caja" });
    expect(within(cashSummary).getByText("$30.000")).toBeInTheDocument();
    expect(within(cashSummary).getByText("Mercado Pago")).toBeInTheDocument();
    expect(within(cashSummary).getByText("$5.000")).toBeInTheDocument();
    expect(within(cashSummary).getByText("$25.000")).toBeInTheDocument();

    // Filter by Mercado Pago shows only the deposit movement and displays future Turno metadata
    const filterGroup = screen.getByRole("group", { name: "Filtrar por método" });
    fireEvent.click(within(filterGroup).getByRole("button", { name: "Mercado Pago" }));

    const historyPanel = screen.getByRole("region", { name: "Cobros registrados" });
    expect(within(historyPanel).getByText("1 servicios")).toBeInTheDocument();
    expect(within(historyPanel).getByText("Turno 03/12 15:00 hs")).toBeInTheDocument();
  });

  it("SQL migration updates get_online_deposit_movements to union payment_attempts and appointment_payment_orders by real payment timestamp", () => {
    const sqlPath = path.resolve(
      process.cwd(),
      "supabase/migrations/20261127000200_kani_online_deposits_mercadopago_ledger.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");

    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.get_online_deposit_movements");
    expect(sql).toContain("FROM public.payment_attempts p");
    expect(sql).toContain("AND p.state = 'APPROVED'");
    expect(sql).toContain("FROM public.appointment_payment_orders o");
    expect(sql).toContain("AND o.reconciliation_status = 'CONFIRMED'");
    expect(sql).toContain("coalesce(o.updated_at, o.created_at) AS paid_at");
    expect(sql).toContain("timezone('America/Argentina/Buenos_Aires', coalesce(dep.paid_at, a.created_at))");
    expect(sql).toContain("public.is_operator()");
    expect(sql).toContain("a.booking_date AS appointment_date");
  });
});
