import { fireEvent, render, screen, waitFor, within, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  inbox: null as any,
  read: vi.fn(),
  set: vi.fn(),
  all: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/kani-admin-activity", () => ({
  readNotificationInbox: mock.read,
  setAdminActivityNotificationRead: mock.set,
  markAllAdminActivityNotificationsRead: mock.all,
  deleteAllAdminActivityNotificationsGlobal: mock.remove,
  extractErrorMessage: () => "No se pudo guardar en el servidor",
}));
vi.mock("@/components/kani/notification-appointment-detail", () => ({
  default: ({ onOpened }: any) => (
    <button onClick={onOpened}>Completar consulta actual del turno</button>
  ),
}));
import { AdminActivityPopover } from "@/components/kani/admin-activity-popover";
const staff = {
  user: { id: "controlled" },
  profile: { role: "MANAGER", active: true, barber_id: null },
  barbers: [],
} as any;
const event = (id: string, sequence: number, kind = "APPOINTMENT_CONFIRMED") => ({
  id,
  event_type: kind,
  appointment_id: "a-" + id,
  client_name: "Cliente " + id,
  barber_name: "Uno",
  event_date: "2026-11-06",
  event_time: "10:00",
  created_at: "2026-11-06T10:00:00Z",
  feed_sequence: sequence,
  read_at: null,
});
function recount() {
  mock.inbox.unread_count = mock.inbox.items.filter((e: any) => e.read_at === null).length;
}
async function bell() {
  const b = await screen.findByRole("button", { name: "2 notificaciones sin leer" });
  fireEvent.click(b);
  await screen.findByText("Cliente agendó turno.");
}
describe("Account inbox interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.inbox = {
      items: [event("uno", 16), event("dos", 17, "APPOINTMENT_CANCELLED")],
      unread_count: 2,
      through: 17,
      next_before: null,
    };
    mock.read.mockImplementation(async () => structuredClone(mock.inbox));
    mock.set.mockImplementation(async (id: string, readAt: string | null) => {
      mock.inbox.items.find((e: any) => e.id === id).read_at = readAt;
      recount();
    });
    mock.all.mockImplementation(async (through: number) => {
      for (const e of mock.inbox.items) if (e.feed_sequence <= through) e.read_at = "read";
      mock.inbox.items.unshift(event("nuevo", 18));
      mock.inbox.through = 18;
      recount();
    });
    mock.remove.mockImplementation(async (ids: string[]) => {
      mock.inbox.items = mock.inbox.items.filter((e: any) => !ids.includes(e.id));
      recount();
    });
  });
  afterEach(cleanup);
  it("opens the current detail before marking read and immediately updates the bell afterwards", async () => {
    render(<AdminActivityPopover role="MANAGER" staff={staff} />);
    await bell();
    fireEvent.click(screen.getByText("Cliente agendó turno.").closest("button")!);
    expect(await screen.findByRole("dialog", { name: "Detalle del turno" })).toBeInTheDocument();
    expect(mock.set).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", { name: "Completar consulta actual del turno" }),
    );
    await waitFor(() =>
      expect(document.querySelector(".notification-count")).toHaveTextContent("1"),
    );
    expect(mock.set).toHaveBeenCalledWith("uno", expect.any(String));
  });
  it("marks an individual unread/read without changing other items", async () => {
    render(<AdminActivityPopover role="MANAGER" staff={staff} />);
    await bell();
    fireEvent.click(screen.getAllByRole("button", { name: "Marcar como leída" })[0]);
    await screen.findByRole("button", { name: "1 notificaciones sin leer" });
    fireEvent.click(screen.getByRole("button", { name: "Marcar como no leída" }));
    await screen.findByRole("button", { name: "2 notificaciones sin leer" });
    expect(mock.inbox.items[1].read_at).toBeNull();
  });
  it("keeps a concurrent arrival unread when marking all older events", async () => {
    render(<AdminActivityPopover role="MANAGER" staff={staff} />);
    await bell();
    fireEvent.click(screen.getByRole("button", { name: "Marcar todas como leídas" }));
    await screen.findByRole("button", { name: "1 notificaciones sin leer" });
    expect(mock.all).toHaveBeenCalledWith(17);
    expect(mock.inbox.items[0].read_at).toBeNull();
  });
  it.each(["BARBER", "MANAGER"] as const)("does not offer deletion for %s", async (role) => {
    render(<AdminActivityPopover role={role} staff={staff} />);
    await bell();
    expect(screen.queryByRole("button", { name: /Eliminar/ })).toBeNull();
  });
  it("requires ADMIN confirmation before audited global deletion", async () => {
    render(<AdminActivityPopover role="ADMIN" staff={staff} />);
    await bell();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar notificación de Cliente uno" }));
    const confirmation = await screen.findByRole("dialog", { name: "Eliminar notificaciones" });
    expect(mock.remove).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Confirmar eliminación" }));
    await waitFor(() => expect(mock.remove).toHaveBeenCalledWith(["uno"]));
    await screen.findByRole("button", { name: "1 notificaciones sin leer" });
  });
  it("keeps server errors visible and does not change the unread count on failure", async () => {
    mock.set.mockRejectedValue(new Error("denied"));
    render(<AdminActivityPopover role="MANAGER" staff={staff} />);
    await bell();
    fireEvent.click(screen.getAllByRole("button", { name: "Marcar como leída" })[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.getByRole("button", { name: "2 notificaciones sin leer" })).toBeInTheDocument();
  });
});
