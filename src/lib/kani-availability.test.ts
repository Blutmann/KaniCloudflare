import { describe, expect, it } from "vitest";
import {
  availabilityStartTimesForServiceDate,
  availableTimesForServiceDate,
  defaultSlotEndTime,
  eligibleBarbersForAvailabilityStart,
  eligibleBarbersForServiceSlot,
  effectiveServiceDurationSeconds,
  FIXED_BOOKING_START_TIMES,
  isAllowedPublicBookingStart,
  isManageableScheduleDate,
  validateAvailabilityRange,
  type PublicAvailabilityStart,
  type PublicAvailabilitySlot,
} from "./kani-availability";

const now = new Date("2026-10-08T07:00:00");

function slot({
  id,
  barber_name,
  start_time,
  end_time,
  slot_date = "2026-10-08",
  status = "AVAILABLE",
}: Pick<PublicAvailabilitySlot, "id" | "barber_name" | "start_time" | "end_time"> & {
  slot_date?: string;
  status?: PublicAvailabilitySlot["status"];
}) {
  return {
    id,
    barber_id: `${barber_name}-id`,
    slot_date,
    start_time,
    end_time,
    status,
    barber_name,
  } as PublicAvailabilitySlot;
}

describe("public booking availability helpers", () => {
  it("mantiene las duraciones comerciales exactas (Barba 30m, Corte 45m, Corte + barba 60m) y tramos de 45 minutos", () => {
    expect(effectiveServiceDurationSeconds(60)).toBe(60 * 60);
    expect(effectiveServiceDurationSeconds(45)).toBe(45 * 60);
    expect(effectiveServiceDurationSeconds(30)).toBe(30 * 60);
    expect(defaultSlotEndTime("10:00")).toBe("10:45");
    expect(defaultSlotEndTime("10:45")).toBe("11:30");
    expect(defaultSlotEndTime("19:00")).toBe("19:45");
    expect(defaultSlotEndTime("08:15")).toBe("09:00");
    expect(defaultSlotEndTime("20:15")).toBe("21:00");
  });

  const fullWindow = [
    slot({
      id: "lautaro-window",
      barber_name: "Lautaro",
      start_time: "10:00:00",
      end_time: "20:00:00",
    }),
  ];

  it("ofrece los trece inicios comerciales habituales de 45 minutos cuando solo existe la ventana habitual", () => {
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

  it("filtra artefactos intermedios dentro de 10:00..19:45 pero permite inicios extraordinarios (08:15, 20:15)", () => {
    const starts: PublicAvailabilityStart[] = [
      { slot_date: "2026-10-08", start_time: "08:15:00", is_exception: true, compatible_services: ["Corte", "Barba", "Corte + barba"], barber_name: "Lautaro", barber_id: "lautaro-id" },
      { slot_date: "2026-10-08", start_time: "10:00:00", is_exception: false, compatible_services: ["Corte", "Barba", "Corte + barba"], barber_name: "Lautaro", barber_id: "lautaro-id" },
      { slot_date: "2026-10-08", start_time: "10:45:00", is_exception: false, compatible_services: ["Barba", "Corte + barba"], barber_name: "Lautaro", barber_id: "lautaro-id" },
      { slot_date: "2026-10-08", start_time: "12:10:00", is_exception: true, compatible_services: ["Barba"], barber_name: "Lautaro", barber_id: "lautaro-id" },
      { slot_date: "2026-10-08", start_time: "12:15:00", is_exception: false, compatible_services: ["Barba"], barber_name: "Lautaro", barber_id: "lautaro-id" },
      { slot_date: "2026-10-08", start_time: "20:15:00", is_exception: true, compatible_services: ["Corte", "Barba"], barber_name: "Lautaro", barber_id: "lautaro-id" },
    ];
    expect(availabilityStartTimesForServiceDate(starts, "2026-10-08", "Barba", now, "Lautaro")).toEqual(["08:15", "10:00", "10:45", "12:15", "20:15"]);
    expect(availabilityStartTimesForServiceDate(starts, "2026-10-08", "Corte + barba", now, "Lautaro")).toEqual(["08:15", "10:00", "10:45"]);
    expect(eligibleBarbersForAvailabilityStart(starts, "2026-10-08", "08:15", "Corte", now)).toEqual(["Lautaro"]);
    expect(eligibleBarbersForAvailabilityStart(starts, "2026-10-08", "20:15", "Corte", now)).toEqual(["Lautaro"]);
    expect(eligibleBarbersForAvailabilityStart(starts, "2026-10-08", "12:10", "Barba", now)).toEqual([]);
    expect(eligibleBarbersForAvailabilityStart(starts, "2026-10-08", "12:15", "Barba", now)).toEqual(["Lautaro"]);
  });

  it("Caso obligatorio de regresión 08:15->09:00 vs >=60m: Barba (30m) y Corte (45m) reservables en 08:15->09:00, Corte + barba (60m) NO reservable salvo cobertura continua >=60m", () => {
    const extraordinarySlot45m = [
      slot({
        id: "lautaro-extra-0815",
        barber_name: "Lautaro",
        start_time: "08:15:00",
        end_time: "09:00:00",
      }),
    ];

    // 1. Disponibilidad extraordinaria únicamente 08:15 -> 09:00:
    // - Barba (30m) SÍ puede reservarse a las 08:15
    expect(availableTimesForServiceDate(extraordinarySlot45m, "2026-10-08", 30, now, "Lautaro")).toEqual(["08:15"]);
    // - Corte (45m) SÍ puede reservarse a las 08:15
    expect(availableTimesForServiceDate(extraordinarySlot45m, "2026-10-08", 45, now, "Lautaro")).toEqual(["08:15"]);
    // - Corte + barba (60m) NO puede reservarse a las 08:15
    expect(availableTimesForServiceDate(extraordinarySlot45m, "2026-10-08", 60, now, "Lautaro")).toEqual([]);
    expect(availableTimesForServiceDate(extraordinarySlot45m, "2026-10-08", 60, now)).toEqual([]);

    // 2A. Cobertura continua suficiente mediante un bloque 08:15 -> 09:15:
    // - Corte + barba (60m) SÍ puede reservarse a las 08:15
    const extraordinarySlot60m = [
      slot({
        id: "lautaro-extra-0815-0915",
        barber_name: "Lautaro",
        start_time: "08:15:00",
        end_time: "09:15:00",
      }),
    ];
    expect(availableTimesForServiceDate(extraordinarySlot60m, "2026-10-08", 60, now, "Lautaro")).toEqual(["08:15"]);
    expect(availableTimesForServiceDate(extraordinarySlot60m, "2026-10-08", 60, now)).toEqual(["08:15"]);

    // 2B. Cobertura continua suficiente mediante segmentos consecutivos 08:15 -> 09:00 + 09:00 -> 09:45:
    // - Corte + barba (60m) SÍ puede reservarse a las 08:15
    const consecutiveExtraordinarySlots = [
      slot({
        id: "lautaro-extra-1",
        barber_name: "Lautaro",
        start_time: "08:15:00",
        end_time: "09:00:00",
      }),
      slot({
        id: "lautaro-extra-2",
        barber_name: "Lautaro",
        start_time: "09:00:00",
        end_time: "09:45:00",
      }),
    ];
    expect(availableTimesForServiceDate(consecutiveExtraordinarySlots, "2026-10-08", 60, now, "Lautaro")).toContain("08:15");
    expect(availableTimesForServiceDate(consecutiveExtraordinarySlots, "2026-10-08", 60, now)).toContain("08:15");

    // 3. Cuando 08:15 se ocupa / bloquea, deja de aparecer disponible
    const blockedExtraordinary = [
      ...extraordinarySlot45m,
      slot({
        id: "lautaro-extra-blocked",
        barber_name: "Lautaro",
        start_time: "08:15:00",
        end_time: "09:00:00",
        status: "UNAVAILABLE",
      }),
    ];
    expect(availableTimesForServiceDate(blockedExtraordinary, "2026-10-08", 45, now, "Lautaro")).toEqual([]);
  });

  it("Caso E y F: domingo sin disponibilidad permanece cerrado, domingo con disponibilidad explícita se habilita en Reserva V4", () => {
    const sundayDate = "2026-11-01"; // Domingo
    // Caso E: sin filas explícitas el domingo -> vacío
    expect(availableTimesForServiceDate([], sundayDate, 45, now, "Lautaro")).toEqual([]);

    // Caso F: domingo con disponibilidad explícita (ej. 10:00 -> 10:45 y 11:30 -> 12:15)
    const sundaySlots = [
      slot({
        id: "sunday-1",
        barber_name: "Lautaro",
        slot_date: sundayDate,
        start_time: "10:00:00",
        end_time: "10:45:00",
      }),
      slot({
        id: "sunday-2",
        barber_name: "Lautaro",
        slot_date: sundayDate,
        start_time: "11:30:00",
        end_time: "12:15:00",
      }),
    ];
    expect(availableTimesForServiceDate(sundaySlots, sundayDate, 45, now, "Lautaro")).toEqual(["10:00", "11:30"]);

    const sundayStarts: PublicAvailabilityStart[] = [
      {
        slot_date: sundayDate,
        start_time: "10:00:00",
        is_exception: true,
        compatible_services: ["Corte", "Barba", "Corte + barba"],
        barber_name: "Lautaro",
        barber_id: "lautaro-id",
      },
    ];
    expect(isAllowedPublicBookingStart(sundayDate, "10:00:00", true)).toBe(true);
    expect(availabilityStartTimesForServiceDate(sundayStarts, sundayDate, "Corte", now, "Lautaro")).toEqual(["10:00"]);
  });

  it("requiere todos los segmentos de cinco minutos de un servicio", () => {
    const splitWindow = [
      slot({ id: "first", barber_name: "Lautaro", start_time: "12:15:00", end_time: "12:30:00" }),
      slot({ id: "second", barber_name: "Lautaro", start_time: "12:35:00", end_time: "13:20:00" }),
    ];
    expect(availableTimesForServiceDate(splitWindow, "2026-10-08", 45, now, "Lautaro")).toEqual([]);
    expect(availableTimesForServiceDate(splitWindow, "2026-10-08", 30, now, "Lautaro")).toEqual([]);
  });

  it("permite intervalos contiguos y no inventa inicios intermedios dentro del rango habitual", () => {
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
  it("permite fechas futuras más allá de 21 días e incluye domingos como excepción explícita", () => {
    expect(isManageableScheduleDate("2026-11-16", "2026-10-11")).toBe(true);
    // Domingo 2026-10-11 es administrable cuando hoy es <= 2026-10-11
    expect(isManageableScheduleDate("2026-10-11", "2026-10-11")).toBe(true);
    // Fecha pasada sigue bloqueada
    expect(isManageableScheduleDate("2026-10-10", "2026-10-11")).toBe(false);
    // Si se pide explícitamente sin domingos, bloquea domingo
    expect(isManageableScheduleDate("2026-10-11", "2026-10-11", false)).toBe(false);
  });
});

describe("validación de disponibilidad extendida (00:00 - 23:59)", () => {
  it("permite el rango completo de 00:00 a 23:59", () => {
    expect(validateAvailabilityRange("00:00", "23:59")).toEqual({
      normalizedStart: "00:00:00",
      normalizedEnd: "23:59:00",
    });
  });

  it("permite horarios comerciales estándar, matutinos (08:15) y nocturnos extendidos (20:15)", () => {
    expect(validateAvailabilityRange("08:15", "09:00")).toEqual({
      normalizedStart: "08:15:00",
      normalizedEnd: "09:00:00",
    });
    expect(validateAvailabilityRange("10:00", "20:00")).toEqual({
      normalizedStart: "10:00:00",
      normalizedEnd: "20:00:00",
    });
    expect(validateAvailabilityRange("20:15", "21:00")).toEqual({
      normalizedStart: "20:15:00",
      normalizedEnd: "21:00:00",
    });
  });

  it("rechaza hora de fin anterior o igual al inicio", () => {
    expect(() => validateAvailabilityRange("20:00", "19:00")).toThrow(
      "La hora de fin debe ser posterior a la hora de inicio.",
    );
    expect(() => validateAvailabilityRange("15:00", "15:00")).toThrow(
      "La hora de fin debe ser posterior a la hora de inicio.",
    );
  });

  it("rechaza horas fuera del rango válido de 24 horas", () => {
    expect(() => validateAvailabilityRange("24:00")).toThrow(
      "La hora de inicio debe ser válida entre 00:00 y 23:59.",
    );
    expect(() => validateAvailabilityRange("10:00", "24:00")).toThrow(
      "La hora de fin debe ser válida entre 00:00 y 23:59.",
    );
  });
});
