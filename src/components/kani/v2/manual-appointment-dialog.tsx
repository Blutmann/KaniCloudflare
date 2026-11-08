import { isStaffOperator } from "@/lib/kani-permissions";
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
  createManualAppointment,
  minutesToTime,
  timeToMinutes,
  updateManualAppointment,
  type RealAppointment,
} from "@/lib/kani-appointments";
import { useV2, type V2Client } from "./data";
import { AlertTriangle, CheckCircle2, Repeat, Search } from "lucide-react";
import { dateLabel, formatServiceName, getEffectiveServicePrice, money } from "@/lib/kani-model";
import { addCalendarDays } from "@/lib/kani-mobile-appointments";
import {
  createRecurringManualSeries,
  modifyRecurringAppointmentSeries,
  RECURRENCE_END_OPTIONS,
  RECURRENCE_FREQUENCY_OPTIONS,
  RECURRENCE_SCOPE_OPTIONS,
  type CreateRecurringManualSeriesResult,
  type RecurrenceEndType,
  type RecurrenceFrequencyType,
  type RecurrenceScopeType,
  type RecurringPricingMode,
} from "@/lib/kani-recurrences-memberships";
import { sendRecurringSeriesGroupedEmailServerFn } from "@/lib/kani-recurring-notifications";

export type ManualAppointmentDialogProps = {
  open: boolean;
  mode: "CREATE" | "EDIT";
  appointment?: RealAppointment | null;
  initialDate: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onViewCreatedSeries?: (firstDate?: string) => void;
};

const TIME_15_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor((i * 15) / 60);
  const m = (i * 15) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

