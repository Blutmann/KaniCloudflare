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
      let full = false;
      const query = {
        select: (columns: string) => {
          full = columns.includes("deposit_required");
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
              table === "appointments" && full && mock.fallback
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
});
