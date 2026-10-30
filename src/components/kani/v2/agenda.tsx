import { getWhatsAppUrl } from "@/lib/kani-phone";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, Clock3, Mail, Phone, Plus } from "lucide-react";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { businessDateToday, addCalendarDays, startOfBusinessWeek } from "@/lib/kani-mobile-appointments";
import { businessTimeNow } from "@/lib/kani-payments";
import { money, dateLabel, formatRangeLabel, formatAdminV2Date, formatAdminV2Range } from "@/lib/kani-model";
import { paymentSummary, scopeV2 } from "@/lib/kani-v2";
import {
  appointmentErrorMessage,
  updateRealAppointmentStatus,
  type RealAppointment,
  type NotificationChannelDispatch,
} from "@/lib/kani-appointments";
import { retryNotificationChannelServerFn } from "@/lib/kani-notifications.functions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useV2 } from "./data";
import {
  AdminFilterPanel,
  AdminFilterCell,
  AdminV2FiltersPanel,
  AdminV2FilterField,
  AdminV2SectionToolbar,
  BarberFilter,
  Empty,
  Metric,
  Status,
  statusLabels,
} from "./shared";
import { ManualAppointmentDialog } from "./manual-appointment-dialog";

export function V2Home() {
  const data = useV2();
  const staff = useAdminStaff();
  const today = businessDateToday();
  const now = businessTimeNow();
  const appointments = scopeV2(data.appointments, staff.profile.role, staff.profile.barber_id);
  const daily = appointments.filter((a) => a.date === today);
  const next = appointments.find(
    (a) =>
      (a.date > today || (a.date === today && a.time >= now)) &&
      ["CONFIRMED", "PENDING"].includes(a.statusCode),
  );
  const payments = scopeV2(data.payments, staff.profile.role, staff.profile.barber_id).filter(
    (p) => p.paymentDate === today,
  );
  const nextSpace = data.starts
    .filter(
      (start) =>
        (staff.profile.role === "ADMIN" || start.barber_id === staff.profile.barber_id) &&
        start.compatible_services.length > 0 &&
        (start.slot_date > today ||
          (start.slot_date === today && start.start_time.slice(0, 5) > now)),
    )
    .sort((a, b) =>
      `${a.slot_date}${a.start_time}`.localeCompare(`${b.slot_date}${b.start_time}`),
    )[0];
  return (
    <main className="v2-page">
      <section className="v2-hero-grid">
        <article className="v2-next">
          <span className="v2-eyebrow">PRÓXIMO TURNO</span>
          {next ? (
            <>
              <strong>{next.time}</strong>
              <h2>{next.name}</h2>
              <p>
                {next.serviceName} · {next.barber}
              </p>
              <p className={next.date === today ? "v2-current-day" : undefined}>
                {dateLabel(next.date)}
              </p>
              <Status code={next.statusCode} />
            </>
          ) : (
            <>
              <strong>Agenda libre</strong>
              <p>No hay próximos turnos pendientes o confirmados.</p>
            </>
          )}
          <Link className="v2-primary" to="/admin-v2/turnos">
            Ver agenda <ArrowRight size={17} />
          </Link>
        </article>
        <article className="v2-panel v2-space-summary">
          <span className="v2-eyebrow">PRÓXIMO ESPACIO</span>
          <strong>{nextSpace ? nextSpace.start_time.slice(0, 5) : "Sin espacios"}</strong>
          <p className={nextSpace?.slot_date === today ? "v2-current-day" : undefined}>
            {nextSpace ? dateLabel(nextSpace.slot_date) : "En los próximos 7 días"}
          </p>
          {nextSpace && <p>{staff.barbers.find((b) => b.id === nextSpace.barber_id)?.name}</p>}
          <Link className="v2-secondary" to="/admin-v2/horarios">
            Ver horarios
          </Link>
        </article>
        <div className="v2-today">
          <h2>Hoy, de un vistazo</h2>
          <div className="v2-metrics">
            <Metric label="Turnos" value={daily.length} />
            <Metric
              label="Realizados"
              value={daily.filter((a) => a.statusCode === "COMPLETED").length}
            />
            <Metric
              label="Pendientes"
              value={daily.filter((a) => a.statusCode === "PENDING").length}
            />
            <Metric
              label="Cobrado"
              value={money(paymentSummary(payments).collected)}
            />
          </div>
          <Link className="v2-text-link" to="/admin-v2/pagos">
            Registrar un cobro <ArrowRight size={16} />
          </Link>
        </div>
      </section>
      <section className="v2-panel">
        <div className="v2-section-title">
          <h2>El equipo hoy</h2>
          <Link to="/admin-v2/horarios">
            Organizar horarios <ArrowRight size={16} />
          </Link>
        </div>
        <div className="v2-team">
          {staff.barbers
            .filter((b) => staff.profile.role === "ADMIN" || b.id === staff.profile.barber_id)
            .map((b) => (
              <article key={b.id}>
                <span className="v2-avatar">{b.name[0]}</span>
                <div>
                  <h3>{b.name}</h3>
                  <p>
                    {
                      daily.filter((a) => a.barberId === b.id && a.statusCode !== "CANCELLED")
                        .length
                    }{" "}
                    turnos ·{" "}
                    {daily.filter((a) => a.barberId === b.id && a.statusCode === "PENDING").length}{" "}
                    pendientes
                  </p>
                </div>
                <CalendarDays size={20} />
              </article>
            ))}
        </div>
      </section>
      <div className="v2-callout v2-space-detail">
        <Clock3 size={22} />
        <div>
          <h2>
            {nextSpace
              ? `Próximo espacio · ${nextSpace.start_time.slice(0, 5)}`
              : "Prepará el próximo espacio"}
          </h2>
          <p>
            {nextSpace
              ? `${dateLabel(nextSpace.slot_date)} · ${staff.barbers.find((b) => b.id === nextSpace.barber_id)?.name ?? "Tu agenda"}. Consultá Horarios para ver los servicios compatibles.`
              : "No encontramos próximos espacios habilitados en los siguientes 7 días. Revisá la jornada en Horarios."}
          </p>
        </div>
        <Link to="/admin-v2/horarios">Ver disponibilidad</Link>
      </div>
    </main>
  );
}

