import { useState, useId, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAdminStaff } from "@/lib/kani-admin-context";
import {
  appointmentErrorMessage,
  computeAvailableManualSlots,
  createManualAppointment,
  filterSlotsByPeriod,
  minutesToTime,
  PERIOD_LABELS,
  timeToMinutes,
  updateManualAppointment,
  type PeriodFilter,
  type RealAppointment,
} from "@/lib/kani-appointments";
import { dateLabel } from "@/lib/kani-model";
import { useV2, type V2Client } from "./data";
import { Check, Clock3, Sparkles } from "lucide-react";

export type ManualAppointmentDialogProps = {
  open: boolean;
  mode: "CREATE" | "EDIT";
  appointment?: RealAppointment | null;
  initialDate: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
};

export function ManualAppointmentDialog({
  open,
  mode,
  appointment,
  initialDate,
  onClose,
  onSuccess,
}: ManualAppointmentDialogProps) {
  if (!open) return null;

  const data = useV2();
  const staff = useAdminStaff();
  const isAdmin = staff?.profile?.role === "ADMIN";
  const titleId = useId();
  const descId = useId();

  const servicesList = data?.services || [];
  const clientsList = data?.clients || [];
  const appointmentsList = data?.appointments || [];
  const barbersList = staff?.barbers || [];

  // Find active barbers
  const availableBarbers = useMemo(() => {
    return barbersList.filter(
      (b) => isAdmin || b.id === staff?.profile?.barber_id
    );
  }, [barbersList, isAdmin, staff?.profile?.barber_id]);

  // Form states
  const [barberId, setBarberId] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [date, setDate] = useState<string>(initialDate);
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [clientName, setClientName] = useState<string>("");
  const [clientPhone, setClientPhone] = useState<string>("");
  const [clientEmail, setClientEmail] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("COMERCIAL");
  const [clientSearch, setClientSearch] = useState<string>("");
  const [showClientSuggestions, setShowClientSuggestions] = useState<boolean>(false);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [formError, setFormError] = useState<string>("");

  // Initialize or reset form when dialog opens or changes mode
  useEffect(() => {
    if (!open) {
      setFormError("");
      setIsBusy(false);
      setClientSearch("");
      setShowClientSuggestions(false);
      return;
    }

    if (mode === "EDIT" && appointment) {
      setBarberId(appointment.barberId);
      setServiceId(appointment.serviceId);
      setDate(appointment.date);
      setSelectedTime(appointment.time);
      setClientName(appointment.name);
      setClientPhone(appointment.phone || "");
      setClientEmail(
        appointment.email?.includes("@cliente.kanibarber.internal")
          ? ""
          : appointment.email || ""
      );
      setNotes(appointment.notes || "");
    } else {
      // Default barber for CREATE
      const defaultBarber = isAdmin
        ? data?.barberId !== "ALL"
          ? data?.barberId || ""
          : availableBarbers[0]?.id || ""
        : staff?.profile?.barber_id || "";
      setBarberId(defaultBarber);

      // Default service
      const defaultService =
        servicesList[0]?.dbId || servicesList[0]?.id || "";
      setServiceId(defaultService);

      setDate(initialDate);
      setSelectedTime("");
      setClientName("");
      setClientPhone("");
      setClientEmail("");
      setNotes("");
    }
  }, [open, mode, appointment, initialDate, isAdmin, data?.barberId, availableBarbers, staff?.profile?.barber_id, servicesList]);

  // Resolve current service duration
  const activeService = useMemo(() => {
    return (
      servicesList.find(
        (s) => (s.dbId && s.dbId === serviceId) || s.id === serviceId
      ) || servicesList[0]
    );
  }, [servicesList, serviceId]);

  const durationMinutes = activeService?.duration || 45;

  // Compute available 15-minute slot capsules
  const allSlots = useMemo(() => {
    if (!barberId || !date) return [];
    return computeAvailableManualSlots({
      appointments: appointmentsList,
      barberId,
      date,
      durationMinutes,
      excludeAppointmentId: mode === "EDIT" ? appointment?.id : undefined,
    });
  }, [appointmentsList, barberId, date, durationMinutes, mode, appointment?.id]);

  // Filter slots for the chosen period
  const visibleSlots = useMemo(() => {
    return filterSlotsByPeriod(allSlots, periodFilter);
  }, [allSlots, periodFilter]);

  // Selected time end calculation
  const computedEndTime = useMemo(() => {
    if (!selectedTime) return "";
    const startM = timeToMinutes(selectedTime);
    return minutesToTime(startM + durationMinutes);
  }, [selectedTime, durationMinutes]);

  // Filtered client suggestions
  const suggestedClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return clientsList
      .filter((c) => {
        const nameMatch = c.name?.toLowerCase().includes(q);
        const phoneMatch = c.phone?.replace(/\D/g, "").includes(q.replace(/\D/g, ""));
        const emailMatch = c.email?.toLowerCase().includes(q);
        return nameMatch || phoneMatch || emailMatch;
      })
      .slice(0, 5);
  }, [clientSearch, clientsList]);

  function handleSelectClient(c: V2Client) {
    setClientName(c.name || "");
    setClientPhone(c.phone || "");
    setClientEmail(
      c.email?.includes("@cliente.kanibarber.internal") ? "" : c.email || ""
    );
    setClientSearch("");
    setShowClientSuggestions(false);
  }

  // Selected barber name for summary
  const selectedBarberName = useMemo(() => {
    return availableBarbers.find((b) => b.id === barberId)?.name || "Barbero";
  }, [availableBarbers, barberId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    if (!barberId) {
      setFormError("Tenés que seleccionar un barbero.");
      return;
    }
    if (!serviceId) {
      setFormError("Tenés que seleccionar un servicio.");
      return;
    }
    if (!date) {
      setFormError("Tenés que indicar una fecha.");
      return;
    }
    if (!selectedTime) {
      setFormError("Tenés que seleccionar un horario para el turno.");
      return;
    }
    const cleanName = clientName.trim();
    if (!cleanName || cleanName.length < 3) {
      setFormError("El nombre del cliente debe tener al menos 3 caracteres.");
      return;
    }
    const cleanPhone = clientPhone.trim();
    if (!cleanPhone || cleanPhone.length < 6) {
      setFormError("El celular del cliente debe ser válido.");
      return;
    }

    // Verify chosen slot is not occupied in current local list
    const chosenSlot = allSlots.find((s) => s.time === selectedTime);
    if (chosenSlot && !chosenSlot.available) {
      setFormError("Ese horario acaba de ocuparse. Elegí otro horario disponible.");
      return;
    }

    // Resolve service DB UUID
    const targetServiceUuid = activeService?.dbId || serviceId;

    setIsBusy(true);
    try {
      if (mode === "EDIT" && appointment) {
        await updateManualAppointment({
          appointmentId: appointment.id,
          barberId,
          serviceId: targetServiceUuid,
          date,
          time: selectedTime,
          name: cleanName,
          phone: cleanPhone,
          email: clientEmail.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        await data.refresh();
        onSuccess("Turno manual actualizado exitosamente.");
        onClose();
      } else {
        await createManualAppointment({
          barberId,
          serviceId: targetServiceUuid,
          date,
          time: selectedTime,
          name: cleanName,
          phone: cleanPhone,
          email: clientEmail.trim() || undefined,
          notes: notes.trim() || undefined,
          durationMinutes,
        });
        await data.refresh();
        onSuccess("Turno manual creado exitosamente.");
        onClose();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("SLOT_ALREADY_BOOKED") || msg.includes("Ese horario acaba de ocuparse")) {
        setFormError("Ese horario acaba de ocuparse. Elegí otro horario disponible.");
        // Refresh background slots immediately on race condition
        void data.refresh();
      } else {
        setFormError(appointmentErrorMessage(err));
      }
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !isBusy && onClose()}>
      <DialogContent
        className="v2-dialog v2-manual-dialog"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <DialogTitle id={titleId}>
          {mode === "CREATE" ? "Agregar turno manual" : "Editar turno manual"}
        </DialogTitle>
        <DialogDescription id={descId}>
          {mode === "CREATE"
            ? "Cargá directamente el turno en la agenda sin pasar por pasarelas de pago ni requerir seña."
            : "Modificá los datos del turno manual respetando la agenda del barbero."}
        </DialogDescription>

        {formError && (
          <p className="v2-alert" role="alert">
            {formError}
          </p>
        )}

        <form onSubmit={handleSubmit} className="v2-manual-form">
          {/* Barber Selection: only selectable by ADMIN */}
          <div className="v2-manual-row">
            {isAdmin ? (
              <label className="v2-field">
                Barbero
                <select
                  value={barberId}
                  disabled={isBusy || (mode === "EDIT" && !isAdmin)}
                  onChange={(e) => {
                    setBarberId(e.target.value);
                    setSelectedTime("");
                  }}
                >
                  {availableBarbers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="v2-field">
                <span className="v2-field-label">Barbero</span>
                <div className="v2-readonly-box">
                  <strong>{selectedBarberName}</strong>
                </div>
              </div>
            )}

            {/* Service Selection */}
            <label className="v2-field">
              Servicio
              <select
                value={serviceId}
                disabled={isBusy}
                onChange={(e) => {
                  setServiceId(e.target.value);
                  setSelectedTime("");
                }}
              >
                {servicesList.map((s) => (
                  <option key={s.dbId || s.id} value={s.dbId || s.id}>
                    {s.name} ({s.duration} min)
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Date Picker */}
          <div className="v2-manual-row">
            <label className="v2-field">
              Fecha
              <input
                type="date"
                value={date}
                disabled={isBusy}
                onChange={(e) => {
                  setDate(e.target.value);
                  setSelectedTime("");
                }}
              />
            </label>

            <div className="v2-field">
              <span className="v2-field-label">Duración estimada</span>
              <div className="v2-readonly-box">
                <Clock3 size={15} />
                <span>{durationMinutes} minutos</span>
              </div>
            </div>
          </div>

          {/* Time Capsules Section */}
          <div className="v2-manual-time-section">
            <div className="v2-manual-time-header">
              <span className="v2-field-label">
                Horario disponible ({durationMinutes} min)
              </span>
              {selectedTime && (
                <span className="v2-selected-time-badge">
                  Seleccionado: <strong>{selectedTime} → {computedEndTime}</strong>
                </span>
              )}
            </div>

            {/* Period Pills Filter */}
            <div className="v2-period-pills" role="tablist" aria-label="Filtrar horarios por período">
              {(Object.keys(PERIOD_LABELS) as PeriodFilter[]).map((pKey) => (
                <button
                  key={pKey}
                  type="button"
                  role="tab"
                  aria-selected={periodFilter === pKey}
                  className={`v2-period-pill ${periodFilter === pKey ? "active" : ""}`}
                  onClick={() => setPeriodFilter(pKey)}
                >
                  {PERIOD_LABELS[pKey]}
                </button>
              ))}
            </div>

            {/* Capsules Grid */}
            <div className="v2-capsules-container">
              {visibleSlots.length === 0 ? (
                <p className="v2-no-slots">
                  No hay horarios generados en este rango.
                </p>
              ) : (
                <div className="v2-capsules-grid">
                  {visibleSlots.map((slot) => {
                    const isSelected = selectedTime === slot.time;
                    return (
                      <button
                        key={slot.time}
                        type="button"
                        disabled={!slot.available || isBusy}
                        className={`v2-capsule-btn ${
                          isSelected ? "selected" : slot.available ? "available" : "unavailable"
                        }`}
                        title={
                          slot.available
                            ? `Disponible: ${slot.time} a ${slot.endTime}`
                            : `Ocupado por otro turno`
                        }
                        onClick={() => setSelectedTime(slot.time)}
                      >
                        <span className="v2-capsule-time">{slot.time}</span>
                        {slot.available ? (
                          isSelected ? (
                            <Check size={12} className="v2-capsule-icon" />
                          ) : null
                        ) : (
                          <span className="v2-capsule-busy-label">Ocupado</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Client Details Section */}
          <div className="v2-manual-client-section">
            <div className="v2-manual-client-header">
              <span className="v2-section-subtitle">Datos del cliente</span>
              {/* Quick Search for Existing Clients */}
              <div className="v2-client-quick-search">
                <input
                  type="text"
                  placeholder="Buscar cliente existente..."
                  value={clientSearch}
                  disabled={isBusy}
                  onChange={(e) => {
                    setClientSearch(e.target.value);
                    setShowClientSuggestions(true);
                  }}
                  onFocus={() => setShowClientSuggestions(true)}
                />
                {showClientSuggestions && suggestedClients.length > 0 && (
                  <ul className="v2-client-suggestions-list">
                    {suggestedClients.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => handleSelectClient(c)}
                        >
                          <strong>{c.name}</strong>
                          <small>{c.phone} {c.email ? `· ${c.email}` : ""}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="v2-manual-row">
              <label className="v2-field">
                Nombre del cliente *
                <input
                  type="text"
                  required
                  placeholder="Ej. Lucas Fernández"
                  value={clientName}
                  disabled={isBusy}
                  onChange={(e) => setClientName(e.target.value)}
                />
              </label>

              <label className="v2-field">
                Celular / WhatsApp *
                <input
                  type="tel"
                  required
                  placeholder="Ej. 11 2345 6789"
                  value={clientPhone}
                  disabled={isBusy}
                  onChange={(e) => setClientPhone(e.target.value)}
                />
              </label>
            </div>

            <div className="v2-manual-row">
              <label className="v2-field">
                Email (opcional)
                <input
                  type="email"
                  placeholder="cliente@ejemplo.com"
                  value={clientEmail}
                  disabled={isBusy}
                  onChange={(e) => setClientEmail(e.target.value)}
                />
              </label>

              <label className="v2-field">
                Notas / Observación (opcional)
                <input
                  type="text"
                  placeholder="Ej. Cliente de WhatsApp, corte clásico"
                  value={notes}
                  disabled={isBusy}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </div>
          </div>

          {/* Summary Box */}
          <div className="v2-manual-summary">
            <div className="v2-summary-header">
              <Sparkles size={16} />
              <strong>Resumen del turno</strong>
            </div>
            <div className="v2-summary-grid">
              <div>
                <span className="v2-summary-label">Cliente:</span>{" "}
                <span>{clientName || "—"} {clientPhone ? `(${clientPhone})` : ""}</span>
              </div>
              <div>
                <span className="v2-summary-label">Servicio:</span>{" "}
                <span>{activeService?.name || "—"} ({durationMinutes} min)</span>
              </div>
              <div>
                <span className="v2-summary-label">Barbero:</span>{" "}
                <span>{selectedBarberName}</span>
              </div>
              <div>
                <span className="v2-summary-label">Fecha y hora:</span>{" "}
                <span>
                  {dateLabel(date)} · {selectedTime ? `${selectedTime} a ${computedEndTime} hs` : "Sin horario"}
                </span>
              </div>
            </div>
            <p className="v2-manual-notice">
              Este turno se incorpora directamente a la agenda sin cobro de seña.
            </p>
          </div>

          {/* Action CTAs */}
          <div className="v2-dialog-actions v2-manual-actions">
            <button
              type="button"
              className="v2-secondary"
              disabled={isBusy}
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="v2-primary"
              disabled={isBusy || !selectedTime || !clientName.trim() || !clientPhone.trim()}
            >
              {isBusy
                ? "Guardando…"
                : mode === "CREATE"
                ? "Crear turno"
                : "Guardar cambios"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
