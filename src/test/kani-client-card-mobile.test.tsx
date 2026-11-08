import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClientCardMobile } from "@/components/kani/v2/client-card-mobile";
import type { V2Client } from "@/components/kani/v2/data";

const client = { id: "synthetic-client", name: "Cliente controlado", phone: "+5491128436014", email: "controlled@example.invalid" } as V2Client;
const callbacks = () => ({ onDetails: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() });

describe("Mobile client contact links and existing actions", () => {
  it("uses complete email and normalized WhatsApp targets without changing the stored phone", () => {
    render(<ClientCardMobile client={client} canEdit canDelete {...callbacks()} />);
    expect(screen.getByRole("link", { name: `Enviar correo a ${client.email}` })).toHaveAttribute("href", "mailto:controlled%40example.invalid");
    const whatsapp = screen.getByRole("link", { name: `Abrir WhatsApp de ${client.name}` });
    expect(whatsapp).toHaveAttribute("href", "https://wa.me/5491128436014");
    expect(whatsapp).toHaveTextContent("+54 9 11 2843-6014");
    expect(whatsapp).toHaveAttribute("rel", "noopener noreferrer");
    expect(client.phone).toBe("+5491128436014");
  });
  it("removes informational icons and places Edit and Delete side-by-side in Row 1 in mandatory order [Editar, Eliminar]", () => {
    const { container } = render(<ClientCardMobile client={client} canEdit canDelete {...callbacks()} />);
    expect(container.querySelector(".v2-client-mobile-name svg")).toBeNull();
    expect(container.querySelector(".v2-client-mobile-email svg")).toBeNull();
    expect(container.querySelector(".v2-client-mobile-phone svg")).toBeNull();

    const actionsContainer = container.querySelector(".v2-client-mobile-actions");
    expect(actionsContainer).not.toBeNull();
    const actionButtons = Array.from(actionsContainer!.querySelectorAll("button"));
    expect(actionButtons.map((btn) => btn.getAttribute("aria-label"))).toEqual([
      "Editar cliente",
      "Eliminar cliente",
    ]);
  });
  it("keeps the original callbacks separate and stops card clicks from propagating", () => {
    const actions = callbacks(), parent = vi.fn();
    render(<div onClick={parent}><ClientCardMobile client={client} canEdit canDelete {...actions} /></div>);
    for (const link of screen.getAllByRole("link")) {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      event.preventDefault();
      fireEvent(link, event);
    }
    expect(actions.onDetails).not.toHaveBeenCalled();
    expect(actions.onEdit).not.toHaveBeenCalled();
    expect(parent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Editar cliente" }));
    expect(actions.onEdit).toHaveBeenCalledTimes(1);
    expect(actions.onDetails).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar cliente" }));
    expect(actions.onDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Detalles" }));
    expect(actions.onDetails).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
  });
  it("does not render unauthorized editing or deletion actions", () => {
    const { rerender } = render(<ClientCardMobile client={client} canEdit={false} canDelete={false} {...callbacks()} />);
    expect(screen.queryByRole("button", { name: "Editar cliente" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar cliente" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detalles" })).toBeInTheDocument();

    rerender(<ClientCardMobile client={client} canEdit canDelete={false} {...callbacks()} />);
    expect(screen.getByRole("button", { name: "Editar cliente" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar cliente" })).not.toBeInTheDocument();
  });
  it("keeps international numbers and does not create links for missing contacts", () => {
    const { rerender } = render(<ClientCardMobile client={{ ...client, phone: "+12025550147" }} canEdit canDelete {...callbacks()} />);
    expect(screen.getByRole("link", { name: `Abrir WhatsApp de ${client.name}` })).toHaveAttribute("href", "https://wa.me/12025550147");
    rerender(<ClientCardMobile client={{ ...client, phone: "", email: null }} canEdit canDelete {...callbacks()} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Sin email")).toBeInTheDocument();
    expect(screen.getByText("Sin celular")).toBeInTheDocument();
  });
});
