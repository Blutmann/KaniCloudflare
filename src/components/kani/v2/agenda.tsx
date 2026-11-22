import { isStaffOperator } from "@/lib/kani-permissions";
import { getWhatsAppDirectSendUrl } from "@/lib/kani-phone";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, Bell, CalendarDays, Check, ChevronDown, ChevronUp, Clock3, Info, Mail, Pencil, X } from "lucide-react";
import { useAdminStaff } from "@/lib/kani-admin-context";
import {
  businessDateToday,
  addCalendarDays,
  V2AgendaPeriodPreset,
  v2AgendaPeriodOrder,
  isAppointmentTemporallyFinished,
  formatV2AgendaPeriodLabel,
  dateRangeForV2AgendaPeriod,
  sortV2AgendaAppointments,
} from "@/lib/kani-mobile-appointments";
import { businessTimeNow } from "@/lib/kani-payments";
import { money, dateLabel, formatAdminV2Date, formatAdminV2Range, formatServiceName } from "@/lib/kani-model";
import { paymentSummary, scopeV2 } from "@/lib/kani-v2";
import {
  appointmentErrorMessage,
  updateRealAppointmentStatus,
  type RealAppointment,
  type NotificationChannelDispatch,
} from "@/lib/kani-appointments";
import { retryNotificationChannelServerFn } from "@/lib/kani-notifications.functions";
import { supabase } from "@/integrations/supabase/client";
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

const SHORT_DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;

function formatShortMobileDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return dateLabel(isoDate);
  const [, y, m, d] = match;
  const utcDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  const dayName = SHORT_DAYS_ES[utcDate.getUTCDay()] ?? "";
  return `${dayName} ${d}/${m}`;
}

export function V2Home({
  basePath = "/panel-administracion",
}: { basePath?: "/panel-administracion" | "/panel-administracion-old" | "/admin-liquid" } = {}) {
  const isOld = basePath === "/panel-administracion-old";
  const turnosTo = isOld ? "/panel-administracion-old/turnos" : "/panel-administracion/turnos";
  const horariosTo = isOld ? "/panel-administracion-old/horarios" : "/panel-administracion/horarios";
  const pagosTo = isOld ? "/panel-administracion-old/pagos" : "/panel-administracion/pagos";
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
        (isStaffOperator(staff.profile.role) || start.barber_id === staff.profile.barber_id) &&
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
                {formatServiceName(next.serviceName)} · {next.barber}
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
          <Link className="v2-primary" to={turnosTo}>
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
          <Link className="v2-secondary" to={horariosTo}>
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
          <Link className="v2-text-link" to={pagosTo}>
            Registrar un cobro <ArrowRight size={16} />
          </Link>
        </div>
      </section>
      <section className="v2-panel">
        <div className="v2-section-title">
          <h2>El equipo hoy</h2>
          <Link to={horariosTo}>
            Organizar horarios <ArrowRight size={16} />
          </Link>
        </div>
        <div className="v2-team">
          {staff.barbers
            .filter((b) => isStaffOperator(staff.profile.role) || b.id === staff.profile.barber_id)
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
        <Link to={horariosTo}>Ver disponibilidad</Link>
      </div>
    </main>
  );
}

export type AgendaPeriodPreset = V2AgendaPeriodPreset;
export type AgendaPeriodFilter = V2AgendaPeriodPreset;

const V2_TURNO_PERIOD_STORAGE_KEY = "kani_admin_turnos_period_v1";

function readInitialV2Period(): V2AgendaPeriodPreset {
  if (typeof window === "undefined") return "NEXT_10_DAYS";
  try {
    const saved = window.localStorage?.getItem(V2_TURNO_PERIOD_STORAGE_KEY);
    if (
      saved &&
      (v2AgendaPeriodOrder as string[]).includes(saved) &&
      saved !== "DATE" &&
      saved !== "CUSTOM"
    ) {
      return saved as V2AgendaPeriodPreset;
    }
  } catch {
    // ignore storage errors
  }
  return "NEXT_10_DAYS";
}