export function ManualAppointmentDialog({
  open,
  mode,
  appointment,
  initialDate,
  onClose,
  onSuccess,
  onViewCreatedSeries,
}: ManualAppointmentDialogProps) {
  if (!open) return null;

  const data = useV2();
  const { staff } = useAdminStaff();
  const isAdmin = isStaffOperator(staff?.profile?.role ?? "");
  const titleId = useId();
  const descId = useId();

  const servicesList = data?.services || [];
  const clientsList = data?.clients || [];
  const appointmentsList = data?.appointments || [];
  const membershipsList = data?.memberships || [];
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
  const [customServiceName, setCustomServiceName] = useState<string>("");
  const [customPrice, setCustomPrice] = useState<number | "">("");
  const [servicePrice, setServicePrice] = useState<number>(25000);
  const [startTime, setStartTime] = useState<string>("10:00");
  const [customEndTime, setCustomEndTime] = useState<string>("10:45");
  const [date, setDate] = useState<string>(initialDate);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string>("");
  const [clientPhone, setClientPhone] = useState<string>("");
  const [clientEmail, setClientEmail] = useState<string>("");

  // Recurrence & Membership states (FASE 4, 5, 7, 11, 12)
  const [frequency, setFrequency] = useState<RecurrenceFrequencyType>("ONCE");
  const [endType, setEndType] = useState<RecurrenceEndType>("NEVER");
  const [endDate, setEndDate] = useState<string>(() => addCalendarDays(initialDate, 60));
  const [maxOccurrences, setMaxOccurrences] = useState<number>(4);
  const [pricingMode, setPricingMode] = useState<RecurringPricingMode>("CURRENT_RATE");
  const [selectedMembershipId, setSelectedMembershipId] = useState<string>("");
  const [editScope, setEditScope] = useState<RecurrenceScopeType>("SINGLE");
  const [seriesSummaryModal, setSeriesSummaryModal] = useState<CreateRecurringManualSeriesResult | null>(null);

  const [clientSearch, setClientSearch] = useState<string>("");
  const [showClientSuggestions, setShowClientSuggestions] = useState<boolean>(false);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [formError, setFormError] = useState<string>("");

  const isOtro = serviceId === "OTRO";

  // Resolve current catalog service
  const activeService = useMemo(() => {
    if (isOtro) return null;
    return (
      servicesList.find(
        (s) => (s.dbId && s.dbId === serviceId) || s.id === serviceId
      ) || servicesList[0] || null
    );
  }, [servicesList, serviceId, isOtro]);

  // Membresías activas del cliente seleccionado con sesiones disponibles (FASE 7)
  const clientActiveMemberships = useMemo(() => {
    if (!selectedClientId) return [];
    return membershipsList.filter(
      (m) =>
        m.clientId === selectedClientId &&
        m.status === "ACTIVE" &&
        m.remainingSessions > 0,
    );
  }, [membershipsList, selectedClientId]);

  // Duration in minutes (allowing midnight crossing)
  const durationMinutes = useMemo(() => {
    const startM = timeToMinutes(startTime);
    const endM = timeToMinutes(customEndTime);
    if (endM <= startM) {
      return (endM + 1440) - startM;
    }
    return endM - startM;
  }, [startTime, customEndTime]);

  // Overlap and boundary conflict detection (only blocks single appointments; recurring series use partial creation FASE 5)
  const overlapConflict = useMemo(() => {
    if (!date || !barberId || !startTime || !customEndTime) return null;
    if (customEndTime === startTime) {
      return "La hora de finalización debe ser distinta a la de inicio.";
    }
    if (mode === "CREATE" && frequency !== "ONCE") {
      return null;
    }

    const startM = timeToMinutes(startTime);
    const endM = timeToMinutes(customEndTime);
    const durM = endM <= startM ? (endM + 1440) - startM : endM - startM;

    const candStartTs = new Date(`${date}T${startTime}:00`).getTime();
    const candEndTs = candStartTs + durM * 60 * 1000;

    const conflict = appointmentsList.find((apt) => {
      if (apt.statusCode === "CANCELLED") return false;
      if (apt.barberId !== barberId) return false;
      if (mode === "EDIT" && appointment?.id && apt.id === appointment.id) return false;

      const aptStartM = timeToMinutes(apt.time);
      const aptEndM = apt.endTime
        ? timeToMinutes(apt.endTime)
        : aptStartM + (apt.serviceDuration || 45);
      const aptDurM = aptEndM <= aptStartM ? (aptEndM + 1440) - aptStartM : aptEndM - aptStartM;
      const aptStartTs = new Date(`${apt.date}T${apt.time}:00`).getTime();
      const aptEndTs = aptStartTs + aptDurM * 60 * 1000;

      return candStartTs < aptEndTs && aptStartTs < candEndTs;
    });

    if (conflict) {
      const conflictEnd =
        conflict.endTime ||
        minutesToTime(timeToMinutes(conflict.time) + (conflict.serviceDuration || 45));
      return `El barbero ya tiene un turno reservado entre las ${conflict.time} y las ${conflictEnd}.`;
    }
    return null;
  }, [
    date,
    barberId,
    startTime,
    customEndTime,
    appointmentsList,
    mode,
    appointment?.id,
    frequency,
  ]);

  // Initialize or reset form when dialog opens or changes mode
  useEffect(() => {
    if (!open) {
      setFormError("");
      setIsBusy(false);
      setClientSearch("");
      setShowClientSuggestions(false);
      setSelectedClientId(null);
      setSeriesSummaryModal(null);
      return;
    }

    if (mode === "EDIT" && appointment) {
      setBarberId(appointment.barberId);
      const isAptOtro = !appointment.serviceId || Boolean(appointment.customServiceName);
      if (isAptOtro) {
        setServiceId("OTRO");
        setCustomServiceName(appointment.customServiceName || appointment.serviceName || "");
        setCustomPrice(appointment.servicePrice ?? "");
        setStartTime(appointment.time);
        setCustomEndTime(
          appointment.endTime ||
            minutesToTime((timeToMinutes(appointment.time) + (appointment.serviceDuration || 45)) % 1440)
        );
      } else {
        setServiceId(appointment.serviceId || "");
        setCustomServiceName("");
        setCustomPrice("");
        setServicePrice(appointment.servicePrice ?? 25000);
        setStartTime(appointment.time);
        setCustomEndTime(
          appointment.endTime ||
            minutesToTime((timeToMinutes(appointment.time) + (appointment.serviceDuration || 45)) % 1440)
        );
      }
      setDate(appointment.date);
      setSelectedClientId(appointment.clientId || null);
      setClientName(appointment.name);
      setClientPhone(appointment.phone || "");
      setClientEmail(
        appointment.email?.includes("@cliente.kanibarber.internal")
          ? ""
          : appointment.email || ""
      );
      setPricingMode(appointment.pricingMode || "CURRENT_RATE");
      setSelectedMembershipId(appointment.membershipId || "");
      setEditScope("SINGLE");
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
      setCustomServiceName("");
      setCustomPrice("");
      const selectedB = barbersList.find((b) => b.id === defaultBarber);
      setServicePrice(getEffectiveServicePrice(servicesList[0]?.name || "Corte", selectedB?.name));
      setStartTime("10:00");
      setCustomEndTime("10:45");
      setDate(initialDate);
      setSelectedClientId(null);
      setClientName("");
      setClientPhone("");
      setClientEmail("");
      setFrequency("ONCE");
      setEndType("NEVER");
      setEndDate(addCalendarDays(initialDate, 60));
      setMaxOccurrences(4);
      setPricingMode("CURRENT_RATE");
      setSelectedMembershipId("");
      setSeriesSummaryModal(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, appointment?.id, initialDate]);

  // Auto-select active membership if client has one
  useEffect(() => {
    if (mode === "CREATE" && clientActiveMemberships.length === 1 && !selectedMembershipId) {
      setSelectedMembershipId(clientActiveMemberships[0]!.id);
    }
  }, [mode, clientActiveMemberships, selectedMembershipId]);

  // When changing start time, auto-update end time to default duration if not customized
  function handleStartTimeChange(newStart: string) {
    setStartTime(newStart);
    const startM = timeToMinutes(newStart);
    const dur = activeService?.duration || 45;
    const endM = (startM + dur) % 1440;
    setCustomEndTime(minutesToTime(endM));
  }

  function handleBarberChange(newBarberId: string) {
    setBarberId(newBarberId);
    if (!isOtro && activeService) {
      const selectedB = barbersList.find((b) => b.id === newBarberId);
      setServicePrice(getEffectiveServicePrice(activeService.name, selectedB?.name));
    }
  }

  // When changing service, auto-adjust price and end time
  function handleServiceChange(newServiceId: string) {
    setServiceId(newServiceId);
    if (newServiceId === "OTRO") {
      setCustomServiceName("");
      setCustomPrice("");
    } else {
      const s = servicesList.find((srv) => (srv.dbId && srv.dbId === newServiceId) || srv.id === newServiceId);
      if (s) {
        const selectedB = barbersList.find((b) => b.id === barberId);
        setServicePrice(getEffectiveServicePrice(s.name, selectedB?.name));
        const startM = timeToMinutes(startTime);
        const endM = (startM + (s.duration || 45)) % 1440;
        setCustomEndTime(minutesToTime(endM));
      }
    }
  }

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
    setSelectedClientId(c.id);
    setClientName(c.name || "");
    setClientPhone(c.phone || "");
    setClientEmail(
      c.email?.includes("@cliente.kanibarber.internal") ? "" : c.email || ""
    );
    setClientSearch("");
    setShowClientSuggestions(false);
  }

  // Active price for submission
  const resolvedPrice = useMemo(() => {
    if (selectedMembershipId) return 0;
    if (isOtro) return typeof customPrice === "number" ? customPrice : 0;
    return servicePrice || activeService?.price || 0;
  }, [selectedMembershipId, isOtro, customPrice, servicePrice, activeService?.price]);

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

    if (isOtro) {
      const cleanCustomName = customServiceName.trim();
      if (!cleanCustomName) {
        setFormError("El nombre del servicio es obligatorio.");
        return;
      }
      if (!selectedMembershipId && (customPrice === "" || Number(customPrice) < 0)) {
        setFormError("El importe del servicio es obligatorio.");
        return;
      }
    } else {
      if (!startTime) {
        setFormError("Tenés que seleccionar un horario para el turno.");
        return;
      }
    }

    if (mode === "CREATE" && frequency !== "ONCE") {
      if (endType === "UNTIL_DATE" && (!endDate || endDate < date)) {
        setFormError("La fecha de finalización de la recurrencia debe ser igual o posterior a la fecha de inicio.");
        return;
      }
      if (endType === "AFTER_COUNT" && (!maxOccurrences || maxOccurrences < 1)) {
        setFormError("Indicá una cantidad válida de repeticiones (mínimo 1).");
        return;
      }
    }

    if (overlapConflict) {
      setFormError(overlapConflict);
      return;
    }

    const cleanName = clientName.trim();
    if (!cleanName || cleanName.length < 2) {
      setFormError("El nombre del cliente debe tener al menos 2 caracteres.");
      return;
    }
    const cleanPhone = clientPhone.trim();
    if (!cleanPhone || cleanPhone.replace(/\D/g, "").length < 6) {
      setFormError("El celular del cliente debe tener al menos 6 dígitos.");
      return;
    }

    const targetServiceUuid = isOtro ? null : (activeService?.dbId || serviceId);

    setIsBusy(true);
    try {
      if (mode === "EDIT" && appointment) {
        if (appointment.recurringRuleId && editScope !== "SINGLE") {
          await modifyRecurringAppointmentSeries(
            {
              appointmentId: appointment.id,
              scope: editScope,
              action: "UPDATE",
              newStartTime: startTime,
              newServiceId: targetServiceUuid,
              newPriceArs: resolvedPrice,
              newPricingMode: pricingMode,
            },
            staff,
          );
          await data.refresh();
          onSuccess(
            editScope === "THIS_AND_FOLLOWING"
              ? "Se actualizaron esta fecha y los turnos siguientes de la recurrencia."
              : "Se actualizó toda la serie futura de turnos recurrentes.",
          );
          onClose();
          return;
        }

        await updateManualAppointment({
          appointmentId: appointment.id,
          barberId,
          serviceId: targetServiceUuid,
          customServiceName: isOtro ? customServiceName.trim() : null,
          servicePriceArs: resolvedPrice,
          date,
          time: startTime,
          endTime: customEndTime,
          name: cleanName,
          phone: cleanPhone,
          email: clientEmail.trim() || undefined,
          notes: appointment?.notes || undefined,
          durationMinutes,
        });
        await data.refresh();
        onSuccess("Turno manual actualizado exitosamente.");
        onClose();
      } else if (frequency !== "ONCE") {
        // FASE 4 & FASE 5: Crear serie recurrente con ventana móvil de 90 días y gestión de conflictos parciales
        const seriesResult = await createRecurringManualSeries(
          {
            barberId,
            serviceId: targetServiceUuid,
            customServiceName: isOtro ? customServiceName.trim() : null,
            servicePriceArs: resolvedPrice,
            startDate: date,
            startTime,
            durationMinutes,
            clientName: cleanName,
            clientPhone: cleanPhone,
            clientEmail: clientEmail.trim() || null,
            clientId: selectedClientId,
            frequencyType: frequency,
            endType,
            endDate: endType === "UNTIL_DATE" ? endDate : null,
            maxOccurrences: endType === "AFTER_COUNT" ? maxOccurrences : null,
            pricingMode,
            membershipId: selectedMembershipId || null,
            horizonDays: 90,
          },
          staff,
          appointmentsList,
        );

        // FASE 10: Despachar confirmación agrupada en un único correo con links individuales de cancelación
        if (clientEmail.trim() && seriesResult.createdAppointments.length > 0) {
          const barberName = barbersList.find((b) => b.id === barberId)?.name || "Kani Barber Studio";
          const srvName = isOtro
            ? customServiceName.trim()
            : formatServiceName(activeService?.name || "Corte");
          const freqLabel =
            RECURRENCE_FREQUENCY_OPTIONS.find((o) => o.value === frequency)?.label || "Recurrente";
          const linkedMembership = membershipsList.find((m) => m.id === selectedMembershipId);

          void sendRecurringSeriesGroupedEmailServerFn({
            data: {
              ruleId: seriesResult.ruleId,
              clientName: cleanName,
              recipientEmail: clientEmail.trim(),
              barberName,
              serviceName: srvName,
              frequencyLabel: freqLabel,
              membershipPlanName: linkedMembership?.planName ?? null,
              appointments: seriesResult.createdAppointments.map((a) => ({
                id: a.id,
                bookingDate: a.bookingDate,
                startTime: a.startTime,
                endTime: a.endTime,
                serviceName: srvName,
                barberName,
                servicePriceArs: a.servicePriceArs,
              })),
            },
          }).catch(() => null);
        }

        await data.refresh();
        setSeriesSummaryModal(seriesResult);
      } else {
        await createManualAppointment({
          barberId,
          serviceId: targetServiceUuid,
          customServiceName: isOtro ? customServiceName.trim() : null,
          servicePriceArs: resolvedPrice,
          date,
          time: startTime,
          endTime: customEndTime,
          name: cleanName,
          phone: cleanPhone,
          email: clientEmail.trim() || undefined,
          notes: undefined,
          durationMinutes,
          clientId: selectedClientId,
        });
        await data.refresh();
        onSuccess("Turno manual creado exitosamente.");
        onClose();
      }
    } catch (err: unknown) {
      const msg = appointmentErrorMessage(err);
      setFormError(msg);
    } finally {
      setIsBusy(false);
    }
  }

  // FASE 5: Modal de resultado de creación de recurrencia con conflictos omitidos
  if (seriesSummaryModal) {
    return (
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            onSuccess(
              `Recurrencia creada: ${seriesSummaryModal.createdCount} turnos creados, ${seriesSummaryModal.omittedCount} fechas omitidas por conflictos.`,
            );
            setSeriesSummaryModal(null);
            onClose();
          }
        }}
      >
        <DialogContent className="v2-dialog v2-manual-dialog">
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-success" />
            Recurrencia creada
          </DialogTitle>
          <DialogDescription>
            <strong>{seriesSummaryModal.createdCount}</strong>{" "}
            {seriesSummaryModal.createdCount === 1 ? "turno creado" : "turnos creados"} en la ventana de 90 días ·{" "}
            <strong>{seriesSummaryModal.omittedCount}</strong>{" "}
            {seriesSummaryModal.omittedCount === 1
              ? "fecha omitida por conflicto"
              : "fechas omitidas por conflictos"}
            .
          </DialogDescription>

          {seriesSummaryModal.omittedConflicts.length > 0 && (
            <div className="my-3 p-3 rounded-lg border border-amber-500/35 bg-amber-500/10 text-xs space-y-2">
              <p className="font-semibold text-amber-400 flex items-center gap-1.5">
                <AlertTriangle size={14} />
                Fechas omitidas (se mantienen los turnos existentes):
              </p>
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {seriesSummaryModal.omittedConflicts.map((c) => (
                  <li key={c.targetDate} className="flex items-center justify-between gap-2">
                    <span>
                      <strong>{dateLabel(c.targetDate)}</strong> · {c.startTime} hs
                    </span>
                    <span className="text-muted-foreground">
                      {c.conflictingClientName
                        ? `Ocupado (${c.conflictingClientName})`
                        : "Horario ya reservado"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {seriesSummaryModal.createdAppointments.length > 0 && (
            <div className="my-2 p-3 rounded-lg border border-border bg-secondary/20 text-xs space-y-1.5">
              <p className="font-semibold text-foreground">
                Próximas ocurrencias creadas ({seriesSummaryModal.createdAppointments.length}):
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {seriesSummaryModal.createdAppointments.map((apt) => (
                  <div key={apt.id} className="flex items-center justify-between text-muted-foreground">
                    <span>{dateLabel(apt.bookingDate)}</span>
                    <span>
                      {apt.startTime} a {apt.endTime} hs
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="v2-manual-dialog-actions">
            <button
              type="button"
              className="v2-secondary"
              onClick={() => {
                onSuccess(
                  `Recurrencia creada: ${seriesSummaryModal.createdCount} turnos creados, ${seriesSummaryModal.omittedCount} fechas omitidas por conflictos.`,
                );
                setSeriesSummaryModal(null);
                onClose();
              }}
            >
              Cerrar
            </button>
            <button
              type="button"
              className="v2-primary"
              onClick={() => {
                const firstDate = seriesSummaryModal.createdAppointments[0]?.bookingDate;
                onSuccess(
                  `Recurrencia creada: ${seriesSummaryModal.createdCount} turnos creados, ${seriesSummaryModal.omittedCount} fechas omitidas por conflictos.`,
                );
                setSeriesSummaryModal(null);
                onViewCreatedSeries?.(firstDate);
                onClose();
              }}
            >
              Ver turnos creados
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="v2-dialog v2-manual-dialog"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <DialogTitle id={titleId}>
          {mode === "CREATE" ? "Nuevo turno manual" : "Editar turno manual"}
        </DialogTitle>
        <DialogDescription id={descId}>
          {mode === "CREATE"
            ? "Crea un turno operativo o una serie recurrente directamente confirmada."
            : "Modifica los datos del turno manual seleccionado."}
        </DialogDescription>

        <form onSubmit={handleSubmit} className="v2-form v2-manual-form">
          {formError && (
            <p className="v2-alert" role="alert">
              {formError}
            </p>
          )}

          {/* Barber & Service Selectors */}
          <div className="v2-manual-row">
            {isAdmin && (
              <label className="v2-field">
                Barbero *
                <select
                  value={barberId}
                  disabled={isBusy}
                  onChange={(e) => handleBarberChange(e.target.value)}
                >
                  {availableBarbers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="v2-field">
              Servicio *
              <select
                value={serviceId}
                disabled={isBusy}
                onChange={(e) => handleServiceChange(e.target.value)}
              >
                {servicesList.map((s) => (
                  <option key={s.dbId || s.id} value={s.dbId || s.id}>
                    {formatServiceName(s.name)}
                  </option>
                ))}
                <option value="OTRO">Otro</option>
              </select>
            </label>
          </div>

          {/* Conditional inputs for Servicio "Otro" vs Standard */}
          {isOtro ? (
            <>
              <div className="v2-manual-row">
                <label className="v2-field">
                  Nombre del servicio *
                  <input
                    type="text"
                    required
                    placeholder="Ej. Tintura de color"
                    value={customServiceName}
                    disabled={isBusy}
                    onChange={(e) => setCustomServiceName(e.target.value)}
                  />
                </label>

                <label className="v2-field">
                  Importe ($ ARS) *
                  <input
                    type="number"
                    min={0}
                    step={1}
                    required={!selectedMembershipId}
                    placeholder="Ej. 35000"
                    value={selectedMembershipId ? 0 : customPrice}
                    disabled={isBusy || Boolean(selectedMembershipId)}
                    onChange={(e) =>
                      setCustomPrice(e.target.value === "" ? "" : Number(e.target.value))
                    }
                  />
                </label>
              </div>

              <div className="v2-manual-row-single">
                <label className="v2-field">
                  Fecha
                  <input
                    type="date"
                    value={date}
                    disabled={isBusy}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
              </div>
            </>
          ) : (
            <div className="v2-manual-row">
              <label className="v2-field">
                Fecha
                <input
                  type="date"
                  value={date}
                  disabled={isBusy}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>

              <label className="v2-field">
                Importe ($ ARS) *
                <input
                  type="number"
                  min={0}
                  step={1}
                  required
                  placeholder="Ej. 25000"
                  value={selectedMembershipId ? 0 : servicePrice}
                  disabled={isBusy || Boolean(selectedMembershipId)}
                  onChange={(e) => setServicePrice(Number(e.target.value))}
                />
              </label>
            </div>
          )}

          {/* Time row: Inicio & Finalización 24h freely customizable */}
          <div className="v2-manual-row">
            <label className="v2-field">
              Hora de inicio *
              <select
                value={startTime}
                disabled={isBusy}
                onChange={(e) => handleStartTimeChange(e.target.value)}
              >
                {TIME_15_OPTIONS.map((t) => (
                  <option key={`start-${t}`} value={t}>
                    {t} hs
                  </option>
                ))}
              </select>
            </label>

            <label className="v2-field">
              Hora de finalización *
              <select
                value={customEndTime}
                disabled={isBusy}
                onChange={(e) => setCustomEndTime(e.target.value)}
              >
                {TIME_15_OPTIONS.map((t) => (
                  <option key={`end-${t}`} value={t}>
                    {t} hs
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* FASE 4 & 12: Selector de Repetición y modo de precio */}
          {mode === "CREATE" && (
            <>
              <div className="v2-manual-row">
                <label className="v2-field">
                  <span className="inline-flex items-center gap-1">
                    <Repeat size={13} />
                    Repetición
                  </span>
                  <select
                    value={frequency}
                    disabled={isBusy}
                    onChange={(e) => setFrequency(e.target.value as RecurrenceFrequencyType)}
                  >
                    {RECURRENCE_FREQUENCY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                {frequency !== "ONCE" && (
                  <label className="v2-field">
                    Finalización
                    <select
                      value={endType}
                      disabled={isBusy}
                      onChange={(e) => setEndType(e.target.value as RecurrenceEndType)}
                    >
                      {RECURRENCE_END_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {frequency !== "ONCE" && (
                <div className="v2-manual-row">
                  {endType === "UNTIL_DATE" && (
                    <label className="v2-field">
                      Hasta la fecha *
                      <input
                        type="date"
                        min={date}
                        value={endDate}
                        disabled={isBusy}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                    </label>
                  )}

                  {endType === "AFTER_COUNT" && (
                    <label className="v2-field">
                      Cantidad de repeticiones *
                      <input
                        type="number"
                        min={1}
                        max={100}
                        step={1}
                        value={maxOccurrences}
                        disabled={isBusy}
                        onChange={(e) =>
                          setMaxOccurrences(Math.max(1, Number(e.target.value) || 1))
                        }
                      />
                    </label>
                  )}

                  {!selectedMembershipId && (
                    <label className="v2-field">
                      Modalidad de tarifa
                      <select
                        value={pricingMode}
                        disabled={isBusy}
                        onChange={(e) =>
                          setPricingMode(e.target.value as RecurringPricingMode)
                        }
                      >
                        <option value="CURRENT_RATE">Tarifa vigente en cada fecha</option>
                        <option value="FIXED_PRICE">Precio fijo ({money(resolvedPrice)})</option>
                      </select>
                    </label>
                  )}
                </div>
              )}
            </>
          )}

          {/* FASE 11: Si se está editando un turno que pertenece a una serie recurrente, ofrecer alcance */}
          {mode === "EDIT" && appointment?.recurringRuleId && (
            <div className="v2-manual-row-single">
              <label className="v2-field">
                Alcance de la modificación
                <select
                  value={editScope}
                  disabled={isBusy}
                  onChange={(e) => setEditScope(e.target.value as RecurrenceScopeType)}
                >
                  {RECURRENCE_SCOPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {overlapConflict && (
            <p className="v2-alert" role="alert" style={{ marginTop: "4px" }}>
              {overlapConflict}
            </p>
          )}

          {/* Client Details Section */}
          <div className="v2-manual-client-section">
            <div className="v2-client-quick-search v2-search">
              <Search size={15} />
              <input
                type="text"
                placeholder="Buscar cliente existente por nombre, celular o email..."
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

            <div className="v2-manual-row">
              <label className="v2-field">
                Nombre del cliente *
                <input
                  type="text"
                  required
                  placeholder="Ej. Lucas Fernández"
                  value={clientName}
                  disabled={isBusy}
                  onChange={(e) => {
                    setClientName(e.target.value);
                    setSelectedClientId(null);
                  }}
                />
              </label>

              <label className="v2-field">
                Celular *
                <input
                  type="tel"
                  required
                  placeholder="Ej. 11 2345-6789"
                  value={clientPhone}
                  disabled={isBusy}
                  onChange={(e) => setClientPhone(e.target.value)}
                />
              </label>
            </div>

            <div className="v2-manual-row">
              <label className="v2-field">
                Email · opcional
                <input
                  type="email"
                  placeholder="lucas@ejemplo.com"
                  value={clientEmail}
                  disabled={isBusy}
                  onChange={(e) => setClientEmail(e.target.value)}
                />
              </label>

              {/* FASE 4 & 7: Asociar membresía activa del cliente si corresponde */}
              {clientActiveMemberships.length > 0 && (
                <label className="v2-field">
                  Membresía asociada
                  <select
                    value={selectedMembershipId}
                    disabled={isBusy}
                    onChange={(e) => setSelectedMembershipId(e.target.value)}
                  >
                    <option value="">Sin membresía (turno independiente)</option>
                    {clientActiveMemberships.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.planName} ({m.remainingSessions} sesiones disp.)
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>

          <div className="v2-manual-dialog-actions">
            <button
              type="button"
              className="v2-secondary"
              onClick={onClose}
              disabled={isBusy}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="v2-primary"
              disabled={isBusy || Boolean(overlapConflict)}
            >
              {isBusy
                ? "Guardando…"
                : mode === "CREATE"
                ? frequency !== "ONCE"
                  ? "Crear recurrencia"
                  : "Crear turno"
                : "Guardar cambios"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
