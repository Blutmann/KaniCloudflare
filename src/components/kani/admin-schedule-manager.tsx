import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Clock3, Repeat, SlidersHorizontal, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { cn } from "@/lib/utils";
import {
  addCalendarDays,
  businessDateToday,
  dateRangeForSchedulePreset,
  schedulePresetLabels,
  schedulePresets,
  type ScheduleDatePreset,
} from "@/lib/kani-mobile-appointments";
import { dateLabel, minutes, formatAdminV2Date, type Barber } from "@/lib/kani-model";
import {
  AdminFilterPanel,
  AdminFilterCell,
  AdminV2SectionToolbar,
} from "@/components/kani/v2/shared";
import {
  createAvailabilitySlots,
  readAvailabilityStartsForRange,
  readAvailabilitySlotsForRange,
  updateAvailabilitySlot,
  type AvailabilitySlot,
} from "@/lib/kani-availability";
import {
  readRealAppointments,
  updateRealAppointmentStatus,
  type RealAppointment,
} from "@/lib/kani-appointments";
import { permittedBarberNames } from "@/lib/kani-role-scope";
import { isStaffOperator, mayManageBarber } from "@/lib/kani-permissions";
import {
  createRecurringAvailabilityRule,
  fetchRecurringAvailabilityRules,
  generateRecurrenceDates,
  modifyRecurringAvailabilityRule,
  RECURRENCE_END_OPTIONS,
  RECURRENCE_FREQUENCY_OPTIONS,
  RECURRENCE_SCOPE_OPTIONS,
  type RecurrenceEndType,
  type RecurrenceFrequencyType,
  type RecurrenceScopeType,
  type RecurringAvailabilityRuleRecord,
} from "@/lib/kani-recurrences-memberships";

const datePresets: ScheduleDatePreset[] = schedulePresets;
export type ScheduleStatusFilter = "ALL" | "AVAILABLE" | "UNAVAILABLE" | "RESERVED";
type ScheduleSlot = AvailabilitySlot & {
  barberName: Barber;
  occupied: boolean;
  recurringRuleId?: string | null;
};
type ScheduleStart = Awaited<ReturnType<typeof readAvailabilityStartsForRange>>[number] & { barberName: Barber };

