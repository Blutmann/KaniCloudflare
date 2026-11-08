import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "MANAGER", rpc: vi.fn() }));
vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({ profile: { role: state.role } }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc } }));
import { StaffCodeCard, V2Discounts, type StaffBenefitCode } from "@/components/kani/v2/discounts";
const code: StaffBenefitCode = {
  id: "synthetic",
  code: "KANI-PRUEBA",
  type: "PERCENT_10",
  status: "ACTIVE",
  created_at: "2026-11-03T14:00:00Z",
  usages: [],
};
afterEach(cleanup);
beforeEach(() => {
  state.role = "MANAGER";
  state.rpc.mockReset().mockResolvedValue({ data: [code], error: null });
});
describe("Manager codes read-only presentation", () => {
  it("loads through the protected read-only RPC without mutation controls", async () => {
    render(<V2Discounts />);
    expect(await screen.findByRole("article", { name: "Código KANI-PRUEBA" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Códigos" })).toBeInTheDocument();
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("staff_list_benefit_codes");
    expect(screen.queryByRole("button", { name: /crear|editar|activar|eliminar/i })).toBeNull();
  });
  it("never queries codes for a barber visiting the URL directly", () => {
    state.role = "BARBER";
    render(<V2Discounts />);
    expect(screen.getByRole("alert")).toHaveTextContent("No tenés permisos");
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["ACTIVE", "Activo"],
    ["CONSUMED", "Utilizado"],
    ["EXPIRED", "Vencido"],
    ["INACTIVE", "Inactivo"],
    ["DISABLED", "Desactivado"],
    ["SCHEDULED", "Programado"],
    ["LOCKED", "En proceso"],
    ["DELETED", "Eliminado"],
  ])("translates %s", (status, label) => {
    render(<StaffCodeCard row={{ ...code, status }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
  it("formats calendar dates without UTC day shifts and preserves metadata and uses", () => {
    render(
      <StaffCodeCard
        row={{
          ...code,
          internal_note:
            '[[KANI_META:{"usageMode":"REUSABLE","validFrom":"2026-11-03","validUntil":"2030-11-04","timesUsed":3}]]',
          usages: [
            {
              appointmentId: "apt",
              requestNumber: 42,
              clientName: "Cliente de prueba",
              bookingDate: "2026-11-03",
              appointmentStatus: "CONFIRMED",
            },
          ],
        }}
      />,
    );
    expect(screen.getAllByText("03/11/2026").length).toBeGreaterThan(0);
    expect(screen.getByText("04/11/2030")).toBeInTheDocument();
    expect(screen.getByText("Reutilizable")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Cliente de prueba")).toBeInTheDocument();
    expect(screen.getByText(/Turno #42 · 03\/11\/2026/)).toBeInTheDocument();
  });
  it("handles legacy consumed codes even when the usage array is empty", () => {
    render(<StaffCodeCard row={{ ...code, status: "CONSUMED" }} />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });
  it("keeps CONSUMED translated as Utilizado for reusable codes as well", () => {
    render(
      <StaffCodeCard
        row={{
          ...code,
          status: "CONSUMED",
          internal_note: '[[KANI_META:{"usageMode":"REUSABLE"}]]',
        }}
      />,
    );
    expect(screen.getByText("Utilizado")).toBeInTheDocument();
  });
  it.each([
    ["2026-11-05", "2030-11-04", "Programado"],
    ["2026-11-03", "2026-11-04", "Activo"],
  ])(
    "uses Buenos Aires boundaries for calendar validity: %s to %s",
    (valid_from, valid_until, label) => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-11-05T01:30:00Z"));
        render(<StaffCodeCard row={{ ...code, valid_from, valid_until }} />);
        expect(screen.getByText(label)).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("does not expose raw errors and handles malformed metadata", async () => {
    state.rpc.mockRejectedValue(new Error("private backend diagnostic"));
    render(<V2Discounts />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos consultar");
    expect(screen.queryByText(/private backend/)).toBeNull();
  });
});
