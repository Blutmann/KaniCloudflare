import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  availabilityStartTimesForServiceDate,
  availableTimesForServiceDate,
  baseBookingStartTimesForBarberDate,
  FIXED_BOOKING_START_TIMES,
  GONZALO_TUE_THU_START_TIMES,
  isAllowedPublicBookingStart,
  VALENTIN_TUE_FRI_START_TIMES,
  type PublicAvailabilitySlot,
  type PublicAvailabilityStart,
} from "../lib/kani-availability";
import type { Barber } from "../lib/kani-model";

// Calendar week in Dec 2026:
// Mon 2026-12-07, Tue 2026-12-08, Wed 2026-12-09, Thu 2026-12-10, Fri 2026-12-11, Sat 2026-12-12, Sun 2026-12-13
const MON = "2026-12-07";
const TUE = "2026-12-08";
const WED = "2026-12-09";
const THU = "2026-12-10";
const FRI = "2026-12-11";
const SAT = "2026-12-12";
const SUN = "2026-12-13";
const NOW = new Date("2026-12-01T12:00:00Z");

function makeBaseSlots(barber: Barber, date: string, starts: string[]): PublicAvailabilitySlot[] {
  return starts.map((t, idx) => {
    const [h, m] = t.split(":").map(Number);
    const endTotal = h * 60 + m + 45;
    const endTime = `${String(Math.floor(endTotal / 60)).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}:00`;
    return {
      id: `slot-${barber}-${date}-${idx}`,
      barber_id: `barber-${barber}`,
      barber_name: barber,
      slot_date: date,
      start_time: `${t}:00`,
      end_time: endTime,
      status: "AVAILABLE",
    };
  });
}

