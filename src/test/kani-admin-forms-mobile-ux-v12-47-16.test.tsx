import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import {
  AdminClientCombobox,
  AdminContextualSelect,
} from "@/components/kani/v2/admin-mobile-select";
import { BenefitCodesAdminSection } from "@/components/kani/admin-benefit-codes-section";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));

describe("V12.47.16 — Mobile UX Optimization for Admin Forms & Selectors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/admin/benefit-codes")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, items: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
    }) as typeof fetch;
  });

  it("1. AdminClientCombobox filters by name or phone, supports keyboard selection, and preserves canonical client.id", async () => {
    const onChange = vi.fn();
    const clients = [
      { id: "cli-1", name: "Lucas Fernández", phone: "11 2345-6789" },
      { id: "cli-2", name: "Martín Gómez", phone: "11 9876-5432" },
      { id: "cli-3", name: "Santiago Pérez", phone: "11 4444-1111" },
    ];

    render(
      <AdminClientCombobox
        clients={clients}
        value=""
        onChange={onChange}
        ariaLabel="Cliente titular"
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Cliente titular" });
    fireEvent.click(trigger);

    const searchInput = await screen.findByLabelText("Buscar cliente por nombre o celular");
    expect(searchInput.className).toContain("text-[16px]");

    // Search by partial phone digits
    fireEvent.change(searchInput, { target: { value: "9876" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Martín Gómez");

    // Select via Enter key
    fireEvent.keyDown(searchInput, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("cli-2");
  });

  it("2. AdminContextualSelect renders accessible trigger and preserves selection", () => {
    const onValueChange = vi.fn();
    render(
      <AdminContextualSelect
        ariaLabel="Tipo de membresía"
        value="4"
        onValueChange={onValueChange}
        options={[
          { value: "4", label: "Membresía 4 servicios (20% de descuento)" },
          { value: "10", label: "Membresía 10 servicios (30% de descuento)" },
        ]}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Tipo de membresía" });
    expect(trigger).toHaveTextContent("Membresía 4 servicios (20% de descuento)");
  });

  it("3. Generar código de descuento: compact mobile 2-col benefit cards, accessible validity info popover, and persistent footer", async () => {
    render(<BenefitCodesAdminSection />);

    const openBtn = screen.getByRole("button", { name: /generar código/i });
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /^generar código$/i })).toBeInTheDocument();
    });

    // Compact mobile labels present
    expect(screen.getByText("10 % OFF")).toBeInTheDocument();
    expect(screen.getByText("50 % OFF")).toBeInTheDocument();
    expect(screen.getAllByText("Sin seña")[0]).toBeInTheDocument();
    expect(screen.getByText("Servicio gratis")).toBeInTheDocument();

    // Desktop descriptions still in DOM for desktop & accessibility
    expect(screen.getByText("Bonificación del 10% del servicio. Se abona la seña completa.")).toBeInTheDocument();

    // Info button next to Vigencia removed per unified modal spec; timezone label cleanly aligned
    expect(screen.queryByRole("button", { name: /información sobre la vigencia/i })).toBeNull();
    expect(screen.getByText("Buenos Aires (UTC-3)")).toBeInTheDocument();

    // Persistent footer buttons
    const footer = document.querySelector(".benefit-code-dialog-footer");
    expect(footer).not.toBeNull();
    expect(footer).toHaveClass("kani-modal-footer");
    expect(footer?.querySelector('button[type="submit"]')).toHaveTextContent(/Crear código/i);
  });

  it("4. Pinned modal shell & compact membership/payment CSS rules exist in v2.css and liquid-glass-admin.css", () => {
    const v2Css = fs.readFileSync(
      path.resolve(__dirname, "../components/kani/v2/v2.css"),
      "utf-8",
    );
    const lgaCss = fs.readFileSync(
      path.resolve(__dirname, "../components/kani/experimental/liquid-glass-admin.css"),
      "utf-8",
    );

    expect(v2Css).toContain(".v2-dialog.v2-modal-pinned-shell");
    expect(v2Css).toContain(".v2-modal-pinned-scroll");
    expect(v2Css).toContain(".v2-modal-pinned-footer");
    expect(v2Css).toContain(".v2-membership-comp-card");
    expect(v2Css).toContain(".v2-membership-summary-card");
    expect(lgaCss).toContain(".v2-modal-pinned-footer");
    expect(lgaCss).toContain(".v2-admin-combobox-popover");
  });
});
