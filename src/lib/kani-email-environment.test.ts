import { describe, expect, it } from "vitest";
import { notificationSubject } from "./kani-email-environment";
describe("Test notification subject", () => {
  it("labels the test project even when KANI_ENVIRONMENT is missing", () => {
    expect(
      notificationSubject("Confirmación", undefined, "https://iockpxtkflyjfagkvgnr.supabase.co"),
    ).toBe("[PRUEBA] Confirmación");
  });
  it("uses the requested label for configured test environments", () => {
    for (const env of ["DEV/PREVIEW", "PREVIEW", "PRUEBA", "TEST", " dev "])
      expect(notificationSubject("Turno", env)).toBe("[PRUEBA] Turno");
  });
  it("preserves production subjects", () => {
    expect(notificationSubject("Turno", "PRODUCTION", "https://production.supabase.co")).toBe(
      "Turno",
    );
  });
  it("keeps unknown deployments distinguishable without guessing", () => {
    expect(notificationSubject("Turno")).toBe("[UNCONFIGURED] Turno");
    expect(
      notificationSubject(
        "Turno",
        undefined,
        "https://iockpxtkflyjfagkvgnr.supabase.co.example.com",
      ),
    ).toBe("[UNCONFIGURED] Turno");
  });
});
