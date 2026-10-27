import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeAvailableManualSlots,
  filterSlotsByPeriod,
  isIntervalOverlapping,
  minutesToTime,
  timeToMinutes,
} from "@/lib/kani-manual-intervals";
import { businessDateToday } from "@/lib/kani-mobile-appointments";
import type { RealAppointment } from "@/lib/kani-appointments";

const mockStaff = {
  profile: { role: "ADMIN", barber_id: null },
  barbers: [
    { id: "barber-lautaro", name: "Lautaro" },
    { id: "barber-gonzalo", name: "Gonzalo" },
    { id: "barber-valentin", name: "Valentín" },
  ],
};

const mockAppointments: RealAppointment[] = [
  {
    id: "apt-manual-1",
    requestNumber: 101,
    service: "corte",
    barber: "Lautaro",
    date: businessDateToday(),
    time: "10:00",
    endTime: "10:45",
    name: "Carlos Tevez",
    email: "tevez@boca.internal",
    phone: "+5491112345678",
    status: "Confirmado",
    statusCode: "CONFIRMED",
    notes: "Cliente habitual",
    barberId: "barber-lautaro",
    serviceId: "svc-corte-id",
    serviceName: "Corte",
    serviceDuration: 45,
    servicePrice: 25000,
    isManual: true,
    origin: "MANUAL",
    createdByDisplayName: "Admin",
    depositRequired: false,
    depositPaid: false,
  },
];

vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => mockStaff,
}));

vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    barberId: "ALL",
    setBarberId: vi.fn(),
    depositSupported: true,
    refresh: vi.fn(),
    appointments: mockAppointments,
    services: [
      { id: "corte", dbId: "svc-corte-id", name: "Corte", duration: 45, price: 25000 },
      { id: "barba", dbId: "svc-barba-id", name: "Barba", duration: 30, price: 15000 },
      { id: "corte-barba", dbId: "svc-cb-id", name: "Corte + barba", duration: 45, price: 30000 },
    ],
    clients: [
      { id: "client-1", name: "Carlos Tevez", phone: "+5491112345678", email: "tevez@boca.internal" },
    ],
  }),
}));

vi.mock("@/lib/kani-appointments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kani-appointments")>();
  return {
    ...actual,
    updateRealAppointmentStatus: vi.fn(),
    createManualAppointment: vi.fn(),
    updateManualAppointment: vi.fn(),
  };
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

import { V2Appointments } from "@/components/kani/v2/agenda";
import { ManualAppointmentDialog } from "@/components/kani/v2/manual-appointment-dialog";

afterEach(() => {
  cleanup();
  mockStaff.profile.role = "ADMIN";
  mockStaff.profile.barber_id = null;
});