const SCHEDULE_TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const totalMinutes = index * 15;
  const hours = Math.floor(totalMinutes / 60);
  const minutesVal = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutesVal).padStart(2, '0')}`;
});

export function defaultSlotEndTime(startTime: string): string {
  const [hours, minutesVal] = startTime.split(':').map(Number);
  const totalMinutes = (hours * 60 + minutesVal + 45) % (24 * 60);
  const endHours = Math.floor(totalMinutes / 60);
  const endMinutes = totalMinutes % 60;
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
}

function errorMessage(cause: unknown, mode: "add" | "modify" = "modify") {
  const error = cause as { code?: unknown; message?: unknown; details?: unknown } | null;
  const message = [
    cause instanceof Error ? cause.message : "",
    typeof error?.message === "string" ? error.message : "",
    typeof error?.details === "string" ? error.details : "",
    typeof error?.code === "string" ? error.code : "",
  ].join(" ");
  if (message.includes("AVAILABILITY_APPOINTMENT_CONFLICT")) {
    const match = message.match(/AVAILABILITY_APPOINTMENT_CONFLICT:([^:]+):(\d{2}:\d{2}):(\d{2}:\d{2})/);
    if (match) {
      return mode === "add"
        ? `No se puede agregar esta franja porque ${match[1]} tiene un turno reservado de ${match[2]} a ${match[3]}.`
        : `No se puede modificar esta franja porque ${match[1]} tiene un turno reservado de ${match[2]} a ${match[3]}.`;
    }
    return mode === "add"
      ? "No se puede agregar esta franja porque tiene un turno reservado asociado."
      : "No se puede modificar esta franja porque tiene un turno reservado asociado.";
  }
  if (message.includes("AVAILABILITY_OVERLAP") || message.includes("AVAILABILITY_BLOCKED_START"))
    return "Ese inicio está dentro de un bloqueo existente.";
  if (message.includes("AVAILABILITY_DATE_INVALID"))
    return "Elegí una fecha igual o posterior a hoy para habilitar disponibilidad.";
  if (message.includes("START_TIME_INVALID") || message.includes("START_TIME_NOT_ALLOWED"))
    return "Elegí un horario válido entre las 00:00 y las 23:45 (intervalos de 15 minutos).";
  if (message.includes("END_TIME_INVALID") || message.includes("AVAILABILITY_INTERVAL_INVALID"))
    return "No se pudo calcular una ventana válida para ese inicio.";
  if (message.includes("BARBER_NOT_FOUND"))
    return "No se encontró el barbero seleccionado.";
  if (message.includes("DATE_REQUIRED"))
    return "Elegí al menos una fecha.";
  if (message.includes("AVAILABILITY_NOT_ALLOWED"))
    return "No tenés permiso para modificar esa agenda.";
  if (message.includes("INTERNAL_NOTE_TOO_LONG"))
    return "El comentario no puede superar los 500 caracteres.";
  return message || "No se pudo completar la operación.";
}

function overlaps(slot: AvailabilitySlot, appointment: RealAppointment) {
  if (
    appointment.statusCode === "CANCELLED" ||
    slot.barber_id !== appointment.barberId ||
    slot.slot_date !== appointment.date
  )
    return false;
  const slotStart = minutes(slot.start_time.slice(0, 5));
  const slotEnd =
    slot.end_time.slice(0, 5) <= slot.start_time.slice(0, 5)
      ? minutes(slot.end_time.slice(0, 5)) + 24 * 60
      : minutes(slot.end_time.slice(0, 5));
  const appointmentStart = minutes(appointment.time);
  let appointmentEnd = appointment.endTime
    ? minutes(appointment.endTime)
    : appointment.serviceDuration
      ? appointmentStart + appointment.serviceDuration
      : appointmentStart + 45;
  if (appointment.endTime && appointmentEnd <= appointmentStart) {
    appointmentEnd += 24 * 60;
  }
  return slotStart < appointmentEnd && appointmentStart < slotEnd;
}

export function AdminScheduleManager() {
  const { staff, profile, barbers: permittedRows, refreshCount, setIsRefreshing } = useAdminStaff();
  const permittedBarbers = useMemo(
    () => permittedBarberNames(profile, permittedRows),
    [permittedRows, profile],
  );
  const barberById = useMemo(
    () => new Map(permittedRows.map((row) => [row.id, row])),
    [permittedRows],
  );
  const ownBarberId = profile.role === "BARBER" ? profile.barber_id : null;
  const [businessToday, setBusinessToday] = useState(() => businessDateToday());
  const [datePreset, setDatePreset] = useState<ScheduleDatePreset>("TODAY");
  const [specificDate, setSpecificDate] = useState(() => businessDateToday());
  const [barberFilter, setBarberFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<ScheduleStatusFilter>("ALL");
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [allAppointments, setAllAppointments] = useState<RealAppointment[]>([]);
  const [recurringRules, setRecurringRules] = useState<RecurringAvailabilityRuleRecord[]>([]);
  const [, setValidStarts] = useState<ScheduleStart[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Modal Agregar Horario (FASE 2 & FASE 3)
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDate, setManualDate] = useState(() => businessDateToday());
  const [manualBarberId, setManualBarberId] = useState(
    () => ownBarberId ?? permittedRows[0]?.id ?? "",
  );
  const [manualTime, setManualTime] = useState("10:00");
  const [manualFrequency, setManualFrequency] = useState<RecurrenceFrequencyType>("ONCE");
  const [manualEndType, setManualEndType] = useState<RecurrenceEndType>("NEVER");
  const [manualEndDate, setManualEndDate] = useState(() => addCalendarDays(businessDateToday(), 30));
  const [manualMaxOccurrences, setManualMaxOccurrences] = useState<number>(4);
  const [manualError, setManualError] = useState("");
  const [manualChecking, setManualChecking] = useState(false);
  const [checkingNotice, setCheckingNotice] = useState(false);

  // FASE 6: Modal de advertencia al bloquear un horario o período con turnos confirmados
  const [blockConflictModal, setBlockConflictModal] = useState<{
    slot: ScheduleSlot;
    affectedAppointments: RealAppointment[];
    confirmCancelAll?: boolean;
  } | null>(null);

  // FASE 3 & 11: Modal de alcance al modificar/bloquear una disponibilidad recurrente
  const [recurringScopeModal, setRecurringScopeModal] = useState<{
    slot: ScheduleSlot;
    rule: RecurringAvailabilityRuleRecord;
    scope: RecurrenceScopeType;
  } | null>(null);

  const validationIdRef = useRef(0);
  const loadRevisionRef = useRef(0);

  useEffect(() => {
    if (!manualOpen) {
      setManualError("");
      setManualChecking(false);
      setCheckingNotice(false);
      return;
    }

    if (!manualBarberId || !manualDate || !manualTime) {
      setManualError("");
      setManualChecking(false);
      setCheckingNotice(false);
      return;
    }

    const currentReqId = ++validationIdRef.current;
    setManualChecking(true);
    setManualError("");

    const timer = window.setTimeout(() => {
      if (validationIdRef.current === currentReqId) {
        setCheckingNotice(true);
      }
    }, 150);

    const endTime = defaultSlotEndTime(manualTime);
    const candidateSlot: AvailabilitySlot = {
      id: "manual-candidate",
      barber_id: manualBarberId,
      slot_date: manualDate,
      start_time: `${manualTime}:00`,
      end_time: `${endTime}:00`,
      status: "AVAILABLE",
      is_manual: true,
    };

    readRealAppointments()
      .then((appointments) => {
        if (validationIdRef.current !== currentReqId) return;
        const conflict = appointments.find((apt) => overlaps(candidateSlot, apt));
        if (conflict && manualFrequency === "ONCE") {
          const barberName = barberById.get(manualBarberId)?.name ?? conflict.barber ?? "El barbero";
          const conflictStart = conflict.time;
          const conflictEnd = conflict.endTime || defaultSlotEndTime(conflict.time);
          setManualError(
            `No se puede agregar esta franja porque ${barberName} tiene un turno reservado de ${conflictStart} a ${conflictEnd}.`
          );
        } else {
          setManualError("");
        }
      })
      .catch((cause) => {
        if (validationIdRef.current !== currentReqId) return;
        console.warn("Error en prevalidación de disponibilidad:", cause);
      })
      .finally(() => {
        if (validationIdRef.current === currentReqId) {
          window.clearTimeout(timer);
          setCheckingNotice(false);
          setManualChecking(false);
        }
      });

    return () => {
      window.clearTimeout(timer);
    };
  }, [manualOpen, manualBarberId, manualDate, manualTime, manualFrequency, barberById]);

  useEffect(() => {
    if (profile.role === "BARBER") {
      setBarberFilter(permittedBarbers[0] ?? "");
      setManualBarberId(ownBarberId ?? "");
    } else {
      if (!permittedRows.some((row) => row.name === barberFilter))
        setBarberFilter(permittedRows[0]?.name ?? "");
      if (!permittedRows.some((row) => row.id === manualBarberId))
        setManualBarberId(permittedRows[0]?.id ?? "");
    }
  }, [barberFilter, manualBarberId, ownBarberId, permittedBarbers, permittedRows, profile.role]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = businessDateToday();
      setBusinessToday((current) => (current === next ? current : next));
      setManualDate((current) => (current < next ? next : current));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const dateRange = useMemo(
    () => dateRangeForSchedulePreset(datePreset, businessToday, specificDate),
    [businessToday, datePreset, specificDate],
  );
  const selectedRows = useMemo(() => {
    if (profile.role === "BARBER")
      return ownBarberId ? permittedRows.filter((row) => row.id === ownBarberId) : [];
    return permittedRows.filter((row) => row.name === barberFilter);
  }, [barberFilter, ownBarberId, permittedRows, profile.role]);
  const activeScopeRef = useRef({ selectedRows, dateRange });
  activeScopeRef.current = { selectedRows, dateRange };

  async function loadSlots() {
    if (activeScopeRef.current.selectedRows !== selectedRows || activeScopeRef.current.dateRange !== dateRange) return;
    const revision = ++loadRevisionRef.current;
    setLoading(true);
    setIsRefreshing(true);
    setError("");
    try {
      const [slotRows, starts, appointments, rules] = await Promise.all([
        Promise.all(
          selectedRows.map((row) => readAvailabilitySlotsForRange(row.id, dateRange)),
        ).then((rows) => rows.flat()),
        Promise.all(
          selectedRows.map((row) => readAvailabilityStartsForRange(row.id, dateRange)),
        ).then((rows) => rows.flat()),
        readRealAppointments(),
        fetchRecurringAvailabilityRules(staff, selectedRows[0]?.id).catch(
          () => [] as RecurringAvailabilityRuleRecord[],
        ),
      ]);
      if (revision !== loadRevisionRef.current) return;

      setAllAppointments(appointments);
      setRecurringRules(rules);

      // Combinar slots físicos con evaluación dinámica de reglas recurrentes activas para el rango solicitado
      const existingKeys = new Set(
        slotRows.map((s) => `${s.barber_id}|${s.slot_date}|${s.start_time.slice(0, 5)}`),
      );
      const ruleByKey = new Map<string, string>();
      const syntheticSlots: AvailabilitySlot[] = [];

      for (const rule of rules) {
        if (!rule.active) continue;
        if (!selectedRows.some((r) => r.id === rule.barberId)) continue;
        const dates = generateRecurrenceDates({
          startDate: rule.startDate,
          frequencyType: rule.frequencyType,
          endType: rule.endType,
          endDate: rule.endDate,
          maxOccurrences: rule.maxOccurrences,
          windowFrom: dateRange.start,
          windowTo: dateRange.end,
          excludedDates: rule.excludedDates,
        });
        for (const d of dates) {
          const key = `${rule.barberId}|${d}|${rule.startTime.slice(0, 5)}`;
          ruleByKey.set(key, rule.id);
          if (!existingKeys.has(key)) {
            existingKeys.add(key);
            syntheticSlots.push({
              id: `recurring-${rule.id}-${d}`,
              barber_id: rule.barberId,
              slot_date: d,
              start_time: `${rule.startTime.slice(0, 5)}:00`,
              end_time: `${rule.endTime.slice(0, 5)}:00`,
              status: "AVAILABLE",
              internal_note: rule.internalNote,
              created_at: rule.createdAt,
              updated_at: rule.createdAt,
              updated_by: rule.createdByUserId,
            });
          }
        }
      }

      const mergedSlotRows = [...slotRows, ...syntheticSlots];
      const nextSlots = mergedSlotRows
        .map((slot) => {
          const key = `${slot.barber_id}|${slot.slot_date}|${slot.start_time.slice(0, 5)}`;
          return {
            ...slot,
            barberName: (barberById.get(slot.barber_id)?.name ?? "Barbero") as Barber,
            occupied: appointments.some((appointment) => overlaps(slot, appointment)),
            recurringRuleId: ruleByKey.get(key) ?? null,
          };
        })
        .sort((a, b) =>
          `${a.slot_date}${a.start_time}`.localeCompare(`${b.slot_date}${b.start_time}`),
        );
      setSlots(nextSlots);
      setValidStarts(
        starts
          .map((start) => ({
            ...start,
            barberName: (barberById.get(start.barber_id)?.name ?? "Barbero") as Barber,
          }))
          .sort((a, b) => `${a.slot_date}${a.start_time}`.localeCompare(`${b.slot_date}${b.start_time}`)),
      );
    } catch (cause) {
      if (revision !== loadRevisionRef.current) return;
      setSlots([]);
      setValidStarts([]);
      setError(errorMessage(cause));
    } finally {
      if (revision === loadRevisionRef.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }

  useEffect(() => {
    void loadSlots();
    return () => { loadRevisionRef.current += 1; };
  }, [dateRange, selectedRows]);

  useEffect(() => {
    if (refreshCount > 0) void loadSlots();
  }, [refreshCount]);

  function selectPreset(next: ScheduleDatePreset) {
    setSpecificDate(
      next === "TOMORROW"
        ? addCalendarDays(businessToday, 1)
        : next === "SPECIFIC"
          ? specificDate || businessToday
          : businessToday,
    );
    setDatePreset(next);
  }

  function selectSpecificDate(next: string) {
    setSpecificDate(next && next >= businessToday ? next : businessToday);
    setDatePreset("SPECIFIC");
  }

  async function saveSlot(slot: ScheduleSlot, nextStatus: AvailabilitySlot["status"]) {
    if (!mayManageBarber(profile, slot.barber_id)) return;

    // FASE 6: Si el horario tiene turnos confirmados/pendientes y el usuario intenta bloquearlo,
    // mostrar el modal «Se encontraron turnos afectados» con las 3 opciones.
    if (slot.occupied) {
      const affected = allAppointments.filter((apt) => overlaps(slot, apt));
      if (affected.length > 0) {
        setBlockConflictModal({
          slot,
          affectedAppointments: affected,
          confirmCancelAll: false,
        });
        return;
      }
      setError("No se puede modificar un horario que ya tiene una reserva activa.");
      return;
    }

    // FASE 3 & 11: Si pertenece a una regla recurrente y se va a bloquear, ofrecer alcance
    if (slot.recurringRuleId && nextStatus === "UNAVAILABLE") {
      const rule = recurringRules.find((r) => r.id === slot.recurringRuleId);
      if (rule) {
        setRecurringScopeModal({
          slot,
          rule,
          scope: "SINGLE",
        });
        return;
      }
    }

    await executeDirectSlotSave(slot, nextStatus);
  }

  async function executeDirectSlotSave(slot: ScheduleSlot, nextStatus: AvailabilitySlot["status"]) {
    setSavingId(slot.id);
    setError("");
    setNotice("");
    try {
      if (slot.id.startsWith("recurring-") && slot.recurringRuleId) {
        await modifyRecurringAvailabilityRule(
          {
            ruleId: slot.recurringRuleId,
            scope: "SINGLE",
            targetDate: slot.slot_date,
            action: nextStatus === "UNAVAILABLE" ? "BLOCK" : "MODIFY",
          },
          staff,
        );
        await loadSlots();
        setNotice(`${slot.barberName} · ${slot.start_time.slice(0, 5)} actualizado.`);
        return;
      }

      const updated = await updateAvailabilitySlot({
        id: slot.id,
        barberId: slot.barber_id,
        status: nextStatus,
        internalNote: slot.internal_note,
      });
      setSlots((current) =>
        current.map((currentSlot) =>
          currentSlot.id === updated.id
            ? {
                ...updated,
                barberName: slot.barberName,
                occupied: slot.occupied,
                recurringRuleId: slot.recurringRuleId,
              }
            : currentSlot,
        ),
      );
      void loadSlots();
      setNotice(`${slot.barberName} · ${updated.start_time.slice(0, 5)} actualizado.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSavingId(null);
    }
  }

  async function handleConfirmRecurringScope() {
    if (!recurringScopeModal) return;
    const { slot, rule, scope } = recurringScopeModal;
    setSavingId(slot.id);
    setError("");
    setNotice("");
    try {
      await modifyRecurringAvailabilityRule(
        {
          ruleId: rule.id,
          scope,
          targetDate: slot.slot_date,
          action: scope === "ALL_FUTURE" ? "DEACTIVATE" : "BLOCK",
        },
        staff,
      );
      if (!slot.id.startsWith("recurring-") && scope === "SINGLE") {
        await updateAvailabilitySlot({
          id: slot.id,
          barberId: slot.barber_id,
          status: "UNAVAILABLE",
          internalNote: slot.internal_note,
        }).catch(() => null);
      }
      setRecurringScopeModal(null);
      await loadSlots();
      setNotice(
        scope === "SINGLE"
          ? `Se bloqueó la ocurrencia del ${slot.slot_date} (${slot.start_time.slice(0, 5)}) sin afectar el resto de la recurrencia.`
          : scope === "THIS_AND_FOLLOWING"
            ? `Se finalizó la disponibilidad recurrente desde el ${slot.slot_date} en adelante.`
            : "Se desactivó toda la serie futura de disponibilidad recurrente.",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSavingId(null);
    }
  }

  async function handleCancelSingleAffectedAppointment(aptId: string) {
    if (!blockConflictModal) return;
    setSavingId(aptId);
    try {
      await updateRealAppointmentStatus(aptId, "CANCELLED");
      const remaining = blockConflictModal.affectedAppointments.filter((a) => a.id !== aptId);
      if (remaining.length === 0) {
        const targetSlot = blockConflictModal.slot;
        setBlockConflictModal(null);
        await executeDirectSlotSave({ ...targetSlot, occupied: false }, "UNAVAILABLE");
        setNotice("Turno cancelado y horario bloqueado correctamente.");
      } else {
        setBlockConflictModal({
          ...blockConflictModal,
          affectedAppointments: remaining,
        });
        await loadSlots();
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSavingId(null);
    }
  }

  async function handleCancelAllAffectedAppointmentsAndBlock() {
    if (!blockConflictModal) return;
    const { slot, affectedAppointments } = blockConflictModal;
    setSavingId("cancel-all-block");
    try {
      for (const apt of affectedAppointments) {
        await updateRealAppointmentStatus(apt.id, "CANCELLED");
      }
      setBlockConflictModal(null);
      await executeDirectSlotSave({ ...slot, occupied: false }, "UNAVAILABLE");
      setNotice(
        `Se cancelaron ${affectedAppointments.length} turnos afectados y se bloqueó el horario ${slot.start_time.slice(0, 5)}.`,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSavingId(null);
    }
  }

  async function saveManualSlot() {
    if (!manualBarberId || !manualDate || !manualTime || !mayManageBarber(profile, manualBarberId)) return;
    if (manualChecking || manualError) return;

    if (manualFrequency !== "ONCE") {
      if (manualEndType === "UNTIL_DATE" && (!manualEndDate || manualEndDate < manualDate)) {
        setManualError("La fecha de finalización debe ser igual o posterior a la fecha de inicio.");
        return;
      }
      if (manualEndType === "AFTER_COUNT" && (!manualMaxOccurrences || manualMaxOccurrences < 1)) {
        setManualError("Indicá una cantidad válida de repeticiones (mínimo 1).");
        return;
      }
    }

    setSavingId("manual");
    setManualError("");
    setNotice("");
    try {
      const endTime = defaultSlotEndTime(manualTime);
      const barberName = barberById.get(manualBarberId)?.name ?? "Agenda";

      if (manualFrequency === "ONCE") {
        const created = await createAvailabilitySlots({
          barberId: manualBarberId,
          dates: [manualDate],
          startTime: manualTime,
          endTime,
        });
        setManualOpen(false);
        await loadSlots();
        setNotice(
          created.length > 0
            ? `${barberName} · disponibilidad guardada (${manualTime} a ${endTime}).`
            : "Ese intervalo ya estaba cubierto; no se creó un duplicado.",
        );
      } else {
        // FASE 3: Crear regla de disponibilidad recurrente y materializar ventana próxima
        await createRecurringAvailabilityRule(
          {
            barberId: manualBarberId,
            startDate: manualDate,
            startTime: manualTime,
            endTime,
            frequencyType: manualFrequency,
            endType: manualEndType,
            endDate: manualEndType === "UNTIL_DATE" ? manualEndDate : null,
            maxOccurrences: manualEndType === "AFTER_COUNT" ? manualMaxOccurrences : null,
          },
          staff,
        );

        const immediateDates = generateRecurrenceDates({
          startDate: manualDate,
          frequencyType: manualFrequency,
          endType: manualEndType,
          endDate: manualEndType === "UNTIL_DATE" ? manualEndDate : null,
          maxOccurrences: manualEndType === "AFTER_COUNT" ? manualMaxOccurrences : null,
          windowFrom: manualDate,
          windowTo: addCalendarDays(businessToday, 60),
        });

        if (immediateDates.length > 0) {
          await createAvailabilitySlots({
            barberId: manualBarberId,
            dates: immediateDates,
            startTime: manualTime,
            endTime,
          }).catch(() => null);
        }

        const freqLabel =
          RECURRENCE_FREQUENCY_OPTIONS.find((o) => o.value === manualFrequency)?.label ?? manualFrequency;
        setManualOpen(false);
        await loadSlots();
        setNotice(
          `${barberName} · disponibilidad recurrente configurada (${freqLabel.toLowerCase()}, ${manualTime} a ${endTime}).`,
        );
      }
    } catch (cause) {
      setManualError(errorMessage(cause, "add"));
    } finally {
      setSavingId(null);
    }
  }

  function openManualDialog(date: string, barberId?: string) {
    validationIdRef.current += 1;
    setManualError("");
    setManualChecking(false);
    setCheckingNotice(false);
    const startDate = date || specificDate || businessToday;
    setManualDate(startDate);
    setManualTime("10:00");
    setManualFrequency("ONCE");
    setManualEndType("NEVER");
    setManualEndDate(addCalendarDays(startDate, 30));
    setManualMaxOccurrences(4);
    const contextualBarberId = barberId ?? selectedRows[0]?.id;
    if (contextualBarberId && permittedRows.some((row) => row.id === contextualBarberId))
      setManualBarberId(contextualBarberId);
    setManualOpen(true);
  }

  const filteredSlots = useMemo(() => {
    if (statusFilter === "ALL") return slots;
    if (statusFilter === "AVAILABLE") return slots.filter((slot) => !slot.occupied && slot.status === "AVAILABLE");
    if (statusFilter === "UNAVAILABLE") return slots.filter((slot) => !slot.occupied && slot.status !== "AVAILABLE");
    if (statusFilter === "RESERVED") return slots.filter((slot) => slot.occupied);
    return slots;
  }, [slots, statusFilter]);

  const groupedSlots = useMemo(() => {
    const groups = new Map<string, ScheduleSlot[]>();
    filteredSlots.forEach((slot) =>
      groups.set(slot.slot_date, [...(groups.get(slot.slot_date) ?? []), slot]),
    );
    return [...groups.entries()];
  }, [filteredSlots]);

  return (
    <>
      {/* 1. Card unificada de Filtros y Estados de horarios */}
      <AdminFilterPanel ariaLabel="Filtros de horarios">
        {/* 1. Período */}
        <AdminFilterCell label="Período" htmlFor="schedule-date-preset">
          <select
            id="schedule-date-preset"
            value={datePreset}
            onChange={(event) => selectPreset(event.target.value as ScheduleDatePreset)}
          >
            {datePresets.map((preset) => (
              <option key={preset} value={preset}>
                {schedulePresetLabels[preset]}
              </option>
            ))}
          </select>
        </AdminFilterCell>

        {/* 2. Fecha */}
        <AdminFilterCell label="Fecha" htmlFor="schedule-specific-date">
          <input
            id="schedule-specific-date"
            type="date"
            min={businessToday}
            value={specificDate}
            onChange={(event) => selectSpecificDate(event.target.value)}
          />
        </AdminFilterCell>

        {/* 3. Barbero */}
        <AdminFilterCell label="Barbero" htmlFor="schedule-barber-filter">
          {isStaffOperator(profile.role) ? (
            <select
              id="schedule-barber-filter"
              value={barberFilter}
              onChange={(event) => setBarberFilter(event.target.value)}
            >
              {permittedBarbers.map((barber) => (
                <option key={barber} value={barber}>
                  {barber}
                </option>
              ))}
            </select>
          ) : (
            <output id="schedule-barber-filter">
              {permittedBarbers[0] ?? "Tu agenda"}
            </output>
          )}
        </AdminFilterCell>

        {/* 4. Estado */}
        <AdminFilterCell label="Estado" htmlFor="schedule-status-filter">
          <select
            id="schedule-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as ScheduleStatusFilter)}
          >
            <option value="ALL">Todos</option>
            <option value="AVAILABLE">Disponible</option>
            <option value="UNAVAILABLE">No disponible</option>
            <option value="RESERVED">Reservado</option>
          </select>
        </AdminFilterCell>
      </AdminFilterPanel>

      {/* 3. Avisos contextuales */}
      {notice && (
        <div role="status" className="p-3.5 rounded-xl border border-success/30 bg-success/10 text-success text-xs font-medium flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Check size={16} />
            <span>{notice}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-success hover:bg-success/20"
            aria-label="Cerrar aviso"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </Button>
        </div>
      )}
      {error && (
        <div role="alert" className="p-3.5 rounded-xl border border-destructive/40 bg-destructive/10 text-destructive text-xs font-medium flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <XCircle size={16} />
            <span>{error}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:bg-destructive/20"
            aria-label="Cerrar error"
            onClick={() => setError("")}
          >
            <X size={14} />
          </Button>
        </div>
      )}

      {/* 4. Lista de horarios */}
      <section className="admin-schedule-list" aria-label="Disponibilidad horaria">
        {loading && (
          <div className="v2-schedule-cards-container admin-schedule-cards-container p-8 text-center my-6">
            <Clock3 size={32} className="mx-auto text-muted-foreground/60 mb-2 animate-spin" />
            <p className="text-xs text-muted-foreground">Cargando horarios…</p>
          </div>
        )}
        {!loading && groupedSlots.length === 0 && (
          <>
            <AdminV2SectionToolbar
              dateLabel={formatAdminV2Date(specificDate)}
              actionLabel="+ Agregar horario"
              onAction={() => openManualDialog(specificDate, selectedRows[0]?.id)}
            />
            <div className="v2-schedule-cards-container admin-schedule-cards-container p-8 text-center my-6">
              <SlidersHorizontal size={32} className="mx-auto text-muted-foreground/60 mb-2" />
              <h2 className="text-sm font-semibold text-foreground">No hay horarios para estos filtros</h2>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">Podés agregar una disponibilidad en cualquier fecha futura de atención.</p>
            </div>
          </>
        )}
        {!loading &&
          groupedSlots.map(([date, dateSlots]) => (
            <section key={date} className="admin-schedule-date-group space-y-3 mb-6">
              <AdminV2SectionToolbar
                dateLabel={formatAdminV2Date(date)}
                actionLabel="+ Agregar horario"
                onAction={() => openManualDialog(date, dateSlots[0]?.barber_id)}
              />
              <div className="v2-schedule-cards-container admin-schedule-cards-container">
                <div className="v2-schedule-cards-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {dateSlots.map((slot) => {
                    const available = slot.status === "AVAILABLE";
                    const saving = savingId === slot.id;
                    const toneConfig = slot.occupied
                      ? {
                          border: "border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50",
                          statusTone: "text-amber-500",
                          label: "Reservado",
                          Icon: Clock3,
                        }
                      : available
                        ? {
                            border: "border-success/30 bg-success/5 hover:border-success/50 hover:bg-success/10",
                            statusTone: "text-success",
                            label: "Disponible",
                            Icon: CheckCircle2,
                          }
                        : {
                            border: "border-destructive/30 bg-destructive/5 hover:border-destructive/50",
                            statusTone: "text-destructive",
                            label: "No disponible",
                            Icon: XCircle,
                          };
                    return (
                      <button
                        type="button"
                        key={slot.id}
                        className={cn(
                          "min-h-[4.75rem] p-3 rounded-xl border flex flex-col justify-between text-left transition-all shadow-xs cursor-pointer",
                          toneConfig.border,
                        )}
                        disabled={saving}
                        aria-label={`${slot.start_time.slice(0, 5)}: ${slot.occupied ? "Reservado, tocar para gestionar bloqueo o turnos afectados" : available ? "Disponible, tocar para marcar no disponible" : "No disponible, tocar para habilitar"}`}
                        onClick={() => void saveSlot(slot, available ? "UNAVAILABLE" : "AVAILABLE")}
                      >
                        <div className="flex items-baseline justify-between w-full">
                          <strong className="text-lg font-bold text-foreground leading-none">
                            {slot.start_time.slice(0, 5)}
                          </strong>
                          <span className="text-[11px] text-muted-foreground">
                            hasta {slot.end_time.slice(0, 5)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between w-full gap-1">
                          <span className={cn("text-xs font-medium inline-flex items-center gap-1", toneConfig.statusTone)}>
                            <toneConfig.Icon size={12} />
                            {toneConfig.label}
                          </span>
                          {slot.recurringRuleId && (
                            <span
                              className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"
                              title="Horario recurrente"
                            >
                              <Repeat size={10} />
                              Recurrente
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          ))}
      </section>

      {/* Modal Agregar horario de disponibilidad (FASE 2 & FASE 3) */}
      <Dialog
        open={manualOpen}
        onOpenChange={(open) => {
          if (!open && savingId !== "manual") {
            validationIdRef.current += 1;
            setManualError("");
            setManualChecking(false);
            setCheckingNotice(false);
            setManualOpen(false);
          }
        }}
      >
        <DialogContent className="manual-dialog admin-schedule-dialog">
          <DialogTitle>Agregar horario de disponibilidad</DialogTitle>
          <DialogDescription className="sr-only">
            Agregar horario
          </DialogDescription>
          <div className="admin-schedule-manual-fields">
            {isStaffOperator(profile.role) && (
              <div>
                <label htmlFor="schedule-manual-barber">Agenda</label>
                <select
                  id="schedule-manual-barber"
                  className="select-control w-full"
                  value={manualBarberId}
                  onChange={(event) => setManualBarberId(event.target.value)}
                >
                  {permittedRows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="min-w-0">
              <label htmlFor="schedule-manual-date">Fecha</label>
              <Input
                id="schedule-manual-date"
                type="date"
                min={businessToday}
                value={manualDate}
                onChange={(event) => setManualDate(event.target.value)}
                className="select-control w-full min-w-0 max-w-full"
              />
            </div>
            <div>
              <label htmlFor="schedule-manual-time">Horario</label>
              <select
                id="schedule-manual-time"
                className="select-control w-full"
                value={manualTime}
                onChange={(event) => setManualTime(event.target.value)}
              >
                {SCHEDULE_TIME_OPTIONS.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="schedule-manual-frequency">Repetición</label>
              <select
                id="schedule-manual-frequency"
                className="select-control w-full"
                value={manualFrequency}
                onChange={(event) =>
                  setManualFrequency(event.target.value as RecurrenceFrequencyType)
                }
              >
                {RECURRENCE_FREQUENCY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {manualFrequency !== "ONCE" && (
              <>
                <div>
                  <label htmlFor="schedule-manual-end-type">Finalización de la recurrencia</label>
                  <select
                    id="schedule-manual-end-type"
                    className="select-control w-full"
                    value={manualEndType}
                    onChange={(event) =>
                      setManualEndType(event.target.value as RecurrenceEndType)
                    }
                  >
                    {RECURRENCE_END_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {manualEndType === "UNTIL_DATE" && (
                  <div className="min-w-0">
                    <label htmlFor="schedule-manual-end-date">Hasta la fecha</label>
                    <Input
                      id="schedule-manual-end-date"
                      type="date"
                      min={manualDate || businessToday}
                      value={manualEndDate}
                      onChange={(event) => setManualEndDate(event.target.value)}
                      className="select-control w-full min-w-0 max-w-full"
                    />
                  </div>
                )}

                {manualEndType === "AFTER_COUNT" && (
                  <div>
                    <label htmlFor="schedule-manual-max-occurrences">Cantidad de repeticiones</label>
                    <input
                      id="schedule-manual-max-occurrences"
                      type="number"
                      min={1}
                      max={365}
                      step={1}
                      value={manualMaxOccurrences}
                      onChange={(event) =>
                        setManualMaxOccurrences(Math.max(1, Number(event.target.value) || 1))
                      }
                      className="select-control w-full"
                    />
                  </div>
                )}
              </>
            )}
          </div>
          {manualError && (
            <div
              role="alert"
              className="p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-xs font-medium flex items-start gap-2 leading-relaxed"
            >
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>{manualError}</span>
            </div>
          )}
          {checkingNotice && !manualError && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock3 size={13} className="shrink-0 animate-spin" />
              <span>Verificando disponibilidad…</span>
            </p>
          )}
          <p className="manual-dialog-date text-xs text-muted-foreground">
            Se habilitará el tramo de 45 minutos ({manualTime} a {defaultSlotEndTime(manualTime)} hs). La fecha debe ser igual o posterior a {businessToday}.
          </p>
          <DialogFooter className="manual-dialog-footer">
            <Button
              variant="outline"
              disabled={savingId === "manual"}
              onClick={() => {
                validationIdRef.current += 1;
                setManualError("");
                setManualChecking(false);
                setCheckingNotice(false);
                setManualOpen(false);
              }}
            >
              Cancelar
            </Button>
            <Button
              className="action-positive"
              disabled={
                savingId === "manual" ||
                !manualBarberId ||
                manualChecking ||
                Boolean(manualError)
              }
              onClick={() => void saveManualSlot()}
            >
              {savingId === "manual" ? "Guardando…" : "Guardar horario"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FASE 6: Modal «Se encontraron turnos afectados» */}
      <Dialog
        open={Boolean(blockConflictModal)}
        onOpenChange={(open) => {
          if (!open && !savingId) setBlockConflictModal(null);
        }}
      >
        <DialogContent className="manual-dialog admin-schedule-dialog">
          <DialogTitle className="flex items-center gap-2 text-amber-500">
            <AlertTriangle size={18} />
            Se encontraron turnos afectados
          </DialogTitle>
          <DialogDescription>
            El horario {blockConflictModal?.slot.start_time.slice(0, 5)} del{" "}
            {blockConflictModal ? dateLabel(blockConflictModal.slot.slot_date) : ""} tiene turnos confirmados. Elegí cómo proceder antes de bloquear el horario:
          </DialogDescription>

          <div className="space-y-2 my-3 max-h-60 overflow-y-auto">
            {blockConflictModal?.affectedAppointments.map((apt) => (
              <div
                key={apt.id}
                className="p-3 rounded-lg border border-border bg-secondary/40 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">
                    {apt.name} · {apt.serviceName}
                  </p>
                  <p className="text-muted-foreground">
                    {dateLabel(apt.date)} · {apt.time} hs · {apt.barber} · {apt.status}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={Boolean(savingId)}
                  onClick={() => void handleCancelSingleAffectedAppointment(apt.id)}
                >
                  {savingId === apt.id ? "Cancelando…" : "Cancelar turno"}
                </Button>
              </div>
            ))}
          </div>

          {blockConflictModal?.confirmCancelAll ? (
            <div className="p-3 rounded-lg border border-destructive/40 bg-destructive/10 space-y-2 text-xs">
              <p className="font-medium text-destructive">
                ¿Confirmás cancelar todos los turnos afectados ({blockConflictModal.affectedAppointments.length}) y bloquear el horario?
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={Boolean(savingId)}
                  onClick={() =>
                    setBlockConflictModal((prev) =>
                      prev ? { ...prev, confirmCancelAll: false } : null,
                    )
                  }
                >
                  Volver
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={Boolean(savingId)}
                  onClick={() => void handleCancelAllAffectedAppointmentsAndBlock()}
                >
                  {savingId === "cancel-all-block"
                    ? "Cancelando…"
                    : "Sí, cancelar todos y bloquear"}
                </Button>
              </div>
            </div>
          ) : (
            <DialogFooter className="manual-dialog-footer flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                disabled={Boolean(savingId)}
                onClick={() => setBlockConflictModal(null)}
              >
                No bloquear el horario
              </Button>
              <Button
                variant="destructive"
                disabled={Boolean(savingId)}
                onClick={() =>
                  setBlockConflictModal((prev) =>
                    prev ? { ...prev, confirmCancelAll: true } : null,
                  )
                }
              >
                Cancelar todos los turnos afectados
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* FASE 3 & 11: Modal de alcance para modificar/bloquear disponibilidad recurrente */}
      <Dialog
        open={Boolean(recurringScopeModal)}
        onOpenChange={(open) => {
          if (!open && !savingId) setRecurringScopeModal(null);
        }}
      >
        <DialogContent className="manual-dialog admin-schedule-dialog">
          <DialogTitle>Modificar disponibilidad recurrente</DialogTitle>
          <DialogDescription>
            Este horario ({recurringScopeModal?.slot.start_time.slice(0, 5)} hs del{" "}
            {recurringScopeModal ? dateLabel(recurringScopeModal.slot.slot_date) : ""}) forma parte de una regla recurrente. Seleccioná el alcance del bloqueo:
          </DialogDescription>

          <div className="space-y-2 my-3">
            {RECURRENCE_SCOPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  "flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer text-xs transition-colors",
                  recurringScopeModal?.scope === opt.value
                    ? "border-primary bg-primary/10"
                    : "border-border bg-secondary/20",
                )}
              >
                <input
                  type="radio"
                  name="recurring-availability-scope"
                  value={opt.value}
                  checked={recurringScopeModal?.scope === opt.value}
                  onChange={() =>
                    setRecurringScopeModal((prev) =>
                      prev ? { ...prev, scope: opt.value } : null,
                    )
                  }
                  className="mt-0.5"
                />
                <div>
                  <strong className="block text-foreground">{opt.label}</strong>
                  <span className="text-muted-foreground">{opt.description}</span>
                </div>
              </label>
            ))}
          </div>

          <DialogFooter className="manual-dialog-footer">
            <Button
              variant="outline"
              disabled={Boolean(savingId)}
              onClick={() => setRecurringScopeModal(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={Boolean(savingId)}
              onClick={() => void handleConfirmRecurringScope()}
            >
              {savingId ? "Aplicando…" : "Confirmar bloqueo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
