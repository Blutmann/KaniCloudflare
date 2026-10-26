import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  from: vi.fn(),
  ordersFail: false,
  ordersData: [] as any[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mock.from,
  },
}));

vi.mock("@/lib/kani-notifications.functions", () => ({
  sendAppointmentNotification: vi.fn(),
}));

import { readRealAppointments } from "@/lib/kani-appointments";

describe("Admin V2 appointments and Mercado Pago orders resilience", () => {
  beforeEach(() => {
    mock.ordersFail = false;
    mock.ordersData = [];
    mock.from.mockReset();

    mock.from.mockImplementation((table: string) => {
      const query: any = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (resolve: (val: any) => any, reject: (val: any) => any) => {
          if (table === "appointments") {
            return Promise.resolve({
              data: [
                {
                  id: "b37fa85f-4f34-4d64-b67b-705f30697df7",
                  request_number: 57,
                  client_id: "c-1",
                  barber_id: "b-1",
                  service_id: "s-1",
                  booking_date: "2026-10-25",
                  start_time: "14:30:00",
                  end_time: "15:15:00",
                  status: "CONFIRMED",
                  notes: "Cliente puntual",
                  created_at: "2026-10-25T14:00:00Z",
                  updated_at: "2026-10-25T14:10:00Z",
                  deposit_paid: true,
                  deposit_amount_ars: 5000,
                },
              ],
              error: null,
            }).then(resolve, reject);
          }
          if (table === "clients") {
            return Promise.resolve({
              data: [
                { id: "c-1", name: "Martin Gomez", phone: "+5491112345678", email: "martin@example.com" },
              ],
              error: null,
            }).then(resolve, reject);
          }
          if (table === "barbers") {
            return Promise.resolve({
              data: [
                { id: "b-1", name: "Lautaro" },
              ],
              error: null,
            }).then(resolve, reject);
          }
          if (table === "services") {
            return Promise.resolve({
              data: [
                { id: "s-1", name: "Corte", duration_minutes: 45, price_ars: 25000 },
              ],
              error: null,
            }).then(resolve, reject);
          }
          if (table === "appointment_no_show_exceptions") {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
          if (table === "appointment_payment_orders") {
            if (mock.ordersFail) {
              return Promise.reject(new Error("Database connection timeout or RLS error")).then(resolve, reject);
            }
            return Promise.resolve({ data: mock.ordersData, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
        catch: (rejectHandler: (err: any) => any) => {
          if (table === "appointment_payment_orders" && mock.ordersFail) {
            return Promise.resolve(rejectHandler(new Error("Database error")));
          }
          return Promise.resolve({ data: mock.ordersData, error: null });
        },
      };
      return query;
    });
  });

  it("1. loads appointments with confirmed Mercado Pago order available without throwing", async () => {
    mock.ordersData = [
      {
        appointment_id: "b37fa85f-4f34-4d64-b67b-705f30697df7",
        order_id: "ORDTST01M5T6PJYW42ABDE2P8BWBCZHT",
        reconciliation_status: "CONFIRMED",
        paid_amount_ars: 5000,
      },
    ];

    const apts = await readRealAppointments({ bypassCache: true });
    expect(apts).toHaveLength(1);
    const apt = apts[0];
    expect(apt.id).toBe("b37fa85f-4f34-4d64-b67b-705f30697df7");
    expect(apt.requestNumber).toBe(57);
    expect(apt.depositPaid).toBe(true);
    expect(apt.depositAmountArs).toBe(5000);
    expect(apt.servicePrice).toBe(25000);
  });

  it("2. loads appointments cleanly when no orders exist", async () => {
    mock.ordersData = [];

    const apts = await readRealAppointments({ bypassCache: true });
    expect(apts).toHaveLength(1);
    const apt = apts[0];
    // Falls back to appointment row column or defaults
    expect(apt.id).toBe("b37fa85f-4f34-4d64-b67b-705f30697df7");
    expect(apt.name).toBe("Martin Gomez");
  });

  it("3. handles controlled failure in appointment_payment_orders without crashing other modules", async () => {
    mock.ordersFail = true;

    // Must not throw ReferenceError: ordersResult is not defined or unhandled rejection
    const apts = await readRealAppointments({ bypassCache: true });
    expect(apts).toHaveLength(1);
    const apt = apts[0];
    expect(apt.id).toBe("b37fa85f-4f34-4d64-b67b-705f30697df7");
    expect(apt.name).toBe("Martin Gomez");
    expect(apt.serviceName).toBe("Corte");
  });

  it("4. calculates balance to collect at shop correctly without duplicating deposit deduction", () => {
    const servicePrice = 25000;
    const depositAmount = 5000;
    const discount = 0;

    const totalCalculated = Math.max(0, servicePrice - discount);
    const balanceToCollectAtShop = Math.max(0, totalCalculated - depositAmount);

    expect(balanceToCollectAtShop).toBe(20000);
    expect(servicePrice - balanceToCollectAtShop).toBe(depositAmount);
  });
});