describe("Admin V2 — Manual Appointments (Anti-solapamiento e Intervalos)", () => {
  it("converts time to minutes and minutes to time accurately", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("10:00")).toBe(600);
    expect(timeToMinutes("23:45")).toBe(1425);
    expect(timeToMinutes("00:00")).toBe(0);

    expect(minutesToTime(570)).toBe("09:30");
    expect(minutesToTime(600)).toBe("10:00");
    expect(minutesToTime(1425)).toBe("23:45");
    expect(minutesToTime(0)).toBe("00:00");
  });

  it("evaluates interval overlap condition strictly: [start, end)", () => {
    expect(isIntervalOverlapping(570, 615, 600, 660)).toBe(true);
    expect(isIntervalOverlapping(600, 660, 570, 615)).toBe(true);
    expect(isIntervalOverlapping(765, 795, 780, 840)).toBe(true);

    expect(isIntervalOverlapping(555, 600, 600, 645)).toBe(false);
    expect(isIntervalOverlapping(600, 645, 645, 690)).toBe(false);
    expect(isIntervalOverlapping(750, 780, 780, 840)).toBe(false);
    expect(isIntervalOverlapping(780, 840, 840, 870)).toBe(false);

    expect(isIntervalOverlapping(570, 615, 630, 675)).toBe(false);
  });

  it("Ejemplo principal: Existente 10:00-11:00 rechaza nuevo 09:30-10:15", () => {
    const existing = [
      {
        id: "apt-1",
        barberId: "barber-lautaro",
        date: "2026-10-28",
        time: "10:00",
        endTime: "11:00",
        serviceDuration: 60,
        statusCode: "CONFIRMED",
      },
    ];

    const slots = computeAvailableManualSlots({
      appointments: existing,
      barberId: "barber-lautaro",
      date: "2026-10-28",
      durationMinutes: 45,
    });

    const slot0930 = slots.find((s) => s.time === "09:30");
    expect(slot0930).toBeDefined();
    expect(slot0930?.available).toBe(false);
  });

  it("Ejemplo válido: Existente 10:30-11:15 permite nuevo 09:30-10:15 con margen libre", () => {
    const existing = [
      {
        id: "apt-2",
        barberId: "barber-lautaro",
        date: "2026-10-28",
        time: "10:30",
        endTime: "11:15",
        serviceDuration: 45,
        statusCode: "CONFIRMED",
      },
    ];

    const slots = computeAvailableManualSlots({
      appointments: existing,
      barberId: "barber-lautaro",
      date: "2026-10-28",
      durationMinutes: 45,
    });

    const slot0930 = slots.find((s) => s.time === "09:30");
    expect(slot0930).toBeDefined();
    expect(slot0930?.available).toBe(true);
  });

  it("Límites exactos adyacentes: Existente 10:00-10:45 permite 09:15-10:00 y 10:45-11:30", () => {
    const existing = [
      {
        id: "apt-3",
        barberId: "barber-lautaro",
        date: "2026-10-28",
        time: "10:00",
        endTime: "10:45",
        serviceDuration: 45,
        statusCode: "CONFIRMED",
      },
    ];

    const slots = computeAvailableManualSlots({
      appointments: existing,
      barberId: "barber-lautaro",
      date: "2026-10-28",
      durationMinutes: 45,
    });

    const slot0915 = slots.find((s) => s.time === "09:15");
    expect(slot0915?.available).toBe(true);

    const slot1045 = slots.find((s) => s.time === "10:45");
    expect(slot1045?.available).toBe(true);

    const slot0930 = slots.find((s) => s.time === "09:30");
    expect(slot0930?.available).toBe(false);

    const slot0945 = slots.find((s) => s.time === "09:45");
    expect(slot0945?.available).toBe(false);

    const slot1000 = slots.find((s) => s.time === "10:00");
    expect(slot1000?.available).toBe(false);

    const slot1015 = slots.find((s) => s.time === "10:15");
    expect(slot1015?.available).toBe(false);

    const slot1030 = slots.find((s) => s.time === "10:30");
    expect(slot1030?.available).toBe(false);
  });

  it("Duración según servicio: Existente 13:00-14:00 (Corte y barba) para Barba 30 min", () => {
    const existing = [
      {
        id: "apt-4",
        barberId: "barber-lautaro",
        date: "2026-10-28",
        time: "13:00",
        endTime: "14:00",
        serviceDuration: 60,
        statusCode: "CONFIRMED",
      },
    ];

    const slots = computeAvailableManualSlots({
      appointments: existing,
      barberId: "barber-lautaro",
      date: "2026-10-28",
      durationMinutes: 30,
    });

    expect(slots.find((s) => s.time === "12:30")?.available).toBe(true);
    expect(slots.find((s) => s.time === "12:45")?.available).toBe(false);
    expect(slots.find((s) => s.time === "13:00")?.available).toBe(false);
    expect(slots.find((s) => s.time === "13:15")?.available).toBe(false);
    expect(slots.find((s) => s.time === "13:30")?.available).toBe(false);
    expect(slots.find((s) => s.time === "13:45")?.available).toBe(false);
    expect(slots.find((s) => s.time === "14:00")?.available).toBe(true);
  });

  it("Turnos cancelados: No bloquean disponibilidad de agenda", () => {
    const existing = [
      {
        id: "apt-cancelled",
        barberId: "barber-lautaro",
        date: "2026-10-28",
        time: "10:00",
        endTime: "10:45",
        serviceDuration: 45,
        statusCode: "CANCELLED",
      },
    ];

    const slots = computeAvailableManualSlots({
      appointments: existing,
      barberId: "barber-lautaro",
      date: "2026-10-28",
      durationMinutes: 45,
    });

    expect(slots.find((s) => s.time === "10:00")?.available).toBe(true);
  });

  it("Exclusión en edición: Al editar un turno manual existente, no colisiona consigo mismo", () => {
    const existing = [
      {
        id: "apt-editing",
        barberId: "barber-lautaro",
        date: "2026-10-28",
        time: "10:00",
        endTime: "10:45",
        serviceDuration: 45,
        statusCode: "CONFIRMED",
      },
      {
        id: "apt-other",
        barberId: "barber-lautaro",
        date: "2026-10-28",
        time: "11:00",
        endTime: "11:45",
        serviceDuration: 45,
        statusCode: "CONFIRMED",
      },
    ];

    const slots = computeAvailableManualSlots({
      appointments: existing,
      barberId: "barber-lautaro",
      date: "2026-10-28",
      durationMinutes: 45,
      excludeAppointmentId: "apt-editing",
    });

    expect(slots.find((s) => s.time === "10:00")?.available).toBe(true);
    expect(slots.find((s) => s.time === "11:00")?.available).toBe(false);
  });

  it("Filtros por período: agrupa correctamente cápsulas en COMERCIAL, MANANA, NOCHE, MADRUGADA", () => {
    const slots = computeAvailableManualSlots({
      appointments: [],
      barberId: "barber-1",
      date: "2026-10-28",
      durationMinutes: 45,
    });

    const comercial = filterSlotsByPeriod(slots, "COMERCIAL");
    expect(comercial.length).toBeGreaterThan(0);
    expect(comercial.every((s) => s.minutes >= 540 && s.minutes <= 1200)).toBe(true);

    const manana = filterSlotsByPeriod(slots, "MANANA");
    expect(manana.every((s) => s.minutes >= 360 && s.minutes < 540)).toBe(true);

    const noche = filterSlotsByPeriod(slots, "NOCHE");
    expect(noche.every((s) => s.minutes > 1200)).toBe(true);

    const madrugada = filterSlotsByPeriod(slots, "MADRUGADA");
    expect(madrugada.every((s) => s.minutes < 360)).toBe(true);

    const todos = filterSlotsByPeriod(slots, "TODOS");
    expect(todos.length).toBe(slots.length);
  });

  it("Manejo de concurrencia y permisos con mensajes de error amigables", async () => {
    const { appointmentErrorMessage } = await import("@/lib/kani-appointments");

    const errConcurrency = new Error("23P01: SLOT_ALREADY_BOOKED");
    expect(appointmentErrorMessage(errConcurrency)).toBe(
      "Ese horario acaba de ocuparse. Elegí otro horario disponible."
    );

    const errBarberCancel = new Error("42501: BARBER_CANNOT_CANCEL_MANUAL_APPOINTMENT");
    expect(appointmentErrorMessage(errBarberCancel)).toBe(
      "No tenés permisos para cancelar turnos manuales."
    );

    const errBarberReassign = new Error("42501: BARBER_CANNOT_REASSIGN_APPOINTMENT");
    expect(appointmentErrorMessage(errBarberReassign)).toBe(
      "No podés reasignar un turno a otro barbero."
    );

    const errBarberPermission = new Error("42501: MANUAL_APPOINTMENT_NOT_ALLOWED");
    expect(appointmentErrorMessage(errBarberPermission)).toBe(
      "No tenés permisos para agendar en la agenda de otro barbero."
    );
  });
});

