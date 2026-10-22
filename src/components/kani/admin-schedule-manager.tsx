import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, Clock3, SlidersHorizontal, X, XCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
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
import { dateLabel, minutes, type Barber } from "@/lib/kani-model";
import {
  createAvailabilitySlots,
  FIXED_BOOKING_START_TIMES,
  readAvailabilityStartsForRange,
  readAvailabilitySlotsForRange,
  updateAvailabilitySlot,
  type AvailabilitySlot,
} from "@/lib/kani-availability";
import { readRealAppointments, type RealAppointment } from "@/lib/kani-appointments";
import { permittedBarberNames } from "@/lib/kani-role-scope";

const datePresets: ScheduleDatePreset[] = schedulePresets;
type ScheduleSlot = AvailabilitySlot & { barberName: Barber; occupied: boolean };
type ScheduleStart = Awaited<ReturnType<typeof readAvailabilityStartsForRange>>[number] & { barberName: Barber };

const SCHEDULE_TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const totalMinutes = index * 15;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
});

function defaultSlotEndTime(startTime: string): string {
  const [hours, minutes] = startTime.split(':').map(Number);
  if (hours >= 23) {
    return '23:59';
  }
  const nextHour = hours + 1;
  return `${String(nextHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function errorMessage(cause: unknown) {
  const error = cause as { code?: unknown; message?: unknown; details?: unknown } | null;
  const message = [
    cause instanceof Error ? cause.message : "",
    typeof error?.message === "string" ? error.message : "",
    typeof error?.details === "string" ? error.details : "",
    typeof error?.code === "string" ? error.code : "",
  ].join(" ");
  if (message.includes("AVAILABILITY_OVERLAP") || message.includes("AVAILABILITY_BLOCKED_START"))
    return "Ese inicio está dentro de un bloqueo existente.";
  if (message.includes("AVAILABILITY_APPOINTMENT_CONFLICT"))
    return "Ese horario se superpone con una reserva existente.";
  if (message.includes("AVAILABILITY_DATE_INVALID"))
    return "Elegí una fecha futura de atención; los domingos permanecen cerrados.";
  if (message.includes("START_TIME_INVALID") || message.includes("START_TIME_NOT_ALLOWED"))
    return "Elegí uno de los inicios comerciales fijos entre las 10:00 y las 19:00.";
  if (message.includes("END_TIME_INVALID") || message.includes("AVAILABILITY_INTERVAL_INVALID"))
    return "No se pudo calcular una ventana válida para ese inicio.";
  if (message.includes("BARBER_NOT_FOUND"))
    return "No se encontró el barbero seleccionado.";
  if (message.includes("DATE_REQUIRED"))
    return "Elegí al menos una fecha.";
  if (message.includes("AVAILABILITY_NOT_ALLOWED"))
    return "No tenés permiso para modificar esa agenda.";
  if (message.includes("AVAILABILITY_APPOINTMENT_CONFLICT"))
    return "Ese inicio coincide con una reserva existente.";
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
  const appointmentEnd = appointment.endTime ? minutes(appointment.endTime) : appointmentStart;
  return slotStart < appointmentEnd && appointmentStart < slotEnd;
}

export function AdminScheduleManager() {
  const { profile, barbers: permittedRows, refreshCount, setIsRefreshing } = useAdminStaff();
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
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [validStarts, setValidStarts] = useState<ScheduleStart[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDate, setManualDate] = useState(() => businessDateToday());
  const [manualBarberId, setManualBarberId] = useState(
    () => ownBarberId ?? permittedRows[0]?.id ?? "",
  );
  const [manualTime, setManualTime] = useState("10:00");

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

  async function loadSlots() {
    setLoading(true);
    setIsRefreshing(true);
    setError("");
    try {
      const [slotRows, starts, appointments] = await Promise.all([
        Promise.all(
          selectedRows.map((row) => readAvailabilitySlotsForRange(row.id, dateRange)),
        ).then((rows) => rows.flat()),
        Promise.all(
          selectedRows.map((row) => readAvailabilityStartsForRange(row.id, dateRange)),
        ).then((rows) => rows.flat()),
        readRealAppointments(),
      ]);
      const nextSlots = slotRows
        .map((slot) => ({
          ...slot,
          barberName: (barberById.get(slot.barber_id)?.name ?? "Barbero") as Barber,
          occupied: appointments.some((appointment) => overlaps(slot, appointment)),
        }))
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
      setSlots([]);
      setValidStarts([]);
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void loadSlots();
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
    if (slot.occupied) {
      setError("No se puede modificar un horario que ya tiene una reserva activa.");
      return;
    }
    setSavingId(slot.id);
    setError("");
    setNotice("");
    try {
      const updated = await updateAvailabilitySlot({
        id: slot.id,
        barberId: slot.barber_id,
        status: nextStatus,
        internalNote: slot.internal_note,
      });
      setSlots((current) =>
        current.map((currentSlot) =>
          currentSlot.id === updated.id
            ? { ...updated, barberName: slot.barberName, occupied: slot.occupied }
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

  async function saveManualSlot() {
    if (!manualBarberId || !manualDate || !manualTime) return;
    setSavingId("manual");
    setError("");
    setNotice("");
    try {
      const endTime = defaultSlotEndTime(manualTime);
      const created = await createAvailabilitySlots({
        barberId: manualBarberId,
        dates: [manualDate],
        startTime: manualTime,
        endTime,
      });
      setManualOpen(false);
      await loadSlots();
      const barberName = barberById.get(manualBarberId)?.name ?? "Agenda";
      setNotice(
        created.length > 0
          ? `${barberName} · disponibilidad guardada (${manualTime} a ${endTime}).`
          : "Ese intervalo ya estaba cubierto; no se creó un duplicado.",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSavingId(null);
    }
  }

  function openManualDialog(date: string, barberId?: string) {
    setManualDate(date || specificDate || businessToday);
    setManualTime("10:00");
    const contextualBarberId = barberId ?? selectedRows[0]?.id;
    if (contextualBarberId && permittedRows.some((row) => row.id === contextualBarberId))
      setManualBarberId(contextualBarberId);
    setManualOpen(true);
  }

  const groupedSlots = useMemo(() => {
    const groups = new Map<string, ScheduleSlot[]>();
    slots.forEach((slot) =>
      groups.set(slot.slot_date, [...(groups.get(slot.slot_date) ?? []), slot]),
    );
    return [...groups.entries()];
  }, [slots]);

  return (
    <main className="site-container admin-schedule-page">
      <div className="admin-schedule-shell">
        {/* 1. Card unificada de Filtros y Estados de horarios */}
        <section className="p-3.5 sm:p-4 rounded-xl border border-border bg-surface shadow-xs mb-6" aria-label="Filtros de horarios">
          <div className="admin-schedule-filter-grid">
            {/* 1. Período */}
            <div className="schedule-filter-periodo min-w-0">
              <label htmlFor="schedule-date-preset" className="block text-xs font-medium text-muted-foreground mb-1.5">
                Período
              </label>
              <select
                id="schedule-date-preset"
                value={datePreset}
                onChange={(event) => selectPreset(event.target.value as ScheduleDatePreset)}
                className="select-control w-full h-9 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 min-w-0 max-w-full"
              >
                {datePresets.map((preset) => (
                  <option key={preset} value={preset}>
                    {schedulePresetLabels[preset]}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Fecha */}
            <div className="schedule-filter-fecha min-w-0">
              <label htmlFor="schedule-specific-date" className="block text-xs font-medium text-muted-foreground mb-1.5">
                Fecha
              </label>
              <input
                id="schedule-specific-date"
                type="date"
                min={businessToday}
                value={specificDate}
                onChange={(event) => selectSpecificDate(event.target.value)}
                className="select-control w-full h-9 px-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 leading-normal text-left min-w-0 max-w-full"
              />
            </div>

            {/* 3. Barbero */}
            <div className="schedule-filter-barbero min-w-0">
              <label htmlFor="schedule-barber-filter" className="block text-xs font-medium text-muted-foreground mb-1.5">
                Barbero
              </label>
              {profile.role === "ADMIN" ? (
                <select
                  id="schedule-barber-filter"
                  value={barberFilter}
                  onChange={(event) => setBarberFilter(event.target.value)}
                  className="select-control w-full h-9 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                >
                  {permittedBarbers.map((barber) => (
                    <option key={barber} value={barber}>
                      {barber}
                    </option>
                  ))}
                </select>
              ) : (
                <output className="select-control w-full h-9 px-3 text-xs bg-muted/40 border border-border rounded-lg text-muted-foreground flex items-center cursor-not-allowed">
                  {permittedBarbers[0] ?? "Tu agenda"}
                </output>
              )}
            </div>

            {/* 4. Con reserva (Fila 2 Col 2 en Mobile / Fila 1 Col 6 en Desktop) */}
            <div className="schedule-filter-con-reserva min-w-0 flex flex-col justify-end">
              <span className="block text-xs font-medium text-transparent mb-1.5 select-none pointer-events-none" aria-hidden="true">&nbsp;</span>
              <div className="w-full h-9 px-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-500 font-medium text-xs flex items-center justify-center gap-1.5 whitespace-nowrap min-w-0">
                <Clock3 size={13} className="shrink-0" />
                <span className="truncate">Con reserva</span>
              </div>
            </div>

            {/* 5. Disponible (Fila 3 Col 1 en Mobile / Fila 1 Col 4 en Desktop) */}
            <div className="schedule-filter-disponible min-w-0 flex flex-col justify-end">
              <span className="block text-xs font-medium text-transparent mb-1.5 select-none pointer-events-none hidden sm:block" aria-hidden="true">&nbsp;</span>
              <div className="w-full h-9 px-2.5 rounded-lg border border-success/30 bg-success/5 text-success font-medium text-xs flex items-center justify-center gap-1.5 whitespace-nowrap min-w-0">
                <CheckCircle2 size={13} className="shrink-0" />
                <span className="truncate">Disponible</span>
              </div>
            </div>

            {/* 6. No disponible (Fila 3 Col 2 en Mobile / Fila 1 Col 5 en Desktop) */}
            <div className="schedule-filter-no-disponible min-w-0 flex flex-col justify-end">
              <span className="block text-xs font-medium text-transparent mb-1.5 select-none pointer-events-none hidden sm:block" aria-hidden="true">&nbsp;</span>
              <div className="w-full h-9 px-2.5 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive font-medium text-xs flex items-center justify-center gap-1.5 whitespace-nowrap min-w-0">
                <XCircle size={13} className="shrink-0" />
                <span className="truncate">No disponible</span>
              </div>
            </div>
          </div>
        </section>

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
            <div className="p-8 text-center border border-dashed border-border rounded-xl bg-surface/50 my-6">
              <Clock3 size={32} className="mx-auto text-muted-foreground/60 mb-2 animate-spin" />
              <p className="text-xs text-muted-foreground">Cargando horarios…</p>
            </div>
          )}
          {!loading && groupedSlots.length === 0 && (
            <>
              <div className="p-8 text-center border border-dashed border-border rounded-xl bg-surface/50 my-6">
                <SlidersHorizontal size={32} className="mx-auto text-muted-foreground/60 mb-2" />
                <h2 className="text-sm font-semibold text-foreground">No hay horarios para estos filtros</h2>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">Podés agregar una disponibilidad en cualquier fecha futura de atención.</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                <button
                  type="button"
                  className="min-h-[4.75rem] p-3 rounded-xl border border-dashed border-border bg-surface/50 hover:border-primary hover:bg-surface text-foreground font-medium text-xs flex items-center justify-center transition-all cursor-pointer shadow-xs"
                  aria-label="Agregar horario"
                  onClick={() => openManualDialog(specificDate, selectedRows[0]?.id)}
                >
                  <span className="font-semibold text-xs sm:text-sm">
                    Agregar horario
                  </span>
                </button>
              </div>
            </>
          )}
          {!loading &&
            groupedSlots.map(([date, dateSlots]) => (
              <section key={date} className="space-y-3 mb-6">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground px-1.5 py-0.5 rounded bg-muted">Fecha</span>
                    <h2 className="text-sm font-semibold text-foreground capitalize">{dateLabel(date)}</h2>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {dateSlots.length} {dateSlots.length === 1 ? "horario" : "horarios"}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {dateSlots.map((slot) => {
                    const available = slot.status === "AVAILABLE";
                    const saving = savingId === slot.id;
                    const toneConfig = slot.occupied
                      ? {
                          border: "border-amber-500/30 bg-amber-500/5",
                          statusTone: "text-amber-500",
                          label: "Con reserva",
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
                          "min-h-[4.75rem] p-3 rounded-xl border flex flex-col justify-between text-left transition-all shadow-xs",
                          toneConfig.border,
                          slot.occupied ? "cursor-default opacity-90" : "cursor-pointer"
                        )}
                        disabled={slot.occupied || saving}
                        aria-label={`${slot.start_time.slice(0, 5)}: ${slot.occupied ? "Con reserva, no modificable" : available ? "Disponible, tocar para marcar no disponible" : "No disponible, tocar para habilitar"}`}
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
                        <div className="mt-2 flex items-center justify-between w-full">
                          <span className={cn("text-xs font-medium inline-flex items-center gap-1", toneConfig.statusTone)}>
                            <toneConfig.Icon size={12} />
                            {toneConfig.label}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="min-h-[4.75rem] p-3 rounded-xl border border-dashed border-border bg-surface/50 hover:border-primary hover:bg-surface text-foreground font-medium text-xs flex items-center justify-center transition-all cursor-pointer shadow-xs"
                    aria-label={`Agregar horario para ${date}`}
                    onClick={() => openManualDialog(date, dateSlots[0]?.barber_id)}
                  >
                    <span className="font-semibold text-xs sm:text-sm">
                      Agregar horario
                    </span>
                  </button>
                </div>
              </section>
            ))}
        </section>
      </div>

      <Dialog
        open={manualOpen}
        onOpenChange={(open) => {
          if (!open && savingId !== "manual") setManualOpen(false);
        }}
      >
        <DialogContent className="manual-dialog admin-schedule-dialog">
          <DialogTitle>Agregar horario de disponibilidad</DialogTitle>
          <DialogDescription className="sr-only">
            Agregar horario
          </DialogDescription>
          <div className="admin-schedule-manual-fields">
            {profile.role === "ADMIN" && (
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
                className="min-w-0 max-w-full px-2"
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
          </div>
          <p className="manual-dialog-date text-xs text-muted-foreground">
            La fecha debe ser igual o posterior a {businessToday}. Los domingos permanecen cerrados.
          </p>
          <DialogFooter className="manual-dialog-footer">
            <Button
              variant="outline"
              disabled={savingId === "manual"}
              onClick={() => setManualOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              className="action-positive"
              disabled={savingId === "manual" || !manualBarberId}
              onClick={() => void saveManualSlot()}
            >
              Guardar horario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
