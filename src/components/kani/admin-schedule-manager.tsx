import { useEffect, useMemo, useState } from "react";
import { Check, CircleDot, Clock3, SlidersHorizontal, X, XCircle } from "lucide-react";
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
  const [manualStartTime, setManualStartTime] = useState("10:00");
  const [manualEndTime, setManualEndTime] = useState("20:00");

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
    if (!manualBarberId || !manualDate) return;
    if (manualEndTime && manualEndTime <= manualStartTime) {
      setError("La hora de fin debe ser posterior a la hora de inicio.");
      return;
    }
    setSavingId("manual");
    setError("");
    setNotice("");
    try {
      const created = await createAvailabilitySlots({
        barberId: manualBarberId,
        dates: [manualDate],
        startTime: manualStartTime,
        endTime: manualEndTime || null,
      });
      setManualOpen(false);
      await loadSlots();
      const barberName = barberById.get(manualBarberId)?.name ?? "Agenda";
      setNotice(
        created.length > 0
          ? `${barberName} · disponibilidad guardada (${manualStartTime} a ${manualEndTime || "1 hora después"}).`
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
    setManualStartTime("10:00");
    setManualEndTime("20:00");
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
        <section className="admin-schedule-filters" aria-label="Filtros de horarios">
          <div className="admin-schedule-control">
            <label htmlFor="schedule-date-preset">Período</label>
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
          </div>
          <div className="admin-schedule-control">
            <label htmlFor="schedule-specific-date">Fecha</label>
            <input
              id="schedule-specific-date"
              type="date"
              min={businessToday}
              value={specificDate}
              onChange={(event) => selectSpecificDate(event.target.value)}
            />
          </div>
          <div className="admin-schedule-control">
            <label htmlFor="schedule-barber-filter">Barbero</label>
            {profile.role === "ADMIN" ? (
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
              <output className="admin-schedule-filter-value">
                {permittedBarbers[0] ?? "Tu agenda"}
              </output>
            )}
          </div>
        </section>
        <div className="admin-schedule-legend" aria-label="Leyenda de horarios">
          <span>
            <CircleDot size={14} />
            Disponible
          </span>
          <span>
            <XCircle size={14} />
            No disponible
          </span>
          <span>
            <Clock3 size={14} />
            Con reserva
          </span>
        </div>
        {notice && (
          <div role="status" className="admin-mobile-notice">
            <Check size={16} />
            {notice}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Cerrar aviso"
              onClick={() => setNotice("")}
            >
              <X />
            </Button>
          </div>
        )}
        {error && (
          <div role="alert" className="admin-mobile-notice is-error">
            <XCircle size={16} />
            {error}
          </div>
        )}
        <section className="admin-schedule-list" aria-label="Disponibilidad horaria">
          {loading && (
            <div className="admin-mobile-empty">
              <Clock3 size={28} />
              <p>Cargando horarios…</p>
            </div>
          )}
          {!loading && groupedSlots.length === 0 && (
            <>
              <div className="admin-mobile-empty">
                <SlidersHorizontal size={28} />
                <h2>No hay horarios para estos filtros.</h2>
                <p>Podés agregar una disponibilidad en cualquier fecha futura de atención.</p>
              </div>
              <div className="admin-schedule-cards admin-schedule-cards-empty">
                <button
                  type="button"
                  className="admin-schedule-card admin-schedule-capsule admin-schedule-add is-add-slot"
                  aria-label="Agregar horario"
                  onClick={() => openManualDialog(specificDate, selectedRows[0]?.id)}
                >
                  <span className="admin-schedule-add-label font-semibold text-sm">
                    Agregar horario
                  </span>
                </button>
              </div>
            </>
          )}
          {!loading &&
            groupedSlots.map(([date, dateSlots]) => (
              <section key={date} className="admin-schedule-day">
                <div className="admin-schedule-day-heading">
                  <div>
                    <span className="eyebrow">FECHA</span>
                    <h2>{dateLabel(date)}</h2>
                  </div>
                  <span>
                    {dateSlots.length} {dateSlots.length === 1 ? "horario" : "horarios"}
                  </span>
                </div>
                <div className="admin-schedule-cards">
                  {dateSlots.map((slot) => {
                    const available = slot.status === "AVAILABLE";
                    const saving = savingId === slot.id;
                    const slotTone = slot.occupied
                      ? "occupied"
                      : available
                        ? "available"
                        : "unavailable";
                    return (
                      <button
                        type="button"
                        key={slot.id}
                        className={`admin-schedule-card admin-schedule-capsule is-${slotTone}`}
                        disabled={slot.occupied || saving}
                        aria-label={`${slot.start_time.slice(0, 5)}: ${slot.occupied ? "Con reserva, no modificable" : available ? "Disponible, tocar para marcar no disponible" : "No disponible, tocar para habilitar"}`}
                        onClick={() => void saveSlot(slot, available ? "UNAVAILABLE" : "AVAILABLE")}
                      >
                        <div className="admin-schedule-card-top">
                          <div className="admin-schedule-time">
                            <strong>{slot.start_time.slice(0, 5)}</strong>
                            <span>hasta {slot.end_time.slice(0, 5)}</span>
                          </div>
                          <span className={`admin-schedule-status ${slotTone}`}>
                            {slot.occupied ? (
                              <Clock3 size={14} />
                            ) : available ? (
                              <CircleDot size={14} />
                            ) : (
                              <XCircle size={14} />
                            )}
                            {slot.occupied
                              ? "Con reserva"
                              : available
                                ? "Disponible"
                                : "No disponible"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="admin-schedule-card admin-schedule-capsule admin-schedule-add is-add-slot"
                    aria-label={`Agregar horario para ${date}`}
                    onClick={() => openManualDialog(date, dateSlots[0]?.barber_id)}
                  >
                    <span className="admin-schedule-add-label font-semibold text-sm">
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
          <DialogDescription>
            Configurá un intervalo de disponibilidad para el barbero seleccionado, desde las 00:00 hasta las 23:59.
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
            <div>
              <label htmlFor="schedule-manual-date">Fecha</label>
              <Input
                id="schedule-manual-date"
                type="date"
                min={businessToday}
                value={manualDate}
                onChange={(event) => setManualDate(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="schedule-manual-start">Hora de inicio</label>
                <Input
                  id="schedule-manual-start"
                  type="time"
                  step="300"
                  min="00:00"
                  max="23:59"
                  value={manualStartTime}
                  onChange={(event) => setManualStartTime(event.target.value)}
                  className="w-full text-xs bg-background"
                />
              </div>
              <div>
                <label htmlFor="schedule-manual-end">Hora de fin</label>
                <Input
                  id="schedule-manual-end"
                  type="time"
                  step="60"
                  min="00:01"
                  max="23:59"
                  value={manualEndTime}
                  onChange={(event) => setManualEndTime(event.target.value)}
                  className="w-full text-xs bg-background"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="text-[11px] text-muted-foreground w-full">Atajos rápidos:</span>
              <button
                type="button"
                className="text-[11px] px-2 py-0.5 rounded border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                onClick={() => {
                  setManualStartTime("00:00");
                  setManualEndTime("23:59");
                }}
              >
                Día completo (00:00 a 23:59)
              </button>
              <button
                type="button"
                className="text-[11px] px-2 py-0.5 rounded border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                onClick={() => {
                  setManualStartTime("10:00");
                  setManualEndTime("20:00");
                }}
              >
                Comercial estándar (10:00 a 20:00)
              </button>
              <button
                type="button"
                className="text-[11px] px-2 py-0.5 rounded border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                onClick={() => {
                  setManualStartTime("20:00");
                  setManualEndTime("23:59");
                }}
              >
                Noche extendida (20:00 a 23:59)
              </button>
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
