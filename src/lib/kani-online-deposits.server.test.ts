import { describe, expect, it, vi } from "vitest";
import { readOnlineDepositMovementsServer } from "./kani-online-deposits.server";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("./kani-notifications.server", () => ({
  createRequestSupabaseClient: async () => ({
    from: mocks.from,
  }),
}));

describe("readOnlineDepositMovementsServer (Payway + Mercado Pago)", () => {
  it("merges confirmed Mercado Pago orders alongside approved Payway attempts with dynamic amounts", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "payment_attempts") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: [
                  {
                    id: "att-pw-1",
                    appointment_id: "apt-valentin",
                    provider: "PAYWAY",
                    amount_ars: 5000,
                    state: "APPROVED",
                    created_at: "2026-12-01T13:00:00.000Z",
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "appointment_payment_orders") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: [
                  {
                    appointment_id: "apt-gonzalo",
                    order_id: "ORD-MP-1",
                    expected_amount_ars: 3500,
                    paid_amount_ars: 3500,
                    reconciliation_status: "CONFIRMED",
                    created_at: "2026-12-01T14:00:00.000Z",
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "appointments") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                {
                  id: "apt-valentin",
                  barber_id: "b-val",
                  service_id: "s-corte",
                  custom_service_name: null,
                  status: "CONFIRMED",
                  deposit_paid: true,
                  deposit_amount_ars: 5000,
                  booking_date: "2026-12-02",
                  start_time: "11:00:00",
                  created_at: "2026-12-01T13:00:00.000Z",
                  client_id: "c-1",
                },
                {
                  id: "apt-gonzalo",
                  barber_id: "b-gon",
                  service_id: "s-corte",
                  custom_service_name: null,
                  status: "CONFIRMED",
                  deposit_paid: true,
                  deposit_amount_ars: 3500,
                  booking_date: "2026-12-02",
                  start_time: "12:00:00",
                  created_at: "2026-12-01T14:00:00.000Z",
                  client_id: "c-2",
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "clients") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                { id: "c-1", name: "Cliente Payway", phone: "+5491111111111" },
                { id: "c-2", name: "Cliente MP", phone: "+5491122222222" },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "services") {
        return {
          select: () => ({
            in: async () => ({
              data: [{ id: "s-corte", name: "Corte" }],
              error: null,
            }),
          }),
        };
      }
      if (table === "barbers") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                { id: "b-val", name: "Valentín" },
                { id: "b-gon", name: "Gonzalo" },
              ],
              error: null,
            }),
          }),
        };
      }
      return {};
    });

    const movements = await readOnlineDepositMovementsServer(
      {},
      {
        profile: { role: "ADMIN", barber_id: null },
        token: "staff-jwt-token",
      },
    );

    expect(movements).toHaveLength(2);
    const mpMove = movements.find((m) => m.appointmentId === "apt-gonzalo");
    const pwMove = movements.find((m) => m.appointmentId === "apt-valentin");

    expect(mpMove).toMatchObject({
      barberName: "Gonzalo",
      paymentMethod: "Mercado Pago",
      onlineDepositPaid: true,
      onlineDepositAmountArs: 3500,
      collectedAmountArs: 3500,
    });
    expect(pwMove).toMatchObject({
      barberName: "Valentín",
      paymentMethod: "Tarjeta — Payway",
      onlineDepositPaid: true,
      onlineDepositAmountArs: 5000,
      collectedAmountArs: 5000,
    });
  });
});