export type AgendaPeriodPreset = "TODAY" | "THIS_WEEK" | "NEXT_10_DAYS" | "CUSTOM";
export type AgendaPeriodFilter = AgendaPeriodPreset | "DATE";

export function V2Appointments() {
  const data = useV2();
  const staff = useAdminStaff();
  const today = businessDateToday();
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState("ALL");
  const [period, setPeriod] = useState<AgendaPeriodFilter>("TODAY");
  const [customStartDate, setCustomStartDate] = useState(today);
  const [customEndDate, setCustomEndDate] = useState(today);
  const [action, setAction] = useState<{
    appointment: RealAppointment;
    status: "CANCELLED";
  } | null>(null);
  const [manualDialog, setManualDialog] = useState<{
    open: boolean;
    mode: "CREATE" | "EDIT";
    appointment?: RealAppointment | null;
  }>({ open: false, mode: "CREATE", appointment: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const isInvalidRange = period === "CUSTOM" && customStartDate > customEndDate;

  let startDate = today;
  let endDate = today;
  let headerLabel = "";

  if (period === "TODAY") {
    startDate = today;
    endDate = today;
    headerLabel = formatAdminV2Date(today);
  } else if (period === "DATE") {
    startDate = date;
    endDate = date;
    headerLabel = formatAdminV2Date(date);
  } else if (period === "THIS_WEEK") {
    const weekStart = startOfBusinessWeek(today);
    const weekEnd = addCalendarDays(weekStart, 6);
    startDate = weekStart;
    endDate = weekEnd;
    headerLabel = formatAdminV2Range(weekStart, weekEnd);
  } else if (period === "NEXT_10_DAYS") {
    const tenDaysEnd = addCalendarDays(today, 9);
    startDate = today;
    endDate = tenDaysEnd;
    headerLabel = formatAdminV2Range(today, tenDaysEnd);
  } else if (period === "CUSTOM") {
    if (isInvalidRange) {
      headerLabel = "Rango no válido";
    } else {
      startDate = customStartDate;
      endDate = customEndDate;
      headerLabel = formatAdminV2Range(customStartDate, customEndDate);
    }
  }

  const isMultiDay =
    period === "THIS_WEEK" ||
    period === "NEXT_10_DAYS" ||
    (period === "CUSTOM" && !isInvalidRange && customStartDate !== customEndDate);

  const rows = isInvalidRange
    ? []
    : scopeV2(
        data.appointments,
        staff.profile.role,
        staff.profile.barber_id,
        data.barberId,
      ).filter(
        (a) =>
          a.date >= startDate &&
          a.date <= endDate &&
          (status === "ALL" || a.statusCode === status),
      );

  function handlePeriodChange(next: AgendaPeriodPreset) {
    setPeriod(next);
    if (next === "TODAY") {
      setDate(today);
    }
  }

  function handleDateChange(nextDate: string) {
    const chosen = nextDate || today;
    setDate(chosen);
    if (chosen === today) {
      setPeriod("TODAY");
    } else {
      setPeriod("DATE");
    }
  }

  async function cancelAppointment() {
    if (!action || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await updateRealAppointmentStatus(action.appointment.id, action.status);
      setAction(null);
      await data.refresh();
      setMessage("Turno actualizado.");
    } catch (e) {
      setMessage(appointmentErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryChannel(
    appointmentId: string,
    channel: "WHATSAPP" | "EMAIL",
    errorCode?: string | null,
  ) {
    if (channel === "WHATSAPP" && errorCode === "131042") {
      setMessage(
        "Meta rechazó el mensaje por un problema de facturación (error 131042: la moneda de la cuenta de WhatsApp Business no está configurada). Debe resolverse la configuración en Meta Business Suite antes de reintentar.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await retryNotificationChannelServerFn({
        data: { appointmentId, channel },
      });
      if (res.blockedByAdminConfig) {
        setMessage(res.error || "Reintento bloqueado por configuración administrativa pendiente en Meta.");
      } else if (res.success) {
        setMessage(`Notificación por ${channel === "WHATSAPP" ? "WhatsApp" : "Email"} reintentada correctamente.`);
        await data.refresh();
      } else {
        setMessage(`Error al reintentar ${channel}: ${res.error || "Falló el envío"}`);
        await data.refresh();
      }
    } catch (err) {
      setMessage(`Error al reintentar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="v2-page v2-appointments-page">
      <AdminFilterPanel
        ariaLabel="Filtros de turnos"
        footer={
          period === "CUSTOM" && (
            <div className="v2-custom-range-row">
              <AdminFilterCell label="Desde" htmlFor="v2-appointments-custom-start">
                <input
                  id="v2-appointments-custom-start"
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                />
              </AdminFilterCell>
              <AdminFilterCell label="Hasta" htmlFor="v2-appointments-custom-end">
                <input
                  id="v2-appointments-custom-end"
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                />
              </AdminFilterCell>
              {isInvalidRange && (
                <p className="v2-range-warning" role="alert">
                  La fecha 'Desde' debe ser anterior o igual a 'Hasta'.
                </p>
              )}
            </div>
          )
        }
      >
        <AdminFilterCell label="Período" htmlFor="v2-appointments-period">
          <select
            id="v2-appointments-period"
            value={period}
            onChange={(e) => handlePeriodChange(e.target.value as AgendaPeriodPreset)}
          >
            {period === "DATE" && <option value="DATE" hidden>Día seleccionado</option>}
            <option value="TODAY">Hoy</option>
            <option value="THIS_WEEK">Esta semana</option>
            <option value="NEXT_10_DAYS">Próximos 10 días</option>
            <option value="CUSTOM">Personalizado</option>
          </select>
        </AdminFilterCell>
        <AdminFilterCell label="Fecha" htmlFor="v2-appointments-date">
          <input
            id="v2-appointments-date"
            type="date"
            value={date}
            onChange={(e) => handleDateChange(e.target.value)}
          />
        </AdminFilterCell>
        <AdminFilterCell label="Barbero" htmlFor="v2-appointments-barber">
          <select
            id="v2-appointments-barber"
            value={staff.profile.role === "ADMIN" ? data.barberId : (staff.profile.barber_id ?? "")}
            onChange={(e) => data.setBarberId(e.target.value)}
            disabled={staff.profile.role !== "ADMIN"}
          >
            {staff.profile.role === "ADMIN" && <option value="ALL">Todo Kani</option>}
            {staff.barbers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </AdminFilterCell>
        <AdminFilterCell label="Estado" htmlFor="v2-appointments-status">
          <select
            id="v2-appointments-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="ALL">Todos</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </AdminFilterCell>
      </AdminFilterPanel>
      <AdminV2SectionToolbar
        dateLabel={headerLabel}
        actionLabel="+ Agregar turno"
        onAction={() => setManualDialog({ open: true, mode: "CREATE", appointment: null })}
      />
      {message && (
        <p className="v2-alert" role="status">
          {message}
        </p>
      )}
      <div className="v2-agenda">
        {!rows.length && (
          <Empty>
            {isInvalidRange
              ? "Revisá el rango seleccionado: la fecha 'Desde' debe ser anterior o igual a 'Hasta'."
              : "No hay turnos para esta selección. Podés consultar otro día."}
          </Empty>
        )}
        {rows.map((a) => (
          <article className="v2-appointment" key={a.id}>
            <div className="v2-appointment-main">
              {/* Fila 1: 10:00 | Matias Zarate | Estado */}
              <div className="v2-app-row-1">
                <strong className="v2-app-time">{a.time}</strong>
                <span className="v2-app-sep">|</span>
                <h3 className="v2-app-name" title={a.name}>{a.name}</h3>
                {a.isManual && <span className="v2-manual-badge">Manual</span>}
                <Status code={a.statusCode} />
              </div>

              {/* Fila 2: 10:45 · Corte · Lautaro (· Fecha si isMultiDay) */}
              <div className="v2-app-row-2">
                {a.endTime && (
                  <>
                    <span className="v2-app-endtime">{a.endTime}</span>
                    <span className="v2-app-dot">·</span>
                  </>
                )}
                <span className="v2-app-service">{a.serviceName}</span>
                <span className="v2-app-dot">·</span>
                <span className="v2-app-barber">{a.barber}</span>
                {isMultiDay && (
                  <>
                    <span className="v2-app-dot">·</span>
                    <span className="v2-app-date">{dateLabel(a.date)}</span>
                  </>
                )}
              </div>

              {/* Fila 3: Seña: No abonada · Importe: $25.000 */}
              <div className="v2-app-row-3">
                <span className="v2-app-deposit">
                  Seña:{" "}
                  {data.depositSupported
                    ? a.depositPaid
                      ? money(a.depositAmountArs ?? 5000)
                      : "No abonada"
                    : "Sin dato verificable"}
                </span>
                <span className="v2-app-dot">·</span>
                <span className="v2-app-price">Importe: {money(a.servicePrice ?? 0)}</span>
              </div>

              {/* Fila 4: Diagnóstico granular de notificaciones */}
              <div className="v2-app-notifications">
                <div className="v2-notif-channel">
                  <span className="v2-notif-icon" aria-hidden="true">💬</span>
                  <span
                    className={`v2-notif-pill v2-notif-${(a.dispatches?.whatsapp?.status || "PENDING").toLowerCase()}`}
                    title={a.dispatches?.whatsapp?.errorDescription || undefined}
                  >
                    {formatWhatsAppStatus(a.dispatches?.whatsapp)}
                  </span>
                  {a.dispatches?.whatsapp?.status === "FAILED" && (
                    <button
                      type="button"
                      className="v2-notif-retry-btn"
                      disabled={busy}
                      onClick={() =>
                        handleRetryChannel(a.id, "WHATSAPP", a.dispatches?.whatsapp?.errorCode)
                      }
                      title="Reintentar notificación WhatsApp"
                    >
                      Reintentar
                    </button>
                  )}
                </div>
                <div className="v2-notif-channel">
                  <span className="v2-notif-icon" aria-hidden="true">✉️</span>
                  <span
                    className={`v2-notif-pill v2-notif-${(a.dispatches?.email?.status || "PENDING").toLowerCase()}`}
                    title={a.dispatches?.email?.errorDescription || undefined}
                  >
                    {formatEmailStatus(a.dispatches?.email)}
                  </span>
                  {a.dispatches?.email?.status === "FAILED" && (
                    <button
                      type="button"
                      className="v2-notif-retry-btn"
                      disabled={busy}
                      onClick={() => handleRetryChannel(a.id, "EMAIL")}
                      title="Reintentar notificación Email"
                    >
                      Reintentar
                    </button>
                  )}
                </div>
              </div>

              {a.notes && <p className="v2-note">{a.notes}</p>}
            </div>

            <div className="v2-appointment-actions">
              <div className="v2-op-buttons">
                {a.isManual &&
                  ["PENDING", "CONFIRMED"].includes(a.statusCode) &&
                  (staff.profile.role === "ADMIN" || a.barberId === staff.profile.barber_id) && (
                    <button
                      type="button"
                      className="v2-secondary v2-action-btn"
                      disabled={busy}
                      onClick={() =>
                        setManualDialog({ open: true, mode: "EDIT", appointment: a })
                      }
                    >
                      Editar
                    </button>
                  )}
                {["PENDING", "CONFIRMED"].includes(a.statusCode) &&
                  (!a.isManual || staff.profile.role === "ADMIN") && (
                    <button
                      type="button"
                      className="v2-secondary action-reject v2-action-btn"
                      disabled={busy}
                      onClick={() => setAction({ appointment: a, status: "CANCELLED" })}
                    >
                      Cancelar turno
                    </button>
                  )}
                {a.statusCode === "CONFIRMED" && (
                  <Link className="v2-secondary v2-action-btn" to="/admin-v2/pagos" search={{ turno: a.id }}>
                    Cobrar
                  </Link>
                )}
              </div>
              <div className="v2-contact-buttons">
                {getWhatsAppUrl(a.phone) ? (
                  <a
                    className="v2-secondary v2-whatsapp v2-action-btn"
                    href={getWhatsAppUrl(a.phone)!}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <WhatsAppLabel />
                  </a>
                ) : (
                  <button
                    type="button"
                    className="v2-secondary v2-whatsapp v2-action-btn"
                    disabled
                    title="El cliente no tiene un teléfono válido"
                  >
                    <WhatsAppLabel />
                  </button>
                )}
                {a.email ? (
                  <a
                    className="v2-secondary v2-mail-btn v2-action-btn"
                    href={`mailto:${a.email}`}
                  >
                    <Mail size={16} />
                    <span>Mail</span>
                  </a>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
      <p className="v2-footnote">
        Los turnos pendientes se confirman al acreditarse la seña. Cancelar un turno no devuelve automáticamente la seña.
      </p>
      <ManualAppointmentDialog
        open={manualDialog.open}
        mode={manualDialog.mode}
        appointment={manualDialog.appointment}
        initialDate={
          period === "TODAY" || period === "DATE"
            ? date
            : period === "CUSTOM"
              ? customStartDate
              : today
        }
        onClose={() => setManualDialog((prev) => ({ ...prev, open: false }))}
        onSuccess={(msg) => setMessage(msg)}
      />
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null);
        }}
      >
        <DialogContent className="v2-dialog">
          <DialogTitle>
            ¿Cancelar este turno?
          </DialogTitle>
          <DialogDescription>
            {action?.appointment.name} · {action?.appointment.time}. Esta acción actualiza el turno
            y utiliza las notificaciones existentes.
          </DialogDescription>
          <button className="v2-secondary action-reject" disabled={busy} onClick={() => void cancelAppointment()}>
            {busy ? "Guardando…" : "Cancelar turno"}
          </button>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function formatWhatsAppStatus(dispatch?: NotificationChannelDispatch): string {
  if (!dispatch) return "WhatsApp: Pendiente";
  switch (dispatch.status) {
    case "DELIVERED":
      return "WhatsApp: Entregado";
    case "READ":
      return "WhatsApp: Leído";
    case "PROVIDER_ACCEPTED":
      return "WhatsApp: Aceptado por Pontiun (en entrega)";
    case "SENT":
      return "WhatsApp: Enviado a Meta";
    case "FAILED":
      if (dispatch.errorCode === "131042") {
        return "WhatsApp: Error 131042 (configuración de facturación/moneda en Meta pendiente)";
      }
      if (dispatch.errorCode === "TEMPLATE_NOT_APPROVED") {
        return "WhatsApp: Plantilla no aprobada en Meta/Pontiun";
      }
      return `WhatsApp: Falló (${dispatch.errorCode || dispatch.errorDescription || "Error"})`;
    case "SKIPPED":
      return `WhatsApp: Omitido (${dispatch.errorDescription || "sin teléfono"})`;
    default:
      return `WhatsApp: ${dispatch.status}`;
  }
}

function formatEmailStatus(dispatch?: NotificationChannelDispatch): string {
  if (!dispatch) return "Email: Pendiente";
  switch (dispatch.status) {
    case "SENT":
      return "Email: Enviado (Resend)";
    case "FAILED":
      return `Email: Falló (${dispatch.errorCode || dispatch.errorDescription || "Error"})`;
    case "SKIPPED":
      return `Email: Omitido (${dispatch.errorDescription || "sin correo"})`;
    default:
      return `Email: ${dispatch.status}`;
  }
}

function WhatsAppLabel() {
  return <><svg className="v2-whatsapp-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
        </svg><span>WhatsApp</span></>;
}
