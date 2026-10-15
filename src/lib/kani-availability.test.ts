import { describe, expect, it } from "vitest";
import {
  availabilityStartTimesForServiceDate,
  availableTimesForServiceDate,
  eligibleBarbersForAvailabilityStart,
  eligibleBarbersForServiceSlot,
  effectiveServiceDurationSeconds,
  FIXED_BOOKING_START_TIMES,
  isManageableScheduleDate,
  type PublicAvailabilityStart,
  type PublicAvailabilitySlot,
} from "./kani-availability";

const now = new Date("2026-10-08T09:00:00");

function slot({
  id,
  barber_name,
  start_time,
  end_time,
  status = "AVAILABLE",
}: Pick<PublicAvailabilitySlot, "id" | "barber_name" | "start_time" | "end_time"> & {
  status?: PublicAvailabilitySlot["status"];
}) {
  return {
    id,
    barber_id: `${barber_name}-id`,
    slot_date: "2026-10-08",
    start_time,
    end_time,
    status,
    barber_name,
  } as PublicAvailabilitySlot;
}

describe("public booking availability helpers", () => {
  it("mantiene las duraciones comerciales exactas", () => {
    expect(effectiveServiceDurationSeconds(45)).toBe(45 * 60);
    expect(effectiveServiceDurationSeconds(30)).toBe(30 * 60);
  });

  const fullWindow = [
    slot({
      id: "lautaro-window",
      barber_name: "Lautaro",
      start_time: "10:00:00",
      end_time: "20:00:00",
    }),
  ];

  it("ofrece únicamente los trece inicios comerciales fijos", () => {
    expect(availableTimesForServiceDate(fullWindow, "2026-10-08", 45, now, "Lautaro")).toEqual(FIXED_BOOKING_START_TIMES);
    expect(availableTimesForServiceDate(fullWindow, "2026-10-08", 30, now, "Lautaro")).toEqual(FIXED_BOOKING_START_TIMES);
  });

  it("mantiene barberos separados y respeta bloqueos", () => {
    const slots = [
      ...fullWindow,
      slot({
        id: "gonzalo-window",
        barber_name: "Gonzalo",
        start_time: "10:00:00",
        end_time: "11:00:00",
      }),
      slot({
        id: "gonzalo-blocked",
        barber_name: "Gonzalo",
        start_time: "10:15:00",
        end_time: "10:30:00",
        status: "UNAVAILABLE",
      }),
      slot({
        id: "valentin-window",
        barber_name: "Valentín",
        start_time: "10:00:00",
        end_time: "11:00:00",
      }),
    ];
    expect(eligibleBarbersForServiceSlot(slots, "2026-10-08", "10:00", 30, now)).toEqual([
      "Lautaro",
      "Valentín",
    ]);
    expect(availableTimesForServiceDate(slots, "2026-10-08", 45, now, "Gonzalo")).toEqual([]);
  });

  it("filtra la respuesta de inicios para aceptar solo la secuencia fija", () => {
    const starts: PublicAvailabilityStart[] = [
      { slot_date: "2026-10-08", start_time: "10:00:00", is_exception: false, compatible_services: ["Corte", "Barba", "Corte + barba"], barber_name: "Lautaro", barber_id: "lautaro-id" },
      { slot_date: "2026-10-08", start_time: "10:45:00", is_exception: false, compatible_services: ["Barba", "Corte + barba"], barber_name: "Lautaro", barber_id: "lautaro-id" },
      { slot_date: "2026-10-08", start_time: "12:10:00", is_exception: true, compatible_services: ["Barba"], barber_name: "Lautaro", barber_id: "lautaro-id" },
      { slot_date: "2026-10-08", start_time: "12:15:00", is_exception: false, compatible_services: ["Barba"], barber_name: "Lautaro", barber_id: "lautaro-id" },
    ];
    expect(availabilityStartTimesForServiceDate(starts, "2026-10-08", "Barba", now, "Lautaro")).toEqual(["10:00", "10:45", "12:15"]);
    expect(availabilityStartTimesForServiceDate(starts, "2026-10-08", "Corte + barba", now, "Lautaro")).toEqual(["10:00", "10:45"]);
    expect(eligibleBarbersForAvailabilityStart(starts, "2026-10-08", "12:10", "Barba", now)).toEqual([]);
    expect(eligibleBarbersForAvailabilityStart(starts, "2026-10-08", "12:15", "Barba", now)).toEqual(["Lautaro"]);
  });

  it("requiere todos los segmentos de cinco minutos de un servicio", () => {
    const splitWindow = [
      slot({ id: "first", barber_name: "Lautaro", start_time: "12:15:00", end_time: "12:30:00" }),
      slot({ id: "second", barber_name: "Lautaro", start_time: "12:35:00", end_time: "13:20:00" }),
    ];
    expect(availableTimesForServiceDate(splitWindow, "2026-10-08", 45, now, "Lautaro")).toEqual([]);
    expect(availableTimesForServiceDate(splitWindow, "2026-10-08", 30, now, "Lautaro")).toEqual([]);
  });

  it("permite intervalos contiguos y no inventa inicios intermedios", () => {
    const window = [slot({ id: "remaining", barber_name: "Lautaro", start_time: "11:30:00", end_time: "12:00:00" })];
    expect(availableTimesForServiceDate(window, "2026-10-08", 30, now, "Lautaro")).toEqual(["11:30"]);

    const intermediateWindow = [slot({ id: "intermediate", barber_name: "Lautaro", start_time: "12:00:00", end_time: "13:30:00" })];
    expect(availableTimesForServiceDate(intermediateWindow, "2026-10-08", 45, now, "Lautaro")).toEqual(["12:15"]);
    expect(availableTimesForServiceDate(intermediateWindow, "2026-10-08", 45, now, "Lautaro")).not.toContain("12:10");
  });

  it("rechaza duraciones inválidas sin crear un inicio parcial", () => {
    expect(availableTimesForServiceDate(fullWindow, "2026-10-08", 0, now)).toEqual([]);
    expect(availableTimesForServiceDate(fullWindow, "2026-10-08", 7, now)).toEqual([]);
  });
});

describe("fechas administrables de horarios", () => {
  it("permite fechas futuras más allá de 21 días y bloquea domingos", () => {
    expect(isManageableScheduleDate("2026-11-16", "2026-10-11")).toBe(true);
    expect(isManageableScheduleDate("2026-10-11", "2026-10-11")).toBe(false);
    expect(isManageableScheduleDate("2026-10-10", "2026-10-11")).toBe(false);
  });
});