describe("Admin V2 — UI de Turnos y Permisos", () => {
  it("renders 'Agregar turno' action button in V2Appointments header", () => {
    render(<V2Appointments />);
    expect(screen.getByRole("button", { name: /Agregar turno/i })).toBeInTheDocument();
  });

  it("displays 'Manual' badge on manual appointment", () => {
    render(<V2Appointments />);
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("permits ADMIN to see 'Editar' and 'Cancelar turno' on manual appointments", () => {
    mockStaff.profile.role = "ADMIN";
    mockStaff.profile.barber_id = null;
    render(<V2Appointments />);

    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar turno" })).toBeInTheDocument();
  });

  it("restricts BARBER from cancelling manual appointments while permitting 'Editar' for own appointment", () => {
    mockStaff.profile.role = "BARBER";
    mockStaff.profile.barber_id = "barber-lautaro"; // matches mockAppointment.barberId
    render(<V2Appointments />);

    // Barber CAN edit their own manual appointment
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();

    // Barber CANNOT cancel manual appointments (button must NOT be offered)
    expect(screen.queryByRole("button", { name: "Cancelar turno" })).toBeNull();
  });

  it("ManualAppointmentDialog locks barber selection for BARBER and shows explicit notice", () => {
    mockStaff.profile.role = "BARBER";
    mockStaff.profile.barber_id = "barber-lautaro";

    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    // Shows static/readonly barber box for BARBER role
    expect(screen.getAllByText("Lautaro").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("combobox", { name: /Barbero/i })).toBeNull();

    // Explains no-deposit policy
    expect(
      screen.getByText(
        "Este turno se incorpora directamente a la agenda sin cobro de seña."
      )
    ).toBeInTheDocument();
  });

  it("ManualAppointmentDialog allows ADMIN to select any active barber", () => {
    mockStaff.profile.role = "ADMIN";
    mockStaff.profile.barber_id = null;

    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    // Shows barber select dropdown for ADMIN
    const select = screen.getByRole("combobox", { name: /Barbero/i });
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Lautaro" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Gonzalo" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Valentín" })).toBeInTheDocument();
  });
});
