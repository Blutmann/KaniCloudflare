import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  profile: { role: "MANAGER", barber_id: null as string | null, active: true },
  barbers: ["Lautaro", "Gonzalo", "Valentín", "Franco"].map((name, n) => ({
    id: `barber-${n}`,
    name,
    active: true,
  })),
  read: vi.fn(),
  starts: vi.fn(),
  appointments: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}));
vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    profile: state.profile,
    barbers: state.barbers,
    refreshCount: 0,
    setIsRefreshing: state.refresh,
  }),
}));
vi.mock("@/lib/kani-appointments", () => ({ readRealAppointments: state.appointments }));
vi.mock("@/lib/kani-availability", () => ({
  readAvailabilitySlotsForRange: state.read,
  readAvailabilityStartsForRange: state.starts,
  createAvailabilitySlots: state.create,
  updateAvailabilitySlot: state.update,
  FIXED_BOOKING_START_TIMES: ["10:00"],
}));
import { AdminScheduleManager } from "@/components/kani/admin-schedule-manager";
import { businessDateToday } from "@/lib/kani-mobile-appointments";
afterEach(cleanup);
beforeEach(() => {
  state.profile = { role: "MANAGER", barber_id: null, active: true };
  vi.clearAllMocks();
  state.read.mockResolvedValue([]);
  state.starts.mockResolvedValue([]);
  state.appointments.mockResolvedValue([]);
  state.create.mockResolvedValue([]);
  state.update.mockResolvedValue({});
});
describe("Four professional schedules and individual scope", () => {
  it.each(["MANAGER", "ADMIN"])(
    "allows %s to select and create availability on every existing barber",
    async (role) => {
      state.profile.role = role;
      render(<AdminScheduleManager />);
      const selector = screen.getByRole("combobox", { name: "Barbero" });
      expect(Array.from((selector as HTMLSelectElement).options).map((o) => o.text)).toEqual(
        state.barbers.map((b) => b.name),
      );
      for (const barber of state.barbers) {
        fireEvent.change(selector, { target: { value: barber.name } });
        await waitFor(() =>
          expect(state.read).toHaveBeenLastCalledWith(barber.id, expect.any(Object)),
        );
        fireEvent.click(await screen.findByRole("button", { name: "+ Agregar horario" }));
        expect(screen.getByRole("combobox", { name: "Agenda" })).toHaveValue(barber.id);
        await waitFor(() =>
          expect(screen.getByRole("button", { name: "Guardar horario" })).toBeEnabled(),
        );
        fireEvent.click(screen.getByRole("button", { name: "Guardar horario" }));
        await waitFor(() =>
          expect(state.create).toHaveBeenLastCalledWith(
            expect.objectContaining({ barberId: barber.id }),
          ),
        );
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      }
    },
  );
  it("keeps BARBER on its own permanent ID even if extra rows are passed to the UI", async () => {
    state.profile = { role: "BARBER", barber_id: state.barbers[1]!.id, active: true };
    render(<AdminScheduleManager />);
    await screen.findByRole("button", { name: "+ Agregar horario" });
    expect(screen.queryByRole("combobox", { name: "Barbero" })).toBeNull();
    expect(state.read.mock.calls.every(([id]) => id === state.barbers[1]!.id)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar horario" }));
    expect(screen.queryByRole("combobox", { name: "Agenda" })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Guardar horario" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar horario" }));
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({ barberId: state.barbers[1]!.id }),
      ),
    );
  });
  it("ignores an older response after switching professionals", async () => {
    let complete: (rows: any[]) => void = () => {};
    state.read.mockImplementation((id) =>
      id === state.barbers[0]!.id
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : Promise.resolve([]),
    );
    render(<AdminScheduleManager />);
    await waitFor(() =>
      expect(state.read).toHaveBeenCalledWith(state.barbers[0]!.id, expect.any(Object)),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Barbero" }), {
      target: { value: "Gonzalo" },
    });
    await screen.findByRole("button", { name: "+ Agregar horario" });
    complete([
      {
        id: "stale",
        barber_id: state.barbers[0]!.id,
        slot_date: businessDateToday(),
        start_time: "22:00:00",
        end_time: "22:45:00",
        status: "AVAILABLE",
      },
    ]);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /22:00: Disponible/ })).toBeNull(),
    );
  });
  it("does not reload the previous barber when a pending block finishes", async () => {
    const slot = {
      id: "own-slot",
      barber_id: state.barbers[0]!.id,
      slot_date: businessDateToday(),
      start_time: "10:00:00",
      end_time: "10:45:00",
      status: "AVAILABLE",
      internal_note: "Nota preservada",
    };
    state.read.mockImplementation(async (id) => (id === slot.barber_id ? [slot] : []));
    let complete: (row: unknown) => void = () => {};
    state.update.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render(<AdminScheduleManager />);
    fireEvent.click(await screen.findByRole("button", { name: /10:00: Disponible/ }));
    expect(state.update).toHaveBeenCalledWith({
      id: slot.id,
      barberId: slot.barber_id,
      status: "UNAVAILABLE",
      internalNote: "Nota preservada",
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Barbero" }), {
      target: { value: "Gonzalo" },
    });
    await screen.findByRole("button", { name: "+ Agregar horario" });
    complete({ ...slot, status: "UNAVAILABLE" });
    await screen.findByText(/Lautaro · 10:00 actualizado/);
    expect(state.read).toHaveBeenLastCalledWith(state.barbers[1]!.id, expect.any(Object));
    expect(screen.queryByRole("button", { name: /10:00: No disponible/ })).toBeNull();
  });
});
