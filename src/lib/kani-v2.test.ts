import { describe, expect, it } from "vitest";
import {
  isV2Preview,
  isV2PreviewHost,
  scopeV2,
  paymentSummary,
  clientHistory,
  changePercent,
  slotReserved,
  PREVIEW_PROJECT,
} from "./kani-v2";
import type { RealAppointment } from "./kani-appointments";
import type { ServicePayment } from "./kani-payments";
import type { AvailabilitySlot } from "./kani-availability";

const appointment = {
  id: "a1",
  clientId: "c1",
  barberId: "b1",
  date: "2026-10-22",
  time: "10:00",
  endTime: "10:45",
  statusCode: "COMPLETED",
} as RealAppointment;
const payment = {
  appointmentId: "a1",
  barberId: "b1",
  collectedAmountArs: 20000,
  finalAmountArs: 25000,
  onlineDepositAmountArs: 5000,
} as ServicePayment;

describe("V2 preview isolation and role scope", () => {
  it("permits only the test project on approved hosts (main preview and versioned deployments)", () => {
    // 1. Preview/Test principal
    expect(
      isV2Preview(
        "https://iockpxtkflyjfagkvgnr.supabase.co",
        "kanibarberstudio-cloudflare.kanibarber.workers.dev",
      ),
    ).toBe(true);

    // 2. Deployment/versionado Preview/Test autorizado (e.g. 311e359c)
    expect(
      isV2Preview(
        "https://iockpxtkflyjfagkvgnr.supabase.co",
        "311e359c-kanibarberstudio-cloudflare.kanibarber.workers.dev",
      ),
    ).toBe(true);

    // 3. Otro hash o branch deployment legítimo del worker
    expect(
      isV2Preview(
        "https://iockpxtkflyjfagkvgnr.supabase.co",
        "feat-preview-123-kanibarberstudio-cloudflare.kanibarber.workers.dev",
      ),
    ).toBe(true);
    expect(
      isV2Preview(
        "https://iockpxtkflyjfagkvgnr.supabase.co",
        "311e359c-kanibarberstudio-cloudflare.tomasblutmannliriumprive.workers.dev",
      ),
    ).toBe(true);

    // 4. Localhost
    expect(isV2Preview("https://iockpxtkflyjfagkvgnr.supabase.co", "localhost")).toBe(true);
    expect(isV2Preview("https://iockpxtkflyjfagkvgnr.supabase.co", "127.0.0.1")).toBe(true);

    // 5. Producción bloqueada estrictamente
    expect(isV2Preview("https://iockpxtkflyjfagkvgnr.supabase.co", "kanibarber.com")).toBe(false);
    expect(isV2Preview("https://iockpxtkflyjfagkvgnr.supabase.co", "www.kanibarber.com")).toBe(false);

    // 6. Proyectos Supabase no autorizados bloqueados
    expect(
      isV2Preview(
        "https://vmhxwxxidgfbczxtkqge.supabase.co",
        "kanibarberstudio-cloudflare.kanibarber.workers.dev",
      ),
    ).toBe(false); // producción
    expect(
      isV2Preview(
        "https://vnwchtryclueemftkoun.supabase.co",
        "kanibarberstudio-cloudflare.kanibarber.workers.dev",
      ),
    ).toBe(false); // legacy
    expect(isV2Preview("https://production.supabase.co", "localhost")).toBe(false);

    // 7. Hosts maliciosos o no autorizados bloqueados
    expect(
      isV2Preview(
        "https://iockpxtkflyjfagkvgnr.supabase.co",
        "attacker-worker.workers.dev",
      ),
    ).toBe(false);
    expect(
      isV2Preview(
        "https://iockpxtkflyjfagkvgnr.supabase.co",
        "malicious-kanibarberstudio-cloudflare.otheraccount.workers.dev",
      ),
    ).toBe(false);
    expect(isV2Preview("https://iockpxtkflyjfagkvgnr.supabase.co.attacker.test", "localhost")).toBe(
      false,
    );
    expect(isV2Preview("", "localhost")).toBe(false);
    expect(isV2Preview("https://iockpxtkflyjfagkvgnr.supabase.co", "")).toBe(false);
  });

  it("fails closed for a barber without ownership or a manipulated filter", () => {
    const rows = [{ barberId: "b1" }, { barberId: "b2" }];
    expect(scopeV2(rows, "BARBER", "b1")).toEqual([rows[0]]);
    expect(scopeV2(rows, "BARBER", "b1", "b2")).toEqual([]);
    expect(scopeV2(rows, "BARBER", null)).toEqual([]);
    expect(scopeV2(rows, "UNKNOWN", null)).toEqual([]);
    expect(scopeV2(rows, "ADMIN", null)).toHaveLength(2);
  });
});

describe("V2 verified financial and client history", () => {
  it("distinguishes money collected now from full service value and deposit", () => {
    expect(paymentSummary([payment])).toEqual({
      count: 1,
      collected: 20000,
      value: 25000,
      deposits: 5000,
    });
  });
  it("counts one visit when completion and payment refer to the same appointment", () => {
    const result = clientHistory("c1", [appointment], [payment]);
    expect(result.visits).toBe(1);
    expect(result.recordedSpend).toBe(25000);
    expect(result.frequency).toBe(null);
  });
  it("never joins anonymous payments or clients by matching names", () => {
    const result = clientHistory(
      "c1",
      [appointment, { ...appointment, id: "a2", clientId: "c2" }],
      [
        { ...payment, appointmentId: null },
        { ...payment, appointmentId: "a2" },
      ],
    );
    expect(result.payments).toHaveLength(0);
    expect(result.recordedSpend).toBe(0);
  });
  it("does not count cancelled appointments as visits and derives frequency from visit dates", () => {
    const result = clientHistory(
      "c1",
      [
        appointment,
        { ...appointment, id: "a2", date: "2026-09-22" },
        { ...appointment, id: "a3", statusCode: "CANCELLED" },
      ],
      [],
    );
    expect(result.visits).toBe(2);
    expect(result.cancellations).toBe(1);
    expect(result.frequency).toBe(30);
  });
  it("does not fabricate a comparison from a zero baseline", () => {
    expect(changePercent(5, 0)).toBeNull();
    expect(changePercent(12, 10)).toBe(20);
  });
  it("blocks the complete appointment interval but excludes cancellations", () => {
    const slot = {
      barber_id: "b1",
      slot_date: "2026-10-22",
      start_time: "10:30",
      end_time: "11:00",
    } as AvailabilitySlot;
    expect(slotReserved(slot, [{ ...appointment, statusCode: "PENDING" }])).toBe(true);
    expect(slotReserved(slot, [{ ...appointment, statusCode: "CANCELLED" }])).toBe(false);
    expect(
      slotReserved({ ...slot, start_time: "10:45" }, [{ ...appointment, statusCode: "CONFIRMED" }]),
    ).toBe(false);
  });
});
