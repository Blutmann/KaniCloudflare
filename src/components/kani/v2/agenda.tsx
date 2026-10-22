import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, Clock3, Mail, Phone } from "lucide-react";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { businessDateToday, addCalendarDays } from "@/lib/kani-mobile-appointments";
import { businessTimeNow } from "@/lib/kani-payments";
import { money, dateLabel } from "@/lib/kani-model";
import { paymentSummary, scopeV2 } from "@/lib/kani-v2";
import {
  appointmentErrorMessage,
  updateRealAppointmentStatus,
  retryRealAppointmentNotification,
  type RealAppointment,
} from "@/lib/kani-appointments";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useV2 } from "./data";
import { BarberFilter, Empty, Metric, Status, statusLabels } from "./shared";

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
              label="Por confirmar"
              value={daily.filter((a) => a.statusCode === "PENDING").length}
            />
            <Metric
              label="Cobrado en el local"
              value={money(paymentSummary(payments).collected)}
              note={`${payments.length} servicios registrados`}
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

export function V2Appointments() {
  const data = useV2();
  const staff = useAdminStaff();
  const today = businessDateToday();
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState("ALL");
  const [period, setPeriod] = useState("DAY");
  const [action, setAction] = useState<{
    appointment: RealAppointment;
    status: "CONFIRMED" | "CANCELLED";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const rows = scopeV2(
    data.appointments,
    staff.profile.role,
    staff.profile.barber_id,
    data.barberId,
  ).filter(
    (a) =>
      a.date >= date &&
      a.date <= (period === "WEEK" ? addCalendarDays(date, 6) : date) &&
      (status === "ALL" || a.statusCode === status),
  );
  async function confirmAction() {
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
  async function notify(id: string) {
    setBusy(true);
    setMessage("");
    try {
      await retryRealAppointmentNotification(id);
      setMessage("Solicitud de notificación procesada.");
    } catch (e) {
      setMessage(appointmentErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="v2-page">
      <div className="v2-filters">
        <label className="v2-field">
          Período
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="DAY">Un día</option>
            <option value="WEEK">Próximos 7 días</option>
          </select>
        </label>
        <label className="v2-field">
          Fecha
          <input type="date" value={date} onChange={(e) => setDate(e.target.value || today)} />
        </label>
        <BarberFilter />
        <label className="v2-field">
          Estado
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ALL">Todos</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="v2-section-title">
        <h2>{dateLabel(date)}</h2>
        <span>{rows.length} turnos</span>
      </div>
      {message && (
        <p className="v2-alert" role="status">
          {message}
        </p>
      )}
      <div className="v2-agenda">
        {!rows.length && (
          <Empty>No hay turnos para esta selección. Podés consultar otro día.</Empty>
        )}
        {rows.map((a) => (
          <article className="v2-appointment" key={a.id}>
            <div className="v2-time">
              <strong>{a.time}</strong>
              <small>{a.endTime ?? ""}</small>
            </div>
            <div className="v2-appointment-body">
              <div className="v2-appointment-heading">
                <h3>{a.name}</h3>
                <Status code={a.statusCode} />
              </div>
              <p>
                {a.serviceName} <span>· {a.barber}</span>
              </p>
              {period === "WEEK" && <p>{dateLabel(a.date)}</p>}
              <div className="v2-appointment-details">
                <span>
                  Seña:{" "}
                  {data.depositSupported
                    ? a.depositPaid
                      ? money(a.depositAmountArs ?? 5000)
                      : "No abonada"
                    : "Sin dato verificable"}
                </span>
                <span>Catálogo actual: {money(a.servicePrice ?? 0)}</span>
              </div>
              {a.notes && <p className="v2-note">{a.notes}</p>}
              <div className="v2-contact">
                {a.phone && (
                  <a href={`tel:${a.phone.replace(/[^+\d]/g, "")}`}>
                    <Phone size={14} />
                    {a.phone}
                  </a>
                )}
                {a.email && (
                  <a href={`mailto:${a.email}`}>
                    <Mail size={14} />
                    <span>{a.email}</span>
                  </a>
                )}
              </div>
            </div>
            <div className="v2-appointment-actions">
              {a.statusCode === "PENDING" && (
                <button
                  className="v2-primary action-confirm"
                  disabled={busy}
                  onClick={() => setAction({ appointment: a, status: "CONFIRMED" })}
                >
                  Confirmar
                </button>
              )}
              {["PENDING", "CONFIRMED"].includes(a.statusCode) && (
                <button
                  className="v2-secondary action-reject"
                  disabled={busy}
                  onClick={() => setAction({ appointment: a, status: "CANCELLED" })}
                >
                  {a.statusCode === "PENDING" ? "Rechazar" : "Cancelar"}
                </button>
              )}
              {a.statusCode === "CONFIRMED" && (
                <Link className="v2-secondary" to="/admin-v2/pagos" search={{ turno: a.id }}>
                  Cobrar
                </Link>
              )}
              <button
                className="v2-quiet action-mail"
                disabled={busy || !a.email}
                onClick={() => void notify(a.id)}
              >
                Enviar correo
              </button>
            </div>
          </article>
        ))}
      </div>
      <p className="v2-footnote">
        Los estados visibles provienen del historial. La gestión de inasistencias y el motivo de
        cancelación se evaluarán en la siguiente etapa.
      </p>
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null);
        }}
      >
        <DialogContent className="v2-dialog">
          <DialogTitle>
            {action?.status === "CONFIRMED" ? "Confirmar turno" : "Cancelar turno"}
          </DialogTitle>
          <DialogDescription>
            {action?.appointment.name} · {action?.appointment.time}. Esta acción actualiza el turno
            y utiliza las notificaciones existentes.
          </DialogDescription>
          <button className="v2-primary" disabled={busy} onClick={() => void confirmAction()}>
            {busy ? "Guardando…" : "Confirmar acción"}
          </button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