describe("Actualización de horarios base por barbero (45 min)", () => {
  describe("1. Lautaro — Lunes a Sábado 10:00 a 19:00, Domingo cerrado", () => {
    it("genera los 13 inicios exactos 10:00..19:00 de lunes a sábado y vacío en domingo", () => {
      const expected = [
        "10:00", "10:45", "11:30", "12:15", "13:00", "13:45",
        "14:30", "15:15", "16:00", "16:45", "17:30", "18:15", "19:00",
      ];
      expect(FIXED_BOOKING_START_TIMES).toEqual(expected);
      for (const date of [MON, TUE, WED, THU, FRI, SAT]) {
        expect(baseBookingStartTimesForBarberDate(date, "Lautaro")).toEqual(expected);
        expect(isAllowedPublicBookingStart(date, "10:00:00", false, "Lautaro")).toBe(true);
        expect(isAllowedPublicBookingStart(date, "19:00:00", false, "Lautaro")).toBe(true);
        expect(isAllowedPublicBookingStart(date, "19:15:00", false, "Lautaro")).toBe(false);
        expect(isAllowedPublicBookingStart(date, "19:30:00", false, "Lautaro")).toBe(false);
      }
      expect(baseBookingStartTimesForBarberDate(SUN, "Lautaro")).toEqual([]);
      expect(isAllowedPublicBookingStart(SUN, "10:00:00", false, "Lautaro")).toBe(false);
    });
  });

  describe("2. Gonzalo — Lun/Mié/Vie/Sáb 10:00..19:00 y Mar/Jue 11:00..19:15", () => {
    const expectedTueThu = [
      "11:00", "11:45", "12:30", "13:15", "14:00", "14:45",
      "15:30", "16:15", "17:00", "17:45", "18:30", "19:15",
    ];

    it("usa 10:00..19:00 los Lunes, Miércoles, Viernes y Sábado", () => {
      for (const date of [MON, WED, FRI, SAT]) {
        expect(baseBookingStartTimesForBarberDate(date, "Gonzalo")).toEqual(FIXED_BOOKING_START_TIMES);
        expect(isAllowedPublicBookingStart(date, "10:00:00", false, "Gonzalo")).toBe(true);
        expect(isAllowedPublicBookingStart(date, "19:00:00", false, "Gonzalo")).toBe(true);
        expect(isAllowedPublicBookingStart(date, "19:15:00", false, "Gonzalo")).toBe(false);
      }
    });

    it("usa 11:00..19:15 los Martes y Jueves sin horarios desfasados como 10:00 o 19:00", () => {
      expect(GONZALO_TUE_THU_START_TIMES).toEqual(expectedTueThu);
      for (const date of [TUE, THU]) {
        expect(baseBookingStartTimesForBarberDate(date, "Gonzalo")).toEqual(expectedTueThu);
        expect(isAllowedPublicBookingStart(date, "11:00:00", false, "Gonzalo")).toBe(true);
        expect(isAllowedPublicBookingStart(date, "19:15:00", false, "Gonzalo")).toBe(true);
        expect(isAllowedPublicBookingStart(date, "10:00:00", false, "Gonzalo")).toBe(false);
        expect(isAllowedPublicBookingStart(date, "19:00:00", false, "Gonzalo")).toBe(false);
      }
      expect(baseBookingStartTimesForBarberDate(SUN, "Gonzalo")).toEqual([]);
    });

    it("expone correctamente 11:00..19:15 en availabilityStartTimesForServiceDate", () => {
      const starts: PublicAvailabilityStart[] = expectedTueThu.map((t) => ({
        barber_id: "b-gonza",
        barber_name: "Gonzalo",
        slot_date: TUE,
        start_time: `${t}:00`,
        is_exception: false,
        compatible_services: ["Corte", "Barba"],
      }));
      expect(availabilityStartTimesForServiceDate(starts, TUE, "Corte", NOW, "Gonzalo")).toEqual(expectedTueThu);
    });
  });

  describe("3. Valentín — Lunes franco, Mar–Vie 12:00..19:30, Sábado 10:00..19:00", () => {
    const expectedTueFri = [
      "12:00", "12:45", "13:30", "14:15", "15:00", "15:45",
      "16:30", "17:15", "18:00", "18:45", "19:30",
    ];

    it("no tiene disponibilidad base los Lunes ni Domingos", () => {
      expect(baseBookingStartTimesForBarberDate(MON, "Valentín")).toEqual([]);
      expect(isAllowedPublicBookingStart(MON, "10:00:00", false, "Valentín")).toBe(false);
      expect(isAllowedPublicBookingStart(MON, "12:00:00", false, "Valentín")).toBe(false);
      expect(baseBookingStartTimesForBarberDate(SUN, "Valentín")).toEqual([]);
    });

    it("usa 12:00..19:30 de Martes a Viernes sin horarios desfasados", () => {
      expect(VALENTIN_TUE_FRI_START_TIMES).toEqual(expectedTueFri);
      for (const date of [TUE, WED, THU, FRI]) {
        expect(baseBookingStartTimesForBarberDate(date, "Valentín")).toEqual(expectedTueFri);
        expect(isAllowedPublicBookingStart(date, "12:00:00", false, "Valentín")).toBe(true);
        expect(isAllowedPublicBookingStart(date, "19:30:00", false, "Valentín")).toBe(true);
        expect(isAllowedPublicBookingStart(date, "10:00:00", false, "Valentín")).toBe(false);
        expect(isAllowedPublicBookingStart(date, "11:00:00", false, "Valentín")).toBe(false);
        expect(isAllowedPublicBookingStart(date, "19:00:00", false, "Valentín")).toBe(false);
      }
    });

    it("usa 10:00..19:00 los Sábados", () => {
      expect(baseBookingStartTimesForBarberDate(SAT, "Valentín")).toEqual(FIXED_BOOKING_START_TIMES);
      expect(isAllowedPublicBookingStart(SAT, "10:00:00", false, "Valentín")).toBe(true);
      expect(isAllowedPublicBookingStart(SAT, "19:00:00", false, "Valentín")).toBe(true);
      expect(isAllowedPublicBookingStart(SAT, "19:30:00", false, "Valentín")).toBe(false);
    });
  });

  describe("4. Bloqueos UNAVAILABLE y horarios extraordinarios sobre la nueva grilla", () => {
    it("respeta bloqueos UNAVAILABLE en Martes de Gonzalo (11:45) y Miércoles de Valentín (19:30)", () => {
      const gonzaSlots: PublicAvailabilitySlot[] = [
        ...makeBaseSlots("Gonzalo", TUE, GONZALO_TUE_THU_START_TIMES),
        {
          id: "blk-gonza-1145",
          barber_id: "barber-Gonzalo",
          barber_name: "Gonzalo",
          slot_date: TUE,
          start_time: "11:45:00",
          end_time: "12:30:00",
          status: "UNAVAILABLE",
        },
      ];
      const gonzaTimes = availableTimesForServiceDate(gonzaSlots, TUE, 45, NOW, "Gonzalo");
      expect(gonzaTimes).toContain("11:00");
      expect(gonzaTimes).not.toContain("11:45");
      expect(gonzaTimes).toContain("19:15");

      const valSlots: PublicAvailabilitySlot[] = [
        ...makeBaseSlots("Valentín", WED, VALENTIN_TUE_FRI_START_TIMES),
        {
          id: "blk-val-1930",
          barber_id: "barber-Valentín",
          barber_name: "Valentín",
          slot_date: WED,
          start_time: "19:30:00",
          end_time: "20:15:00",
          status: "UNAVAILABLE",
        },
      ];
      const valTimes = availableTimesForServiceDate(valSlots, WED, 45, NOW, "Valentín");
      expect(valTimes).toContain("12:00");
      expect(valTimes).toContain("18:45");
      expect(valTimes).not.toContain("19:30");
    });

    it("permite agregar horarios extraordinarios (Lunes de Valentín o 09:00 de Gonzalo) sin ser filtrados", () => {
      expect(isAllowedPublicBookingStart(MON, "14:00:00", true, "Valentín")).toBe(true);
      expect(isAllowedPublicBookingStart(TUE, "09:00:00", true, "Gonzalo")).toBe(true);

      const mondayExtraVal: PublicAvailabilitySlot[] = [
        {
          id: "extra-val-mon",
          barber_id: "barber-Valentín",
          barber_name: "Valentín",
          slot_date: MON,
          start_time: "14:00:00",
          end_time: "14:45:00",
          status: "AVAILABLE",
        },
      ];
      expect(availableTimesForServiceDate(mondayExtraVal, MON, 45, NOW, "Valentín")).toEqual(["14:00"]);
    });
  });

  describe("5. Integridad de migración SQL 20261127000100_kani_barber_base_schedules_update.sql", () => {
    const sqlPath = path.resolve(
      __dirname,
      "../../supabase/migrations/20261127000100_kani_barber_base_schedules_update.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf-8");

    it("define las grillas por barbero en read_valid_availability_starts y request_appointment", () => {
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.read_valid_availability_starts");
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.request_appointment");
      expect(sql).toContain("timestamp '2000-01-01 11:00:00'");
      expect(sql).toContain("timestamp '2000-01-01 19:15:00'");
      expect(sql).toContain("timestamp '2000-01-01 12:00:00'");
      expect(sql).toContain("timestamp '2000-01-01 19:30:00'");
      expect(sql).toContain("b.name IN ('Valentín', 'Valentin')");
      expect(sql).toContain("b.name = 'Franco'");
    });

    it("limpia solo slots futuros AVAILABLE pre-materializados sin turnos activos ni bloqueos UNAVAILABLE", () => {
      expect(sql).toContain("AND s.status = 'AVAILABLE'");
      expect(sql).toContain("AND s.updated_by IS NULL");
      expect(sql).toContain("AND s.internal_note IS NULL");
      expect(sql).toContain("AND a.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')");
      expect(sql).toContain("FROM public.recurring_availability_rules r");
      expect(sql).toContain("ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING");
    });
  });
});
