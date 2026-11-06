import { act, fireEvent, render, screen, waitFor, within, cleanup } from "@testing-library/react";
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
  await screen.findByText(/Cliente uno reservó turno para/);
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
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it("opens the current detail before marking read and immediately updates the bell afterwards", async () => {
    render(<AdminActivityPopover role="MANAGER" staff={staff} />);
    await bell();
    fireEvent.click(within(screen.getByText(/Cliente uno reservó turno para/).closest('article')!).getByRole('button', {name:'Ver detalles'}));
    expect(await screen.findByRole("dialog", { name: "Detalle del turno" })).toBeInTheDocument();
    expect(screen.getByText('Detalle del turno')).toHaveClass('sr-only');
    expect(screen.queryByText('Estado actual del turno y sus cobros.')).toBeNull();
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
    fireEvent.click(screen.getAllByRole("button", { name: "Marcar como leída" })[0]!);
    await screen.findByRole("button", { name: "1 notificaciones sin leer" });
    fireEvent.click(screen.getByRole("button", { name: "Marcar como no leída" }));
    await screen.findByRole("button", { name: "2 notificaciones sin leer" });
    expect(mock.inbox.items[1].read_at).toBeNull();
  });
  it("closes the inbox without changing receipts and returns focus to its trigger", async () => {
    render(<AdminActivityPopover role="MANAGER" staff={staff} />);
    await bell();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar notificaciones" }));
    await waitFor(() => expect(screen.queryByText(/Cliente uno reservó turno para/)).toBeNull());
    expect(mock.set).not.toHaveBeenCalled();
    expect(mock.all).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "2 notificaciones sin leer" })).toHaveFocus());
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
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar notificación" })[0]!);
    const confirmation = await screen.findByRole("dialog", { name: "Eliminar notificaciones" });
    expect(mock.remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', {name:'Detalle del turno'})).toBeNull();
    expect(within(confirmation).getByText(/1 notificación seleccionada/)).toBeInTheDocument();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Confirmar eliminación" }));
    await waitFor(() => expect(mock.remove).toHaveBeenCalledWith(["uno"]));
    await screen.findByRole("button", { name: "1 notificaciones sin leer" });
  });
  it("keeps server errors visible and does not change the unread count on failure", async () => {
    mock.set.mockRejectedValue(new Error("denied"));
    render(<AdminActivityPopover role="MANAGER" staff={staff} />);
    await bell();
    fireEvent.click(screen.getAllByRole("button", { name: "Marcar como leída" })[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.getByRole("button", { name: "2 notificaciones sin leer" })).toBeInTheDocument();
  });
  it('shows one compact title, real names once, separate generation time and icon-only controls',async()=>{
    mock.inbox.items[1].event_date='2020-01-02';
    render(<AdminActivityPopover role="ADMIN" staff={staff}/>);await bell();
    expect(screen.getAllByRole('heading',{name:'Notificaciones'})).toHaveLength(1);
    expect(screen.queryByText('ACTIVIDAD')).toBeNull();
    expect(screen.getByText('Cliente dos canceló el turno del 02/01')).toBeInTheDocument();
    const card=screen.getByText(/Cliente uno reservó turno/).closest('article')!;
    expect(within(card).getAllByText(/Cliente uno/)).toHaveLength(1);
    expect(within(card).getByText('Uno',{exact:true})).toBeInTheDocument();
    const time=card.querySelector('time')!;
    expect(time.dateTime).toBe('2026-11-06T10:00:00Z');
    expect(time.textContent).toContain('07:00');
    expect(time.getAttribute('aria-label')).toContain('Generada el');
    expect(within(card).getByRole('button',{name:'Eliminar notificación'}).textContent).toBe('');
    expect(within(card).getByRole('button',{name:'Marcar como leída'}).textContent).toBe('');
    expect(card.querySelector('.notification-kind')).toBeNull();
  });
  it('confirms only the captured loaded IDs and keeps unloaded/new arrivals outside deletion',async()=>{
    mock.inbox.next_before=10;
    render(<AdminActivityPopover role="ADMIN" staff={staff}/>);await bell();
    fireEvent.click(screen.getByRole('button',{name:'Eliminar notificaciones'}));
    const dialog=await screen.findByRole('dialog',{name:'Eliminar notificaciones'});
    expect(within(dialog).getByText(/2 notificaciones cargadas/)).toBeInTheDocument();
    expect(within(dialog).getByText(/No incluye las que aún no se cargaron/)).toBeInTheDocument();
    mock.inbox.items.unshift(event('nuevo',18));recount();fireEvent.focus(window);
    await waitFor(()=>expect(mock.read).toHaveBeenCalledTimes(3));
    fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar eliminación'}));
    await waitFor(()=>expect(mock.remove).toHaveBeenCalledWith(['uno','dos']));
    expect(mock.inbox.items.map((n:any)=>n.id)).toEqual(['nuevo']);
  });
  it('updates the BA calendar day across midnight and on tab return, without losing old items',async()=>{
    vi.useFakeTimers({toFake:['Date','setInterval','clearInterval']});
    vi.setSystemTime(new Date('2026-11-09T02:59:59Z'));
    mock.inbox.items[0].event_date='2026-11-09';mock.inbox.items[1].event_date='2020-01-02';
    render(<AdminActivityPopover role="MANAGER" staff={staff}/>);await bell();
    expect(screen.getByText('Cliente uno reservó turno para mañana')).toBeInTheDocument();
    mock.read.mockRejectedValue(new Error('Controlled offline state'));
    await act(async()=>{vi.advanceTimersByTime(1000);});
    expect(screen.getByText('Cliente uno reservó turno para hoy')).toBeInTheDocument();
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
    fireEvent(document,new Event('visibilitychange'));
    await screen.findByText('Cliente uno reservó turno para el 09/11');
    expect(screen.getByText('Cliente dos canceló el turno del 02/01')).toBeInTheDocument();
  });
});
