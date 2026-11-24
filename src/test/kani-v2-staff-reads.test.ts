import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedStaff } from "@/lib/kani-auth";

const mock = vi.hoisted(() => ({
  from: vi.fn(),
  queries: [] as Array<{ table: string; filters: unknown[][] }>,
  fallback: false,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));
vi.mock("@/lib/kani-notifications.functions", () => ({ sendAppointmentNotification: vi.fn() }));
import { readStaffAppointments, readRealAppointments } from "@/lib/kani-appointments";

function staff(role: string, barber_id: string | null = null) {
  return { profile: { role, barber_id } } as AuthenticatedStaff;
}

describe("V2 appointments are scoped at query origin", () => {
  beforeEach(() => {
    mock.queries = [];
    mock.fallback = false;
    mock.from.mockReset();
    mock.from.mockImplementation((table: string) => {
      const filters: unknown[][] = [];
      mock.queries.push({ table, filters });
      let isFirstAppointmentQuery = false;
      const query = {
        select: () => {
          if (table === "appointments") {
            isFirstAppointmentQuery =
              mock.queries.filter((q) => q.table === "appointments").length === 1;
          }
          return query;
        },
        order: () => query,
        eq: (...args: unknown[]) => {
          filters.push(args);
          return query;
        },
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: [],
            error:
              table === "appointments" && isFirstAppointmentQuery && mock.fallback
                ? { code: "42703", message: "is_manual missing" }
                : null,
          }).then(resolve),
      };
      return query;
    });
  });

  it("retains global ADMIN reads", async () => {
    await readStaffAppointments(staff("ADMIN"));
    expect(mock.queries[0]).toEqual({ table: "appointments", filters: [] });
  });

  it("restricts both full and fallback reads to the verified barber ID", async () => {
    mock.fallback = true;
    await readStaffAppointments(staff("BARBER", "barber-a"));
    const queries = mock.queries.filter((q) => q.table === "appointments");
    expect(queries).toHaveLength(2);
    queries.forEach((q) => expect(q.filters).toEqual([["barber_id", "barber-a"]]));
  });

  it("does not reuse an earlier identity's in-flight read", async () => {
    await Promise.all([
      readStaffAppointments(staff("BARBER", "barber-a")),
      readStaffAppointments(staff("BARBER", "barber-b")),
    ]);
    expect(mock.queries.filter((q) => q.table === "appointments").map((q) => q.filters)).toEqual([
      [["barber_id", "barber-a"]],
      [["barber_id", "barber-b"]],
    ]);
  });

  it("fails closed for missing or unsupported identity before querying", async () => {
    await expect(readStaffAppointments(staff("BARBER"))).rejects.toThrow("barbero asociado");
    await expect(readStaffAppointments(staff("UNKNOWN", "barber-a"))).rejects.toThrow(
      "barbero asociado",
    );
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("leaves existing V1 reads unchanged", async () => {
    await readRealAppointments({ bypassCache: true });
    expect(mock.queries[0]).toEqual({ table: "appointments", filters: [] });
  });

  it("preserves depositPaid and depositAmountArs via select('*') and approved payment_attempts backup", async () => {
    const selectedCols: Record<string, string> = {};
    mock.from.mockImplementation((table: string) => {
      const chain: any = {
        select: (cols: string) => {
          selectedCols[table] = cols;
          return chain;
        },
        order: () => chain,
        eq: () => chain,
        in: () => chain,
        then: (resolve: (val: unknown) => unknown) => {
          if (table === "appointments") {
            return Promise.resolve({
              data: [
                {
                  id: "apt-row-deposit",
                  request_number: 501,
                  client_id: "c1",
                  barber_id: "b1",
                  service_id: "s1",
                  booking_date: "2026-11-23",
                  start_time: "10:00:00",
                  end_time: "10:45:00",
                  status: "CONFIRMED",
                  notes: "",
                  created_at: "2026-11-23T12:00:00Z",
                  deposit_paid: true,
                  deposit_amount_ars: 5000,
                },
                {
                  id: "apt-attempt-deposit",
                  request_number: 502,
                  client_id: "c1",
                  barber_id: "b1",
                  service_id: "s1",
                  booking_date: "2026-11-23",
                  start_time: "11:00:00",
                  end_time: "11:45:00",
                  status: "CONFIRMED",
                  notes: "",
                  created_at: "2026-11-23T12:00:00Z",
                  deposit_paid: false,
                  deposit_amount_ars: null,
                },
              ],
              error: null,
            }).then(resolve);
          }
          if (table === "payment_attempts") {
            return Promise.resolve({
              data: [{ appointment_id: "apt-attempt-deposit", amount_ars: 5000, state: "APPROVED" }],
              error: null,
            }).then(resolve);
          }
          if (table === "clients") {
            return Promise.resolve({ data: [{ id: "c1", name: "Salvador Kawakami", email: "", phone: "" }], error: null }).then(resolve);
          }
          if (table === "barbers") {
            return Promise.resolve({ data: [{ id: "b1", name: "Lautaro" }], error: null }).then(resolve);
          }
          if (table === "services") {
            return Promise.resolve({ data: [{ id: "s1", name: "Corte", duration_minutes: 45, price_ars: 25000 }], error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return chain;
    });

    const list = await readRealAppointments({ bypassCache: true });
    expect(selectedCols.appointments).toBe("*");
    expect(list.find((a) => a.id === "apt-row-deposit")).toMatchObject({
      depositPaid: true,
      depositAmountArs: 5000,
    });
    expect(list.find((a) => a.id === "apt-attempt-deposit")).toMatchObject({
      depositPaid: true,
      depositAmountArs: 5000,
    });
  });
});