export function V2Appointments({
  paymentsTo = "/panel-administracion/pagos",
}: {
  paymentsTo?:
    | "/panel-administracion/pagos"
    | "/panel-administracion-old/pagos"
    | "/panel-v2/negocio/pagos"
    | "/admin-liquid/pagos"
    | "/admin-v2-liquid/negocio/pagos";
} = {}) {
  const data = useV2();
  const staff = useAdminStaff();
  const today = businessDateToday();
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState("ALL");
  const [period, setPeriod] = useState<V2AgendaPeriodPreset>(() => readInitialV2Period());
  const [customEndDate, setCustomEndDate] = useState(() => addCalendarDays(today, 9));
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
  const [toastState, setToastState] = useState<{
    text: string;
    variant: "success" | "error";
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (text: string, variant: "success" | "error" = "success") => {
    setToastState({ text, variant });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastState(null);
      toastTimerRef.current = null;
    }, 3500);
  };
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);
  const [isMobileCard, setIsMobileCard] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobileCard(mql.matches);
    update();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }
    mql.addListener?.(update);
    return () => mql.removeListener?.(update);
  }, []);
  const [expandedDrawers, setExpandedDrawers] = useState<Record<string, boolean>>({});
  const toggleDrawer = (id: string) => {
    setExpandedDrawers((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const [whatsAppModal, setWhatsAppModal] = useState<{
    appointment: RealAppointment;
    mode: "NO_PHONE" | "INVALID_PHONE";
  } | null>(null);
  const [selectedNotifDetail, setSelectedNotifDetail] = useState<{
    appointment: RealAppointment;
    channel: "WhatsApp" | "Email";
    dispatch?: NotificationChannelDispatch;
  } | null>(null);
  const [retryingNotif, setRetryingNotif] = useState(false);
  const [retryFeedback, setRetryFeedback] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const isInvalidRange = period === "CUSTOM" && date > customEndDate;
  const { start: startDate, end: endDate } = dateRangeForV2AgendaPeriod(
    period,
    today,
    date,
    date,
    customEndDate,
  );

  const headerLabel = isInvalidRange
    ? "Rango no válido"
    : startDate === endDate
      ? formatAdminV2Date(startDate)
      : formatAdminV2Range(startDate, endDate);

  const isMultiDay = !isInvalidRange && startDate !== endDate;

  const filteredRows = isInvalidRange
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

  const rows = sortV2AgendaAppointments(filteredRows, period);

  function handlePeriodChange(next: V2AgendaPeriodPreset) {
    setPeriod(next);
    if (next === "TODAY") {
      setDate(today);
    }
    if (typeof window !== "undefined") {
      try {
        if (next !== "DATE" && next !== "CUSTOM") {
          window.localStorage?.setItem(V2_TURNO_PERIOD_STORAGE_KEY, next);
        }
      } catch {
        // ignore storage errors
      }
    }
  }

  function handleDateChange(nextDate: string) {
    const chosen = nextDate || today;
    setDate(chosen);
    if (period !== "CUSTOM") {
      setPeriod("DATE");
    }
  }

  function handleWhatsAppInvalid(a: RealAppointment) {
    if (!a.phone || !a.phone.trim()) {
      setWhatsAppModal({ appointment: a, mode: "NO_PHONE" });
      return;
    }
    setWhatsAppModal({ appointment: a, mode: "INVALID_PHONE" });
  }

  async function cancelAppointment() {
    if (!action || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await updateRealAppointmentStatus(action.appointment.id, action.status);
      setAction(null);
      await data.refresh({ silent: true });
      setMessage("Turno actualizado.");
      showToast("Turno actualizado.", "success");
    } catch (e) {
      const errMsg = appointmentErrorMessage(e);
      setMessage(errMsg);
      showToast(errMsg, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleResendNotificationModal() {
    if (!selectedNotifDetail || retryingNotif) return;
    const apt = selectedNotifDetail.appointment;
    if (!apt) return;

    const channel = selectedNotifDetail.channel === "WhatsApp" ? "WHATSAPP" : "EMAIL";
    setRetryingNotif(true);
    setRetryFeedback(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setRetryFeedback({
          type: "error",
          message: "AUTH_REQUIRED: Debe iniciar sesión como personal autorizado para reenviar notificaciones.",
        });
        return;
      }

      const res = await retryNotificationChannelServerFn({
        data: { appointmentId: apt.id, channel, forceResend: true, token },
      });

      if (res.success) {
        const defaultOkMsg =
          channel === "EMAIL"
            ? `Correo aceptado por el proveedor Resend (ID: ${res.providerMessageId || "OK"}). En tránsito.`
            : `Notificación de WhatsApp enviada al proveedor Pontiun (ID: ${res.providerMessageId || "OK"}).`;
        setRetryFeedback({
          type: "success",
          message: res.message || defaultOkMsg,
        });
        if (res.dispatch) {
          setSelectedNotifDetail((prev) => (prev ? { ...prev, dispatch: res.dispatch as any } : null));
        } else {
          setSelectedNotifDetail((prev) =>
            prev
              ? {
                  ...prev,
                  dispatch: {
                    ...(prev.dispatch || {
                      id: "generated-id",
                      appointmentId: apt.id,
                      channel,
                      provider: channel === "WHATSAPP" ? "PONTIUN" : "RESEND",
                      attempts: 1,
                      requestedAt: new Date().toISOString(),
                      createdAt: new Date().toISOString(),
                    }),
                    status: (res.status as any) || "SENT",
                    providerMessageId: res.providerMessageId || null,
                    errorCode: null,
                    errorDescription: null,
                    updatedAt: new Date().toISOString(),
                  } as any,
                }
              : null,
          );
        }
        await data.refresh({ silent: true });
      } else {
        setRetryFeedback({
          type: "error",
          message: res.error || "No se pudo reenviar la notificación.",
        });
        if (res.dispatch) {
          setSelectedNotifDetail((prev) => (prev ? { ...prev, dispatch: res.dispatch as any } : null));
        }
        await data.refresh({ silent: true });
      }
    } catch (err) {
      setRetryFeedback({
        type: "error",
        message: `Error al reenviar: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setRetryingNotif(false);
    }
  }
  return (
    <main className="v2-page v2-appointments-page">
      <AdminFilterPanel
        ariaLabel="Filtros de turnos"
        className={
          period === "CUSTOM"
            ? "v2-turnos-filter-panel is-custom-range"
            : "v2-turnos-filter-panel"
        }
        footer={
          period === "CUSTOM" && isInvalidRange ? (
            <div className="v2-custom-range-row">
              <p className="v2-range-warning" role="alert">
                La fecha &apos;Fecha hasta&apos; debe ser igual o posterior a &apos;Fecha&apos;.
              </p>
            </div>
          ) : null
        }
      >
        <AdminFilterCell label="Período" htmlFor="v2-appointments-period">
          <select
            id="v2-appointments-period"
            value={period}
            onChange={(e) => handlePeriodChange(e.target.value as V2AgendaPeriodPreset)}
          >
            {v2AgendaPeriodOrder.map((preset) => (
              <option key={preset} value={preset}>
                {formatV2AgendaPeriodLabel(preset, today)}
              </option>
            ))}
          </select>
        </AdminFilterCell>
        <AdminFilterCell label="Barbero" htmlFor="v2-appointments-barber">
          <select
            id="v2-appointments-barber"
            value={isStaffOperator(staff.profile.role) ? data.barberId : (staff.profile.barber_id ?? "")}
            onChange={(e) => data.setBarberId(e.target.value)}
            disabled={!isStaffOperator(staff.profile.role)}
          >
            {isStaffOperator(staff.profile.role) && <option value="ALL">Todo Kani</option>}
            {staff.barbers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </AdminFilterCell>
        <AdminFilterCell
          label={period === "CUSTOM" ? "Fecha desde" : "Fecha"}
          htmlFor="v2-appointments-date"
        >
          <input
            id="v2-appointments-date"
            type="date"
            value={date}
            onChange={(e) => handleDateChange(e.target.value)}
          />
        </AdminFilterCell>
        {period === "CUSTOM" && (
          <AdminFilterCell label="Fecha hasta" htmlFor="v2-appointments-custom-end">
            <input
              id="v2-appointments-custom-end"
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
            />
          </AdminFilterCell>
        )}
        <AdminFilterCell
          label="Estado"
          htmlFor="v2-appointments-status"
          className={period === "CUSTOM" ? "v2-turnos-status-full" : undefined}
        >
          <select
            id="v2-appointments-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="ALL">Todos</option>
            <option value="CONFIRMED">Confirmado</option>
            <option value="CANCELLED">Cancelado</option>
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
              ? "Revisá el rango seleccionado: la fecha 'Fecha hasta' debe ser igual o posterior a 'Fecha'."
              : "No hay turnos para esta selección. Podés consultar otro día."}
          </Empty>
        )}
        {rows.map((a) => {
          const isFinished = isAppointmentTemporallyFinished(a);
          const waDirectUrl = getWhatsAppDirectSendUrl(a.phone);
          const canOperate =
            isStaffOperator(staff.profile.role) || a.barberId === staff.profile.barber_id;
          const canCancel = ["PENDING", "CONFIRMED"].includes(a.statusCode) && canOperate;
          const canEditManual =
            a.isManual && ["PENDING", "CONFIRMED"].includes(a.statusCode) && canOperate;
          const isDrawerOpen = Boolean(expandedDrawers[a.id]);
          const timeRangeLabel = a.endTime ? `${a.time}–${a.endTime}` : a.time;
          const depositText = data.depositSupported
            ? a.depositPaid
              ? money(a.depositAmountArs ?? 5000)
              : "No abonada"
            : "Sin dato verificable";

          if (isMobileCard) {
            const isCancelled = a.statusCode === "CANCELLED";
            const waFailed = a.dispatches?.whatsapp?.status === "FAILED";
            const emailFailed = a.dispatches?.email?.status === "FAILED";
            const hasFailedNotif = waFailed || emailFailed;
            const mobileArticleClasses = [
              "v2-appointment",
              "v2-appointment--mobile-wide",
              isFinished ? "v2-appointment--past" : "",
              isCancelled ? "v2-appointment--cancelled" : "",
              isDrawerOpen ? "v2-appointment--drawer-open" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <article className={mobileArticleClasses} key={a.id}>
                <div className="v2-appointment-main">
                  {/* Nivel 1: 10:00–10:30 | Nombre a la izquierda + badges a la derecha */}
                  <div className="v2-app-row-1 v2-app-row-1--mobile">
                    <div className="v2-app-mobile-identity">
                      <strong className="v2-app-time">{timeRangeLabel}</strong>
                      <span className="v2-app-sep">|</span>
                      <h3 className="v2-app-name" title={a.name}>
                        {a.name}
                      </h3>
                    </div>
                    <div className="v2-app-mobile-badges">
                      {a.isManual && <span className="v2-manual-badge">Manual</span>}
                      <Status code={a.statusCode} />
                      {isFinished && (
                        <span className="v2-past-badge">Horario finalizado</span>
                      )}
                    </div>
                  </div>

                  {/* Nivel 2: Servicio · Barbero · $Importe [· Seña $X] [· Lun 23/11] [· ⚠️ Error aviso] */}
                  <div className="v2-app-row-2 v2-app-row-2--mobile">
                    <div className="v2-app-mobile-meta">
                      <span className="v2-app-service">{formatServiceName(a.serviceName)}</span>
                      <span className="v2-app-dot">·</span>
                      <span className="v2-app-barber">{a.barber}</span>
                      <span className="v2-app-dot">·</span>
                      <span className="v2-app-price">{money(a.servicePrice ?? 0)}</span>
                      {data.depositSupported && a.depositPaid && (
                        <>
                          <span className="v2-app-dot">·</span>
                          <span className="v2-app-deposit v2-app-deposit--paid">
                            Seña {money(a.depositAmountArs ?? 5000)}
                          </span>
                        </>
                      )}
                      {!data.depositSupported && (
                        <>
                          <span className="v2-app-dot">·</span>
                          <span className="v2-app-deposit">Sin dato verificable</span>
                        </>
                      )}
                      {isMultiDay && (
                        <>
                          <span className="v2-app-dot">·</span>
                          <span className="v2-app-date">{formatShortMobileDate(a.date)}</span>
                        </>
                      )}
                      {hasFailedNotif && (
                        <>
                          <span className="v2-app-dot">·</span>
                          <button
                            type="button"
                            className="v2-app-notif-error-btn"
                            onClick={() => {
                              setSelectedNotifDetail({
                                appointment: a,
                                channel: waFailed ? "WhatsApp" : "Email",
                                dispatch: waFailed ? a.dispatches?.whatsapp : a.dispatches?.email,
                              });
                              setRetryFeedback(null);
                            }}
                            aria-label={
                              waFailed
                                ? `Error en aviso de WhatsApp: ${formatWhatsAppStatus(a.dispatches?.whatsapp)}`
                                : `Error en aviso de Email: ${formatEmailStatus(a.dispatches?.email)}`
                            }
                          >
                            <span aria-hidden="true">⚠️</span>
                            <span>Error aviso</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {a.notes && <p className="v2-note">{a.notes}</p>}
                </div>

                {/* Barra principal 50/50 (CONFIRMED: Cobrar + Opciones) o 100% (Opciones) */}
                <div className="v2-appointment-actions v2-appointment-actions--mobile">
                  <div
                    className={
                      a.statusCode === "CONFIRMED"
                        ? "v2-app-mobile-bar v2-app-mobile-bar--split"
                        : "v2-app-mobile-bar v2-app-mobile-bar--single"
                    }
                  >
                    {a.statusCode === "CONFIRMED" && (
                      <Link
                        className="v2-primary v2-action-btn v2-cobrar-btn v2-mobile-bar-primary"
                        to={paymentsTo}
                        search={{ turno: a.id }}
                      >
                        Cobrar
                      </Link>
                    )}
                    <button
                      type="button"
                      className="v2-secondary v2-action-btn v2-mobile-bar-options"
                      aria-expanded={isDrawerOpen}
                      aria-controls={`v2-mobile-drawer-${a.id}`}
                      onClick={() => toggleDrawer(a.id)}
                    >
                      <span>Opciones</span>
                      {isDrawerOpen ? (
                        <ChevronUp size={15} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={15} aria-hidden="true" />
                      )}
                    </button>
                  </div>

                  {isDrawerOpen && (
                    <div
                      id={`v2-mobile-drawer-${a.id}`}
                      className="v2-app-mobile-drawer v2-app-mobile-drawer--two-rows"
                    >
                      {/* Fila 1 (Contacto): WhatsApp + Mail (50/50 si tiene email, 100% si no) */}
                      <div className="v2-mobile-drawer-row v2-mobile-drawer-row--contact">
                        {waDirectUrl ? (
                          <a
                            className="v2-secondary v2-whatsapp v2-action-btn v2-mobile-drawer-btn"
                            href={waDirectUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="WhatsApp"
                            title="Abrir conversación de WhatsApp con el cliente"
                          >
                            <span aria-hidden="true">💬</span>
                            <span>WhatsApp</span>
                          </a>
                        ) : (
                          <button
                            type="button"
                            className="v2-secondary v2-whatsapp v2-action-btn v2-mobile-drawer-btn"
                            onClick={() => handleWhatsAppInvalid(a)}
                            aria-label="WhatsApp"
                            title={
                              !a.phone || !a.phone.trim()
                                ? "El cliente no tiene un teléfono registrado"
                                : "Número de teléfono inválido o ambiguo para WhatsApp"
                            }
                          >
                            <span aria-hidden="true">💬</span>
                            <span>WhatsApp</span>
                          </button>
                        )}
                        {a.email && (
                          <a
                            className="v2-secondary v2-mail-btn v2-action-btn v2-mobile-drawer-btn"
                            href={`mailto:${a.email}`}
                            aria-label="Mail"
                          >
                            <Mail size={15} aria-hidden="true" />
                            <span>Mail</span>
                          </a>
                        )}
                      </div>

                      {/* Fila 2 (Gestión y diagnóstico): Avisos + Editar + Cancelar */}
                      <div className="v2-mobile-drawer-row v2-mobile-drawer-row--manage">
                        <button
                          type="button"
                          className="v2-secondary v2-action-btn v2-mobile-drawer-btn"
                          onClick={() => {
                            setSelectedNotifDetail({
                              appointment: a,
                              channel: emailFailed && !waFailed ? "Email" : "WhatsApp",
                              dispatch: emailFailed && !waFailed ? a.dispatches?.email : a.dispatches?.whatsapp,
                            });
                            setRetryFeedback(null);
                          }}
                        >
                          <Bell size={14} aria-hidden="true" />
                          <span>Avisos</span>
                        </button>
                        {canEditManual && (
                          <button
                            type="button"
                            className="v2-secondary v2-action-btn v2-mobile-drawer-btn"
                            disabled={busy}
                            onClick={() =>
                              setManualDialog({ open: true, mode: "EDIT", appointment: a })
                            }
                          >
                            <Pencil size={14} aria-hidden="true" />
                            <span>Editar</span>
                          </button>
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            className="v2-destructive action-reject v2-action-btn v2-mobile-drawer-btn v2-mobile-drawer-cancel"
                            disabled={busy}
                            onClick={() => setAction({ appointment: a, status: "CANCELLED" })}
                          >
                            <X size={14} aria-hidden="true" />
                            <span>Cancelar</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          }

          return (
            <article
              className={isFinished ? "v2-appointment v2-appointment--past" : "v2-appointment"}
              key={a.id}
            >
              <div className="v2-appointment-main">
                {/* Fila 1: 10:00 | Matias Zarate | Estado */}
                <div className="v2-app-row-1">
                  <strong className="v2-app-time">{a.time}</strong>
                  <span className="v2-app-sep">|</span>
                  <h3 className="v2-app-name" title={a.name}>{a.name}</h3>
                  {a.isManual && <span className="v2-manual-badge">Manual</span>}
                  <Status code={a.statusCode} />
                  {isFinished && (
                    <span className="v2-past-badge">Horario finalizado</span>
                  )}
                </div>

                {/* Fila 2: 10:45 · Corte · Lautaro (· Fecha si isMultiDay) */}
                <div className="v2-app-row-2">
                  {a.endTime && (
                    <>
                      <span className="v2-app-endtime">{a.endTime}</span>
                      <span className="v2-app-dot">·</span>
                    </>
                  )}
                  <span className="v2-app-service">{formatServiceName(a.serviceName)}</span>
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

                {/* Fila 4: Diagnóstico compacto y accesible de notificaciones */}
                <div className="v2-app-notifications">
                  <div className="v2-notif-channel">
                    <span className="v2-notif-icon" aria-hidden="true">💬</span>
                    <button
                      type="button"
                      className={`v2-notif-pill v2-notif-${(a.dispatches?.whatsapp?.status || "PENDING").toLowerCase()}`}
                      onClick={() => {
                        setSelectedNotifDetail({
                          appointment: a,
                          channel: "WhatsApp",
                          dispatch: a.dispatches?.whatsapp,
                        });
                        setRetryFeedback(null);
                      }}
                      title="Ver diagnóstico completo de WhatsApp"
                      aria-label={`Diagnóstico WhatsApp: ${formatWhatsAppStatus(a.dispatches?.whatsapp)}`}
                    >
                      <span>{formatWhatsAppStatus(a.dispatches?.whatsapp)}</span>
                      <Info size={12} className="v2-notif-info-icon" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="v2-notif-channel">
                    <span className="v2-notif-icon" aria-hidden="true">✉️</span>
                    <button
                      type="button"
                      className={`v2-notif-pill v2-notif-${(a.dispatches?.email?.status || "PENDING").toLowerCase()}`}
                      onClick={() => {
                        setSelectedNotifDetail({
                          appointment: a,
                          channel: "Email",
                          dispatch: a.dispatches?.email,
                        });
                        setRetryFeedback(null);
                      }}
                      title="Ver diagnóstico completo de Email"
                      aria-label={`Diagnóstico Email: ${formatEmailStatus(a.dispatches?.email)}`}
                    >
                      <span>{formatEmailStatus(a.dispatches?.email)}</span>
                      <Info size={12} className="v2-notif-info-icon" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {a.notes && <p className="v2-note">{a.notes}</p>}
              </div>

              <div className="v2-appointment-actions">
                {(() => {
                  const actionNodes: React.ReactNode[] = [];
                  if (a.statusCode === "CONFIRMED") {
                    actionNodes.push(
                      <Link
                        key="cobrar"
                        className="v2-primary v2-action-btn v2-cobrar-btn"
                        to={paymentsTo}
                        search={{ turno: a.id }}
                      >
                        Cobrar
                      </Link>,
                    );
                  }
                  if (
                    ["PENDING", "CONFIRMED"].includes(a.statusCode) &&
                    (isStaffOperator(staff.profile.role) || a.barberId === staff.profile.barber_id)
                  ) {
                    actionNodes.push(
                      <button
                        key="cancel"
                        type="button"
                        className="v2-destructive action-reject v2-action-btn"
                        disabled={busy}
                        onClick={() => setAction({ appointment: a, status: "CANCELLED" })}
                      >
                        Cancelar turno
                      </button>,
                    );
                  }
                  if (
                    a.isManual &&
                    ["PENDING", "CONFIRMED"].includes(a.statusCode) &&
                    (isStaffOperator(staff.profile.role) || a.barberId === staff.profile.barber_id)
                  ) {
                    actionNodes.push(
                      <button
                        key="edit"
                        type="button"
                        className="v2-secondary v2-action-btn"
                        disabled={busy}
                        onClick={() =>
                          setManualDialog({ open: true, mode: "EDIT", appointment: a })
                        }
                      >
                        Editar
                      </button>,
                    );
                  }
                  if (waDirectUrl) {
                    actionNodes.push(
                      <a
                        key="whatsapp"
                        className="v2-secondary v2-whatsapp v2-action-btn"
                        href={waDirectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir conversación de WhatsApp con el cliente"
                      >
                        <WhatsAppLabel />
                      </a>,
                    );
                  } else {
                    actionNodes.push(
                      <button
                        key="whatsapp"
                        type="button"
                        className="v2-secondary v2-whatsapp v2-action-btn"
                        onClick={() => handleWhatsAppInvalid(a)}
                        title={
                          !a.phone || !a.phone.trim()
                            ? "El cliente no tiene un teléfono registrado"
                            : "Número de teléfono inválido o ambiguo para WhatsApp"
                        }
                      >
                        <WhatsAppLabel />
                      </button>,
                    );
                  }
                  if (a.email) {
                    actionNodes.push(
                      <a
                        key="mail"
                        className="v2-secondary v2-mail-btn v2-action-btn"
                        href={`mailto:${a.email}`}
                      >
                        <Mail size={16} />
                        <span>Mail</span>
                      </a>,
                    );
                  }

                  return (
                    <div className={`v2-appointment-actions-grid count-${actionNodes.length}`}>
                      {actionNodes}
                    </div>
                  );
                })()}
              </div>
            </article>
          );
        })}
      </div>
      <ManualAppointmentDialog
        open={manualDialog.open}
        mode={manualDialog.mode}
        appointment={manualDialog.appointment}
        initialDate={
          period === "TODAY" || period === "DATE" || period === "CUSTOM"
            ? date
            : today
        }
        onClose={() => setManualDialog((prev) => ({ ...prev, open: false }))}
        onSuccess={(msg) => {
          setMessage(msg);
          showToast(msg, "success");
        }}
      />
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null);
        }}
      >
        <DialogContent className="v2-dialog" transitionMode="container-transform">
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
      <Dialog
        open={!!whatsAppModal}
        onOpenChange={(open) => {
          if (!open) setWhatsAppModal(null);
        }}
      >
        <DialogContent className="v2-dialog">
          {whatsAppModal?.mode === "NO_PHONE" && (
            <>
              <DialogTitle>Sin número de contacto</DialogTitle>
              <DialogDescription>
                Este turno no tiene registrado un número de teléfono celular para abrir la conversación de WhatsApp.
              </DialogDescription>
              <div className="v2-dialog-actions" style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                <button className="v2-secondary" onClick={() => setWhatsAppModal(null)}>
                  Aceptar
                </button>
              </div>
            </>
          )}
          {whatsAppModal?.mode === "INVALID_PHONE" && (
            <>
              <DialogTitle>Número de teléfono inválido o ambiguo</DialogTitle>
              <DialogDescription>
                El teléfono registrado ({whatsAppModal.appointment.phone}) no tiene un formato internacional válido o le falta el código de país. Editá el cliente o agregá el código de país completo antes de abrir WhatsApp.
              </DialogDescription>
              <div className="v2-dialog-actions" style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                <button className="v2-secondary" onClick={() => setWhatsAppModal(null)}>
                  Aceptar
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selectedNotifDetail}
        onOpenChange={(open) => {
          if (!open && !retryingNotif) {
            setSelectedNotifDetail(null);
            setRetryFeedback(null);
          }
        }}
      >
        <DialogContent className="v2-dialog" transitionMode="container-transform">
          <DialogTitle>Diagnóstico de notificación: {selectedNotifDetail?.channel}</DialogTitle>
          <DialogDescription>
            Detalle técnico del canal de notificación registrado en Supabase.
          </DialogDescription>
          {selectedNotifDetail?.appointment && (
            <div style={{ marginTop: "10px", padding: "10px 12px", background: "var(--v2-inset, rgba(255,255,255,0.04))", borderRadius: "6px", fontSize: "13px", display: "flex", flexDirection: "column", gap: "4px" }}>
              <p><strong>Cliente:</strong> {selectedNotifDetail.appointment.name} {selectedNotifDetail.appointment.phone ? `(${selectedNotifDetail.appointment.phone})` : ""}</p>
              {selectedNotifDetail.channel === "Email" && (
                <p><strong>Correo:</strong> {selectedNotifDetail.appointment.email || (selectedNotifDetail.appointment as any).clientEmail || selectedNotifDetail.dispatch?.recipient || "No registrado"}</p>
              )}
              <p><strong>Turno:</strong> {dateLabel(selectedNotifDetail.appointment.date || "")} {(selectedNotifDetail.appointment.startTime || selectedNotifDetail.appointment.time || "").slice(0, 5)} hs — {formatServiceName(selectedNotifDetail.appointment.serviceName) || "Servicio"}</p>
              <p><strong>Estado del turno:</strong> <span className={`v2-status-badge v2-status-${(selectedNotifDetail.appointment.statusCode || "CONFIRMED").toLowerCase()}`}>{statusLabels[selectedNotifDetail.appointment.statusCode] || selectedNotifDetail.appointment.statusCode || "Confirmado"}</span></p>
            </div>
          )}
          {selectedNotifDetail?.dispatch ? (
            <div className="v2-diagnostics-box" style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
              <p>
                <strong>Estado:</strong>{" "}
                <span className={`v2-notif-pill v2-notif-${(selectedNotifDetail.dispatch.status || "pending").toLowerCase()}`}>
                  {formatDispatchDetailedStatus(selectedNotifDetail.dispatch.status)}
                </span>
                {(selectedNotifDetail.dispatch.status === "SENT" || selectedNotifDetail.dispatch.status === "PROVIDER_ACCEPTED") && (
                  <span style={{ marginLeft: "6px", fontSize: "11.5px", color: "var(--muted-foreground)" }}>
                    (Aceptado por proveedor; entrega no confirmada aún)
                  </span>
                )}
              </p>
              <p><strong>Proveedor:</strong> {selectedNotifDetail.dispatch.provider || (selectedNotifDetail.channel === "WhatsApp" ? "PONTIUN" : "RESEND")}</p>
              {selectedNotifDetail.dispatch.recipient && (
                <p><strong>Destinatario:</strong> {selectedNotifDetail.dispatch.recipient}</p>
              )}
              {selectedNotifDetail.dispatch.attempts !== undefined && (
                <p><strong>Intentos:</strong> {selectedNotifDetail.dispatch.attempts}</p>
              )}
              {selectedNotifDetail.dispatch.providerMessageId && (
                <p><strong>ID de mensaje:</strong> <code>{selectedNotifDetail.dispatch.providerMessageId}</code></p>
              )}
              {selectedNotifDetail.dispatch.errorCode && (
                <p><strong>Código de error:</strong> <code>{selectedNotifDetail.dispatch.errorCode}</code></p>
              )}
              {selectedNotifDetail.dispatch.errorDescription && (
                <p><strong>Detalle:</strong> {selectedNotifDetail.dispatch.errorDescription}</p>
              )}
              {selectedNotifDetail.dispatch.updatedAt && (
                <p><strong>Última actualización:</strong> {selectedNotifDetail.dispatch.updatedAt.replace("T", " ").slice(0, 19)}</p>
              )}
            </div>
          ) : (
            <div style={{ marginTop: "12px", fontSize: "13px" }}>
              <p style={{ color: "var(--muted-foreground)" }}>
                No hay despacho registrado para este canal.
              </p>
              {selectedNotifDetail?.channel === "Email" && (
                <p style={{ marginTop: "6px" }}>
                  <strong>Destinatario configurado:</strong> {selectedNotifDetail.appointment.email || (selectedNotifDetail.appointment as any).clientEmail || "El cliente no posee correo electrónico registrado"}
                </p>
              )}
            </div>
          )}

          {/* Avisos explicativos unificados para WhatsApp y Email */}
          {selectedNotifDetail?.appointment && (() => {
            const appt = selectedNotifDetail.appointment;
            const apptStatus = (appt.statusCode || (appt as any).status || "").toUpperCase();
            const isConfirmed = apptStatus === "CONFIRMED" || apptStatus === "CONFIRMADO";
            const isCancelled = apptStatus === "CANCELLED" || apptStatus === "CANCELADO";
            const isEmail = selectedNotifDetail.channel === "Email";
            const clientRecipient = isEmail
              ? (appt.email || (appt as any).clientEmail || selectedNotifDetail.dispatch?.recipient)
              : (appt.phone || selectedNotifDetail.dispatch?.recipient);

            return (
              <>
                {!isConfirmed && !isCancelled && (
                  <div className="v2-note" style={{ marginTop: "12px", borderLeftColor: "#eab308" }}>
                    El estado actual del turno es <strong>{statusLabels[appt.statusCode] || appt.statusCode || "Pendiente"}</strong>. Solo los turnos confirmados o cancelados admiten el reenvío de notificaciones.
                  </div>
                )}
                {!clientRecipient && (isConfirmed || isCancelled) && (
                  <div className="v2-note" style={{ marginTop: "12px", borderLeftColor: "#ef4444" }}>
                    {isEmail
                      ? "El cliente no posee un correo electrónico registrado. Para despachar la notificación, editá el turno o completá su correo en Clientes."
                      : "El cliente no posee un número de teléfono registrado para enviar la notificación por WhatsApp."}
                  </div>
                )}
                {!isEmail && selectedNotifDetail.dispatch?.errorCode === "131042" && (
                  <div className="v2-note" style={{ marginTop: "12px", borderLeftColor: "#ef4444" }}>
                    Meta rechazó el envío por configuración de facturación pendiente (código 131042). Resolvé la moneda de la cuenta en Meta Business Suite antes de reenviar.
                  </div>
                )}
                {!isEmail && selectedNotifDetail.dispatch?.errorCode === "TEMPLATE_NOT_APPROVED" && (
                  <div className="v2-note" style={{ marginTop: "12px", borderLeftColor: "#eab308" }}>
                    ⏳ <strong>Plantilla pendiente en Meta:</strong> la plantilla oficial aún no está aprobada o sincronizada en Meta/Pontiun. Una vez aprobada, podés reenviar manualmente desde este modal.
                  </div>
                )}
                {(selectedNotifDetail.dispatch?.status === "DELIVERED" || selectedNotifDetail.dispatch?.status === "READ") && (
                  <div className="v2-note" style={{ marginTop: "12px", borderLeftColor: "#10b981" }}>
                    ✓ Último envío confirmado como entregado. Podés reenviar la notificación manualmente si el cliente necesita recibirla nuevamente.
                  </div>
                )}
                {selectedNotifDetail.dispatch?.status === "PROCESSING" && (
                  <div className="v2-note" style={{ marginTop: "12px", borderLeftColor: "#0ea5e9" }}>
                    ⏳ Existe una solicitud de envío en procesamiento para este canal.
                  </div>
                )}
              </>
            );
          })()}

          {/* Banner de retroalimentación de reenvío */}
          {retryFeedback && (
            <div
              role="status"
              style={{
                marginTop: "12px",
                padding: "8px 12px",
                borderRadius: "6px",
                fontSize: "12.5px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                backgroundColor: retryFeedback.type === "success" ? "rgba(16, 185, 129, 0.12)" : "rgba(239, 68, 68, 0.12)",
                border: `1px solid ${retryFeedback.type === "success" ? "rgba(16, 185, 129, 0.35)" : "rgba(239, 68, 68, 0.35)"}`,
                color: retryFeedback.type === "success" ? "#10b981" : "#ef4444",
              }}
            >
              <span>{retryFeedback.type === "success" ? "✓" : "✕"}</span>
              <span>{retryFeedback.message}</span>
            </div>
          )}

          <div className="v2-dialog-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
            <button className="v2-secondary" disabled={retryingNotif} onClick={() => setSelectedNotifDetail(null)}>
              Cerrar
            </button>
            {(() => {
              if (!selectedNotifDetail?.appointment) return null;
              const appt = selectedNotifDetail.appointment;
              const apptStatus = (appt.statusCode || (appt as any).status || "").toUpperCase();
              const isConfirmed = apptStatus === "CONFIRMED" || apptStatus === "CONFIRMADO";
              const isCancelled = apptStatus === "CANCELLED" || apptStatus === "CANCELADO";
              const canAccessAppt = isStaffOperator(staff.profile.role) || appt.barberId === staff.profile.barber_id;
              if ((!isConfirmed && !isCancelled) || !canAccessAppt) return null;

              const isEmail = selectedNotifDetail.channel === "Email";
              const recipient = isEmail
                ? (appt.email || (appt as any).clientEmail || selectedNotifDetail.dispatch?.recipient)
                : (appt.phone || selectedNotifDetail.dispatch?.recipient);
              const isMetaBlocked = !isEmail && selectedNotifDetail.dispatch?.errorCode === "131042";

              return (
                <button
                  type="button"
                  className="v2-primary"
                  disabled={retryingNotif || !recipient || isMetaBlocked}
                  onClick={() => void handleResendNotificationModal()}
                  title={
                    !recipient
                      ? isEmail
                        ? "El cliente no tiene correo electrónico registrado"
                        : "El cliente no tiene teléfono registrado"
                      : isMetaBlocked
                        ? "Bloqueado por configuración de facturación en Meta (131042)"
                        : `Reenviar notificación de ${isCancelled ? "cancelación" : "confirmación"} por ${selectedNotifDetail.channel}`
                  }
                >
                  {retryingNotif ? "Enviando…" : "Reenviar notificación del turno"}
                </button>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
      {toastState &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className={`kani-v2-toast is-${toastState.variant}`}
            role={toastState.variant === "error" ? "alert" : "status"}
            aria-live={toastState.variant === "error" ? "assertive" : "polite"}
          >
            {toastState.variant === "error" ? (
              <AlertCircle size={16} strokeWidth={2} className="kani-v2-toast-icon" aria-hidden="true" />
            ) : (
              <Check size={16} strokeWidth={2.2} className="kani-v2-toast-icon" aria-hidden="true" />
            )}
            <span className="kani-v2-toast-text">{toastState.text}</span>
          </div>,
          document.body,
        )}
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
      return "WhatsApp: Aceptado";
    case "SENT":
      return "WhatsApp: Enviado";
    case "FAILED":
      if (dispatch.errorCode === "131042") {
        return "WhatsApp: Error 131042";
      }
      if (dispatch.errorCode === "TEMPLATE_NOT_APPROVED") {
        return "WhatsApp: Plantilla pendiente";
      }
      return `WhatsApp: Error ${dispatch.errorCode || ""}`.trim();
    case "SKIPPED":
      return "WhatsApp: Omitido";
    default:
      return `WhatsApp: ${dispatch.status}`;
  }
}

function formatEmailStatus(dispatch?: NotificationChannelDispatch): string {
  if (!dispatch) return "Email: Pendiente";
  switch (dispatch.status) {
    case "DELIVERED":
      return "Email: Entregado";
    case "SENT":
    case "PROVIDER_ACCEPTED":
      return "Email: Aceptado";
    case "FAILED":
      return "Email: Error";
    case "SKIPPED":
      return "Email: Omitido";
    default:
      return `Email: ${dispatch.status}`;
  }
}

function formatDispatchDetailedStatus(status?: string): string {
  switch (status) {
    case "SENT":
    case "PROVIDER_ACCEPTED":
      return "Aceptado por proveedor (en tránsito)";
    case "DELIVERED":
      return "Entrega confirmada por proveedor";
    case "READ":
      return "Leído";
    case "PROCESSING":
      return "En procesamiento";
    case "PENDING":
      return "Pendiente de despacho";
    case "FAILED":
      return "Error en el envío";
    case "SKIPPED":
      return "Omitido";
    default:
      return status || "Pendiente";
  }
}

function WhatsAppLabel() {
  return <><svg className="v2-whatsapp-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
        </svg><span>WhatsApp</span></>;
}
