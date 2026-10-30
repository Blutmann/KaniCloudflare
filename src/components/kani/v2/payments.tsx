import { useRef, useState, type FormEvent } from "react";
import { useSearch } from "@tanstack/react-router";
import { CheckCircle2, Tag, Trash2, Edit2, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { businessDateToday, addCalendarDays } from "@/lib/kani-mobile-appointments";
import { money } from "@/lib/kani-model";
import { deduplicatePaymentMovements, paymentSummary, scopeV2 } from "@/lib/kani-v2";
import {
  deleteServicePayment,
  updateServicePayment,
  updateServicePaymentClient,
  calculatePaymentPeriodRange,
  getPaymentPeriodDynamicLabels,
  type PaymentPeriodFilter,
  type PaymentMethod,
  type ServicePayment,
  type ServicePaymentType,
} from "@/lib/kani-payments";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { BarberFilter, Empty } from "./shared";
import { useV2 } from "./data";

export function V2Payments() {
  const data = useV2();
  const staff = useAdminStaff();
  const isAdmin = staff.profile.role === "ADMIN";
  const today = businessDateToday();
  const search = useSearch({ from: "/admin-v2/pagos" });
  const [origin, setOrigin] = useState<"appointment" | "walk_in">(
    search.turno ? "appointment" : "walk_in",
  );
  const [appointmentId, setAppointmentId] = useState(search.turno ?? "");
  const [barberId, setBarberId] = useState(staff.profile.barber_id ?? staff.barbers[0]?.id ?? "");
  const [serviceName, setServiceName] = useState<string>("Corte");
  const [customServiceName, setCustomServiceName] = useState<string>("");
  const [priceOverride, setPriceOverride] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("Efectivo");
  const [discount, setDiscount] = useState(0);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showClient, setShowClient] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [period, setPeriod] = useState<PaymentPeriodFilter>("TODAY");
  const [customStartDate, setCustomStartDate] = useState(today);
  const [customEndDate, setCustomEndDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  // States for Editing and Deleting payments
  const [editingPayment, setEditingPayment] = useState<ServicePayment | null>(null);
  const [editBarberId, setEditBarberId] = useState("");
  const [editServiceName, setEditServiceName] = useState<ServicePaymentType>("Corte");
  const [editOtherDetail, setEditOtherDetail] = useState("");
  const [editPrice, setEditPrice] = useState(25000);
  const [editDiscount, setEditDiscount] = useState(0);
  const [editMethod, setEditMethod] = useState<PaymentMethod>("Efectivo");
  const [editClientName, setEditClientName] = useState("");
  const [editClientContact, setEditClientContact] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editError, setEditError] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const [editingClientPayment, setEditingClientPayment] = useState<ServicePayment | null>(null);
  const [deletingPayment, setDeletingPayment] = useState<ServicePayment | null>(null);
  const [actionNotice, setActionNotice] = useState("");

  const settled = new Set(
    data.payments.filter((p) => !p.isDepositMovement && p.appointmentId).map((p) => p.appointmentId),
  );
  const choices = data.appointments.filter(
    (a) => ["CONFIRMED", "COMPLETED"].includes(a.statusCode) && !settled.has(a.id) && a.date <= today,
  );
  const appointment =
    origin === "appointment" ? choices.find((a) => a.id === appointmentId) : undefined;
  const service = data.services.find((s) => s.name === serviceName);
  const price =
    priceOverride ?? (appointment ? (appointment.servicePrice ?? 0) : (service?.price ?? 0));
  const deposit = appointment?.depositPaid ? (appointment.depositAmountArs ?? 5000) : 0;
  const total = Math.max(0, price - discount - deposit);
  const dynamicLabels = getPaymentPeriodDynamicLabels(today);
  const periodRange = calculatePaymentPeriodRange(period, today, customStartDate, customEndDate);
  const isInvalidRange = period === "CUSTOM" && Boolean(periodRange.isInvalid);

  const history = isInvalidRange
    ? []
    : deduplicatePaymentMovements(
        scopeV2(
          data.payments,
          staff.profile.role,
          staff.profile.barber_id,
          data.barberId,
        ),
      ).filter(
        (p) =>
          p.paymentDate >= periodRange.start &&
          p.paymentDate <= periodRange.end,
      );
  const summary = paymentSummary(history);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setSuccess(false);
    setMessage("");
    if (origin === "appointment" && (!appointment || !data.depositSupported)) {
      setMessage("Seleccioná un turno con información de seña verificable.");
      return;
    }
    if (origin === "walk_in" && serviceName === "Otro" && !customServiceName.trim()) {
      setMessage("Ingresá el nombre del servicio personalizado.");
      return;
    }
    if (
      !Number.isInteger(price) ||
      price <= 0 ||
      !Number.isInteger(discount) ||
      discount < 0 ||
      discount > price - deposit
    ) {
      setMessage("Revisá el importe y el descuento. El total no puede ser menor que la seña.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const selected = data.clients.find((c) => c.id === clientId);
      const finalServiceName = appointment
        ? (appointment.serviceName || "Servicio")
        : (serviceName === "Otro" ? (customServiceName.trim() || "Otro") : serviceName);
      const finalOtherDetail = appointment
        ? (appointment.customServiceName || null)
        : (serviceName === "Otro" ? customServiceName.trim() : null);

      const { data: result, error } = await supabase.rpc("record_service_payment", {
        p_barber_id: appointment?.barberId ?? barberId,
        p_service_name: finalServiceName,
        p_service_other_detail: finalOtherDetail,
        p_service_price_ars: price,
        p_discount_ars: discount,
        p_payment_method: method,
        p_online_deposit_paid: !!appointment?.depositPaid,
        p_client_name:
          appointment?.name ?? (showClient ? (selected?.name ?? clientName.trim()) : ""),
        p_client_contact:
          appointment?.phone ?? (showClient ? (selected?.phone ?? clientPhone.trim()) : ""),
        p_appointment_id: appointment?.id ?? null,
      });
      if (error) throw error;
      if (!result?.length)
        throw new Error(
          "No se recibió confirmación del cobro. Revisá el historial antes de reintentar.",
        );
      setSuccess(true);
      setMessage("Cobro registrado.");
      setAppointmentId("");
      setDiscount(0);
      setPriceOverride(null);
      setCustomServiceName("");
      setShowClient(false);
      setClientId("");
      setClientName("");
      setClientPhone("");
      await data.refresh();
    } catch (e) {
      setMessage(
        `No se confirmó el cobro. Revisá el historial antes de reintentar. ${e && typeof e === "object" && "message" in e ? String(e.message) : ""}`,
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function openEditModal(p: ServicePayment) {
    setEditingPayment(p);
    setEditBarberId(p.barberId);
    setEditServiceName(p.serviceName);
    setEditOtherDetail(p.serviceOtherDetail || "");
    setEditPrice(p.servicePriceArs);
    setEditDiscount(p.discountArs || 0);
    setEditMethod(p.paymentMethod);
    setEditClientName(p.clientName || "");
    setEditClientContact(p.clientContact || "");
    setEditDate(p.paymentDate);
    setEditTime(p.paymentTime);
    setEditError("");
  }

  function openClientEditModal(p: ServicePayment) {
    setEditingClientPayment(p);
    setEditClientName(p.clientName || "");
    setEditClientContact(p.clientContact || "");
    setEditError("");
  }

  async function handleSavePayment(e: FormEvent) {
    e.preventDefault();
    if (!editingPayment) return;
    setEditBusy(true);
    setEditError("");
    try {
      await updateServicePayment(
        editingPayment.id,
        {
          barberId: editBarberId,
          serviceName: editServiceName,
          serviceOtherDetail: editServiceName === "Otros" ? editOtherDetail : undefined,
          servicePriceArs: editPrice,
          discountArs: editDiscount,
          paymentMethod: editMethod,
          clientName: editClientName,
          clientContact: editClientContact,
          paymentDate: editDate,
          paymentTime: editTime,
        },
        staff,
        editingPayment,
      );
      setEditingPayment(null);
      setActionNotice("Cobro actualizado exitosamente.");
      await data.refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Error al actualizar el cobro.");
    } finally {
      setEditBusy(false);
    }
  }

  async function handleSaveClientInfo(e: FormEvent) {
    e.preventDefault();
    if (!editingClientPayment) return;
    setEditBusy(true);
    setEditError("");
    try {
      await updateServicePaymentClient(
        editingClientPayment.id,
        editClientName,
        editClientContact,
      );
      setEditingClientPayment(null);
      setActionNotice("Datos de contacto actualizados correctamente.");
      await data.refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Error al actualizar contacto del cliente.");
    } finally {
      setEditBusy(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deletingPayment) return;
    setEditBusy(true);
    try {
      await deleteServicePayment(deletingPayment.id, staff);
      setDeletingPayment(null);
      setActionNotice("Cobro anulado con registro de trazabilidad.");
      await data.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al anular el cobro.");
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <main className="v2-page">
      {actionNotice && (
        <p role="status" className="v2-success" style={{ marginBottom: "1rem" }}>
          {actionNotice}
        </p>
      )}
      <div className="v2-payment-layout">
        <section className="v2-panel v2-payment-form">
          <div className="v2-segmented" aria-label="Origen del cobro">
            {(["walk_in", "appointment"] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={origin === value}
                onClick={() => {
                  setOrigin(value);
                  setPriceOverride(null);
                  setDiscount(0);
                }}
              >
                {value === "walk_in" ? "Sin turno" : "Con turno"}
              </button>
            ))}
          </div>
          <form onSubmit={(e) => void submit(e)}>
            <fieldset disabled={busy || data.loading}>
              {origin === "appointment" ? (
                <>
                  <label className="v2-field">
                    Turno
                    <select
                      value={appointmentId}
                      onChange={(e) => {
                        setAppointmentId(e.target.value);
                        setPriceOverride(null);
                        setDiscount(0);
                      }}
                    >
                      <option value="">Seleccionar turno confirmado</option>
                      {choices.map((a) => (
                        <option value={a.id} key={a.id}>
                          {a.name} · {a.serviceName} · {a.time} hs ({a.barber})
                        </option>
                      ))}
                    </select>
                  </label>
                  {appointment && (
                    <p className="v2-footnote">
                      {appointment.name} · {appointment.phone || "Sin celular"} · {appointment.date} · {appointment.time} hs
                    </p>
                  )}
                </>
              ) : (
                <>
                  {isAdmin && (
                    <label className="v2-field">
                      Barbero
                      <select value={barberId} onChange={(e) => setBarberId(e.target.value)}>
                        {staff.barbers.map((b) => (
                          <option value={b.id} key={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="v2-field">
                    Servicio
                    <select
                      value={serviceName}
                      onChange={(e) => {
                        setServiceName(e.target.value);
                        setPriceOverride(null);
                        setDiscount(0);
                      }}
                    >
                      {data.services.map((s) => (
                        <option value={s.name} key={s.id}>
                          {s.name}
                        </option>
                      ))}
                      <option value="Otro">Otro</option>
                    </select>
                  </label>
                  {serviceName === "Otro" && (
                    <label className="v2-field">
                      Detalle del servicio
                      <input
                        required
                        placeholder="Ej. Corte especial"
                        value={customServiceName}
                        onChange={(e) => setCustomServiceName(e.target.value)}
                      />
                    </label>
                  )}
                  <label className="v2-field">
                    Importe ($ ARS)
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={priceOverride ?? (serviceName === "Otro" ? "" : (service?.price ?? ""))}
                      placeholder={String(service?.price ?? 25000)}
                      onChange={(e) => setPriceOverride(e.target.value === "" ? null : Number(e.target.value))}
                    />
                  </label>
                </>
              )}

              <label className="v2-field">
                Método de cobro
                <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  <option value="Efectivo">Efectivo</option>
                  <option value="Transferencia">Transferencia</option>
                </select>
              </label>

              <div className="v2-payment-actions-strip">
                <button
                  type="button"
                  className={`v2-secondary v2-payment-action-btn ${showDiscount ? "active" : ""}`}
                  onClick={() => setShowDiscount(!showDiscount)}
                  aria-expanded={showDiscount}
                >
                  <Tag size={16} />
                  <span>{showDiscount ? "Quitar descuento" : "Agregar descuento"}</span>
                </button>
                {origin === "walk_in" && (
                  <button
                    type="button"
                    className={`v2-secondary v2-payment-action-btn ${showClient ? "active" : ""}`}
                    onClick={() => setShowClient(!showClient)}
                    aria-expanded={showClient}
                  >
                    <User size={16} />
                    <span>{showClient ? "Ocultar cliente" : "Asociar cliente"}</span>
                  </button>
                )}
              </div>

              {showClient && origin === "walk_in" && (
                <div className="v2-payment-collapsible">
                  <label className="v2-field">
                    Cliente existente
                    <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                      <option value="">Cargar nombre y contacto</option>
                      {data.clients
                        .filter((c) => !c.draft && !c.archived)
                        .map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.name} · {c.phone}
                          </option>
                        ))}
                    </select>
                  </label>
                  {!clientId && (
                    <div className="v2-form-row">
                      <label className="v2-field">
                        Nombre
                        <input
                          value={clientName}
                          placeholder="Nombre del cliente"
                          onChange={(e) => setClientName(e.target.value)}
                        />
                      </label>
                      <label className="v2-field">
                        Celular
                        <input
                          type="tel"
                          placeholder="Ej. 11 1234-5678"
                          value={clientPhone}
                          onChange={(e) => setClientPhone(e.target.value)}
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}

              {showDiscount && (
                <div className="v2-payment-collapsible">
                  <label className="v2-field">
                    Descuento en pesos
                    <input
                      type="number"
                      value={discount || ""}
                      min={0}
                      max={Math.max(0, price - deposit)}
                      step={1}
                      placeholder="0"
                      onChange={(e) => setDiscount(Number(e.target.value))}
                    />
                  </label>
                </div>
              )}

              {/* Resumen monetario: compacto cuando no hay ajustes, desglosado si hay descuento o seña previa */}
              <div className={`v2-payment-summary-block ${(discount > 0 || deposit > 0) ? "has-breakdown" : "is-compact"}`}>
                {(discount > 0 || deposit > 0) && (
                  <>
                    <div className="v2-summary-line">
                      <span className="v2-summary-label">Precio del servicio</span>
                      <span className="v2-summary-value">{money(price)}</span>
                    </div>
                    {discount > 0 && (
                      <div className="v2-summary-line v2-summary-discount">
                        <span className="v2-summary-label">Descuento</span>
                        <span className="v2-summary-value">- {money(discount)}</span>
                      </div>
                    )}
                    {deposit > 0 && (
                      <div className="v2-summary-line v2-summary-deposit">
                        <span className="v2-summary-label">Seña abonada</span>
                        <span className="v2-summary-value">- {money(deposit)}</span>
                      </div>
                    )}
                    <div className="v2-summary-divider" />
                  </>
                )}
                <div className="v2-summary-total">
                  <span className="v2-total-label">A cobrar ahora</span>
                  <strong className="v2-total-amount">{money(total)}</strong>
                </div>
              </div>

              <button
                className="v2-primary v2-full"
                type="submit"
                disabled={
                  busy ||
                  !price ||
                  (origin === "appointment" && (!appointment || !data.depositSupported))
                }
              >
                <CheckCircle2 size={18} />
                {busy ? "Registrando…" : "Registrar cobro"}
              </button>
            </fieldset>
          </form>
          {message && (
            <p className={success ? "v2-success" : "v2-alert"} role="status">
              {message}
            </p>
          )}
        </section>
      </div>

      <section className="v2-panel">
        <div className="v2-section-title">
          <h2>La cobranza</h2>
          <span>{history.length} servicios</span>
        </div>
        <div className="v2-filters">
          <label className="v2-field">
            Período
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as PaymentPeriodFilter)}
            >
              <option value="TODAY">Hoy</option>
              <option value="YESTERDAY">Ayer</option>
              <option value="THIS_WEEK">Esta semana</option>
              <option value="THIS_MONTH">{dynamicLabels.THIS_MONTH}</option>
              <option value="THIS_YEAR">{dynamicLabels.THIS_YEAR}</option>
              <option value="LAST_7_DAYS">Últimos 7 días</option>
              <option value="LAST_14_DAYS">Últimos 14 días</option>
              <option value="LAST_30_DAYS">Últimos 30 días</option>
              <option value="PREVIOUS_MONTH">{dynamicLabels.PREVIOUS_MONTH}</option>
              <option value="PREVIOUS_YEAR">{dynamicLabels.PREVIOUS_YEAR}</option>
              <option value="CUSTOM">Fecha específica</option>
            </select>
          </label>
          {period === "CUSTOM" && (
            <>
              <label className="v2-field">
                Fecha desde
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value || today)}
                />
              </label>
              <label className="v2-field">
                Fecha hasta
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value || today)}
                />
              </label>
            </>
          )}
          <BarberFilter />
        </div>
        {isInvalidRange && (
          <p className="v2-notice" style={{ color: "var(--destructive, #ef4444)", margin: "8px 0" }}>
            Rango no válido: Fecha desde debe ser menor o igual a Fecha hasta.
          </p>
        )}
        <div className="v2-history-total">
          <strong>{money(summary.collected)}</strong>
          <span>
            Total recaudado · valor de servicios {money(summary.value)} · señas online{" "}
            {money(summary.deposits)}
          </span>
        </div>
        {!history.length && <Empty>No hay cobros registrados en este período.</Empty>}
        {history.map((p) => (
          <article className="v2-history-row" key={p.id}>
            <div>
              <h3>{p.serviceOtherDetail || p.serviceName}</h3>
              <p>
                {p.clientName || "Sin cliente asociado"} · {p.barberName}
              </p>
              <small>
                {p.paymentDate} · {p.paymentTime} · {p.paymentMethod}{p.appointmentDate ? ` · Turno: ${p.appointmentDate}` : ""}
              </small>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <strong>{money(p.collectedAmountArs)}</strong>
              {isAdmin && !p.isDepositMovement ? (
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    type="button"
                    className="v2-secondary"
                    style={{ fontSize: "11px", padding: "4px 8px" }}
                    onClick={() => openEditModal(p)}
                    title="Editar cobro"
                  >
                    <Edit2 size={13} style={{ marginRight: "3px" }} />
                    Editar
                  </button>
                  <button
                    type="button"
                    className="v2-quiet"
                    style={{ fontSize: "11px", padding: "4px 8px", color: "var(--destructive, #ef4444)" }}
                    onClick={() => setDeletingPayment(p)}
                    title="Anular cobro"
                  >
                    <Trash2 size={13} style={{ marginRight: "3px" }} />
                    Eliminar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="v2-secondary"
                  style={{ fontSize: "11px", padding: "4px 8px" }}
                  onClick={() => openClientEditModal(p)}
                  title="Editar datos de contacto"
                >
                  <User size={13} style={{ marginRight: "3px" }} />
                  Editar cliente
                </button>
              )}
            </div>
          </article>
        ))}
      </section>

      {/* Admin Full Edit Dialog */}
      <Dialog open={!!editingPayment} onOpenChange={(open) => !open && !editBusy && setEditingPayment(null)}>
        <DialogContent className="v2-dialog">
          <DialogTitle>Editar cobro registrado</DialogTitle>
          <DialogDescription>
            Modificá los detalles del cobro. Los cambios se registran con trazabilidad.
          </DialogDescription>
          {editError && <p className="v2-alert">{editError}</p>}
          <form onSubmit={handleSavePayment} className="v2-form">
            <label className="v2-field">
              Barbero
              <select value={editBarberId} onChange={(e) => setEditBarberId(e.target.value)} disabled={editBusy}>
                {staff.barbers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="v2-field">
              Servicio
              <select
                value={editServiceName}
                onChange={(e) => setEditServiceName(e.target.value as ServicePaymentType)}
                disabled={editBusy}
              >
                <option value="Corte">Corte</option>
                <option value="Corte y barba">Corte y barba</option>
                <option value="Barba">Barba</option>
                <option value="Otros">Otros</option>
              </select>
            </label>
            {editServiceName === "Otros" && (
              <label className="v2-field">
                Detalle servicio
                <input
                  required
                  value={editOtherDetail}
                  onChange={(e) => setEditOtherDetail(e.target.value)}
                  disabled={editBusy}
                />
              </label>
            )}
            <div className="v2-form-row">
              <label className="v2-field">
                Precio servicio ($ ARS)
                <input
                  type="number"
                  min={1}
                  required
                  value={editPrice}
                  onChange={(e) => setEditPrice(Number(e.target.value))}
                  disabled={editBusy}
                />
              </label>
              <label className="v2-field">
                Descuento ($ ARS)
                <input
                  type="number"
                  min={0}
                  value={editDiscount}
                  onChange={(e) => setEditDiscount(Number(e.target.value))}
                  disabled={editBusy}
                />
              </label>
            </div>
            <label className="v2-field">
              Método de pago
              <select
                value={editMethod}
                onChange={(e) => setEditMethod(e.target.value as PaymentMethod)}
                disabled={editBusy}
              >
                <option value="Efectivo">Efectivo</option>
                <option value="Transferencia">Transferencia</option>
              </select>
            </label>
            <div className="v2-form-row">
              <label className="v2-field">
                Nombre del cliente
                <input
                  value={editClientName}
                  onChange={(e) => setEditClientName(e.target.value)}
                  disabled={editBusy}
                />
              </label>
              <label className="v2-field">
                Contacto / Celular
                <input
                  value={editClientContact}
                  onChange={(e) => setEditClientContact(e.target.value)}
                  disabled={editBusy}
                />
              </label>
            </div>
            <div className="v2-form-row">
              <label className="v2-field">
                Fecha
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  disabled={editBusy}
                />
              </label>
              <label className="v2-field">
                Hora
                <input
                  type="time"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  disabled={editBusy}
                />
              </label>
            </div>
            <div className="v2-dialog-actions">
              <button
                type="button"
                className="v2-secondary"
                onClick={() => setEditingPayment(null)}
                disabled={editBusy}
              >
                Cancelar
              </button>
              <button type="submit" className="v2-primary" disabled={editBusy}>
                {editBusy ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Barber Client Contact Edit Dialog */}
      <Dialog
        open={!!editingClientPayment}
        onOpenChange={(open) => !open && !editBusy && setEditingClientPayment(null)}
      >
        <DialogContent className="v2-dialog">
          <DialogTitle>Editar cliente del cobro</DialogTitle>
          <DialogDescription>
            Actualizá los datos de contacto del cliente asociado a este cobro.
          </DialogDescription>
          {editError && <p className="v2-alert">{editError}</p>}
          <form onSubmit={handleSaveClientInfo} className="v2-form">
            <label className="v2-field">
              Nombre del cliente
              <input
                required
                minLength={2}
                value={editClientName}
                onChange={(e) => setEditClientName(e.target.value)}
                disabled={editBusy}
              />
            </label>
            <label className="v2-field">
              Celular / Contacto
              <input
                value={editClientContact}
                onChange={(e) => setEditClientContact(e.target.value)}
                disabled={editBusy}
              />
            </label>
            <div className="v2-dialog-actions">
              <button
                type="button"
                className="v2-secondary"
                onClick={() => setEditingClientPayment(null)}
                disabled={editBusy}
              >
                Cancelar
              </button>
              <button type="submit" className="v2-primary" disabled={editBusy}>
                {editBusy ? "Guardando…" : "Guardar cliente"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete / Anular Confirmation Dialog */}
      <Dialog
        open={!!deletingPayment}
        onOpenChange={(open) => !open && !editBusy && setDeletingPayment(null)}
      >
        <DialogContent className="v2-dialog">
          <DialogTitle>Anular cobro</DialogTitle>
          <DialogDescription>
            ¿Estás seguro de anular el cobro de{" "}
            <strong>
              {deletingPayment?.serviceName} ({money(deletingPayment?.collectedAmountArs || 0)})
            </strong>
            ? Esta operación aplicará una baja lógica con trazabilidad y excluirá el cobro de las
            métricas sin alterar pagos externos ni eliminar turnos agendados.
          </DialogDescription>
          <div className="v2-dialog-actions">
            <button
              type="button"
              className="v2-secondary"
              onClick={() => setDeletingPayment(null)}
              disabled={editBusy}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="v2-primary"
              style={{ background: "var(--destructive, #ef4444)" }}
              onClick={handleConfirmDelete}
              disabled={editBusy}
            >
              {editBusy ? "Anulando…" : "Confirmar anulación"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
