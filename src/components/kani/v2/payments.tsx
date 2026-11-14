import { notifyActivityChanged } from '@/lib/kani-admin-activity';
import { isStaffOperator } from "@/lib/kani-permissions";
import {
  canonicalPaymentService,
  paymentAmounts,
  type DiscountKind,
} from "@/lib/kani-payment-amounts";
import { useRef, useState, type FormEvent } from "react";
import { useLocation, useSearch } from "@tanstack/react-router";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Tag, Trash2, Edit2, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { businessDateToday, addCalendarDays } from "@/lib/kani-mobile-appointments";
import { money, formatServiceName } from "@/lib/kani-model";
import { deduplicatePaymentMovements, paymentSummary, scopeV2 } from "@/lib/kani-v2";
import {
  deleteServicePayment,
  updateServicePayment,
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
import './payment-amount-alignment.css';

export function formatPaymentMethodLabel(method: string): string {
  if (!method) return "";
  return method
    .replace(/Tarjeta\s*[-—–]{1,3}\s*Payway/i, "Tarjeta - Payway")
    .replace(/^Payway$/i, "Tarjeta - Payway");
}

export function V2Payments() {
  const data = useV2();
  const staff = useAdminStaff();
  const isAdmin = isStaffOperator(staff.profile.role);
  const today = businessDateToday();
  const search = useSearch({ strict: false }) as { turno?: string };
  const [origin, setOrigin] = useState<"appointment" | "walk_in">(
    search.turno ? "appointment" : "walk_in",
  );
  const [appointmentId, setAppointmentId] = useState(search.turno ?? "");
  const [barberId, setBarberId] = useState(staff.profile.barber_id ?? staff.barbers[0]?.id ?? "");
  const [selectedServiceName, setServiceName] = useState<string | null>(null);
  const [customServiceName, setCustomServiceName] = useState<string>("");
  const [priceOverride, setPriceOverride] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("Efectivo");
  const [discountOverride, setDiscount] = useState<number | null>(null);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("FIXED");
  const [finalOverride, setFinalOverride] = useState<number | null>(null);
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
  const [editDiscountKind, setEditDiscountKind] = useState<DiscountKind>("FIXED");
  const [editFinal, setEditFinal] = useState<number | null>(null);
  const [editMethod, setEditMethod] = useState<PaymentMethod>("Efectivo");
  const [editClientName, setEditClientName] = useState("");
  const [editClientContact, setEditClientContact] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editError, setEditError] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const [deletingPayment, setDeletingPayment] = useState<ServicePayment | null>(null);
  const [actionNotice, setActionNotice] = useState("");
  const pathname = useLocation({ select: (location) => location.pathname });
  const isLiquidAdmin = pathname.startsWith("/admin-liquid");
  const shouldReduceMotion = useReducedMotion();

  const settled = new Set(
    data.payments
      .filter((p) => !p.isDepositMovement && p.appointmentId)
      .map((p) => p.appointmentId),
  );
  const choices = data.appointments.filter(
    (a) =>
      ["CONFIRMED", "COMPLETED"].includes(a.statusCode) && !settled.has(a.id) && !a.balancePaid &&
      (isAdmin || a.barberId === staff.profile.barber_id),
  );
  const appointment =
    origin === "appointment" ? choices.find((a) => a.id === appointmentId) : undefined;
  const serviceName =
    selectedServiceName ?? canonicalPaymentService(appointment?.serviceName ?? "Corte");
  const service = data.services.find(
    (s) => canonicalPaymentService(s.name) === canonicalPaymentService(serviceName),
  );
  const price =
    serviceName === "Anulado"
      ? 0
      : (priceOverride ?? (selectedServiceName === null && appointment
          ? (appointment.benefitOriginalPriceArs ?? appointment.servicePrice ?? service?.price ?? 0)
          : (service?.price ?? appointment?.servicePrice ?? 0)));
  const discountValue = discountOverride ?? (appointment
    ? (appointment.benefitDiscountAmountArs ?? Math.max(0,
        (appointment.benefitOriginalPriceArs ?? appointment.servicePrice ?? 0) -
        (appointment.benefitFinalPriceArs ?? appointment.servicePrice ?? 0))) : 0);
  const deposit = appointment?.depositPaid ? (appointment.depositAmountArs ?? 0) : 0;
  const discount =
    discountKind === "PERCENT" ? Math.round((price * discountValue) / 100) : discountValue;
  const total =
    serviceName === "Anulado" ? 0 : Math.max(0, (finalOverride ?? price - discount) - deposit);
  const appointmentBalance = appointment ? Math.max(0,
    (appointment.benefitFinalPriceArs ?? appointment.servicePrice ?? 0) - deposit) : null;
  const depositVerifiable = data.depositSupported && (!appointment?.depositPaid || appointment.depositAmountArs != null);
  const dynamicLabels = getPaymentPeriodDynamicLabels(today);
  const periodRange = calculatePaymentPeriodRange(period, today, customStartDate, customEndDate);
  const isInvalidRange = period === "CUSTOM" && Boolean(periodRange.isInvalid);

  const history = isInvalidRange
    ? []
    : deduplicatePaymentMovements(
        scopeV2(data.payments, staff.profile.role, staff.profile.barber_id, data.barberId),
      ).filter((p) => p.paymentDate >= periodRange.start && p.paymentDate <= periodRange.end);
  const summary = paymentSummary(history);
  const appointmentById = new Map(data.appointments.map(a => [a.id, a]));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setSuccess(false);
    setMessage("");
    if (origin === "appointment" && (!appointment || !depositVerifiable)) {
      setMessage("Seleccioná un turno con información de seña verificable.");
      return;
    }
    if (appointment && total <= 0) { setMessage("Sin saldo pendiente."); return; }
    if (appointmentBalance != null && total > appointmentBalance) {
      setMessage("El cobro no puede superar el saldo pendiente del turno."); return;
    }
    const rawServiceName = serviceName;
    const isOtherService = ["Otro", "Otros"].includes(serviceName);
    const trimmedCustomDetail =
      customServiceName.trim() || appointment?.customServiceName?.trim() || "";

    if (isOtherService && trimmedCustomDetail.length < 2) {
      setMessage("Ingresá el nombre del servicio personalizado.");
      return;
    }
    if (isOtherService && trimmedCustomDetail.length > 120) {
      setMessage("La descripción del servicio personalizado no puede superar los 120 caracteres.");
      return;
    }
    try {
      if (
        serviceName === "Anulado" &&
        (appointment?.depositPaid || (appointment?.depositAmountArs ?? 0) > 0)
      ) {
        throw new Error("No se puede anular un cobro vinculado a un turno con seña.");
      }
      paymentAmounts(
        price,
        discountKind,
        discountValue,
        finalOverride,
        deposit,
        serviceName === "Anulado",
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Revisá los importes.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const selected = data.clients.find((c) => c.id === clientId);
      const targetBarberId = appointment?.barberId ?? barberId;
      const canonicalServiceName = isOtherService
        ? "Otros"
        : rawServiceName === "Corte de cabello"
          ? "Corte"
          : rawServiceName === "Corte + barba"
            ? "Corte y barba"
            : rawServiceName;
      const finalOtherDetail = isOtherService ? trimmedCustomDetail : null;
      const resolvedClientName =
        appointment?.name ?? (showClient ? (selected?.name ?? clientName.trim()) : "");
      const resolvedClientContact =
        appointment?.phone ?? (showClient ? (selected?.phone ?? clientPhone.trim()) : "");

      const { data: result, error } = await (supabase.rpc as any)("staff_save_service_payment", {
        p_barber_id: targetBarberId,
        p_service_name: canonicalServiceName,
        p_service_other_detail: finalOtherDetail,
        p_service_price_ars: price,
        p_discount_kind: discountKind,
        p_discount_value: discountValue,
        p_final_amount_ars: finalOverride,
        p_client_id: selected?.id ?? null,
        p_payment_method: method,
        p_client_name: resolvedClientName,
        p_client_contact: resolvedClientContact,
        p_appointment_id: appointment?.id ?? null,
      });

      if (error) throw error;
      if (!result?.id)
        throw new Error(
          "No se recibió confirmación del cobro. Revisá el historial antes de reintentar.",
        );
      setSuccess(true);
      setMessage("Cobro registrado.");
      setAppointmentId("");
      setDiscount(null);
      setPriceOverride(null);
      setFinalOverride(null);
      setServiceName(null);
      setCustomServiceName("");
      setShowClient(false);
      setClientId("");
      setClientName("");
      setClientPhone("");
      await data.refresh();
      notifyActivityChanged();
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
    setEditServiceName(canonicalPaymentService(p.serviceName) as ServicePaymentType);
    setEditOtherDetail(p.serviceOtherDetail || "");
    setEditPrice(p.servicePriceArs);
    setEditDiscount(p.discountValue ?? p.discountArs ?? 0);
    setEditDiscountKind(p.discountKind ?? "FIXED");
    setEditFinal(p.finalAmountOverrideArs ?? null);
    setEditMethod(p.paymentMethod);
    setEditClientName(p.clientName || "");
    setEditClientContact(p.clientContact || "");
    setEditDate(p.paymentDate);
    setEditTime(p.paymentTime);
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
          ...(editServiceName === "Otros" ? { serviceOtherDetail: editOtherDetail } : {}),
          servicePriceArs: editPrice,
          discountKind: editDiscountKind,
          discountValue: editDiscount,
          finalAmountArs: editFinal,
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
          <MotionConfig reducedMotion="user">
            <div
              className="v2-segmented"
              role="group"
              aria-label="Origen del cobro"
              data-lg-segmented={isLiquidAdmin ? "true" : undefined}
            >
              {(["walk_in", "appointment"] as const).map((value) => {
                const isSelected = origin === value;
                return (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setOrigin(value);
                      setServiceName(null);
                      setFinalOverride(null);
                      setPriceOverride(null);
                      setDiscount(null);
                    }}
                  >
                    {isLiquidAdmin && isSelected && (
                      <motion.span
                        layoutId="lg-payment-origin-pill"
                        className="lg-segmented-pill"
                        aria-hidden="true"
                        transition={
                          shouldReduceMotion
                            ? { duration: 0 }
                            : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
                        }
                      />
                    )}
                    <span className="lg-segmented-label">
                      {value === "walk_in" ? "Sin turno" : "Con turno"}
                    </span>
                  </button>
                );
              })}
            </div>
          </MotionConfig>
          <form onSubmit={(e) => void submit(e)} className="v2-payment-compact-form">
            <fieldset disabled={busy || data.loading} className="v2-payment-form-fieldset">
              <div className="v2-payment-grid">
                {/* Fila 1: Barbero (o Turno) | Servicio */}
                <div className="v2-payment-row">
                  {origin === "appointment" ? (
                    <label className="v2-field v2-payment-col">
                      <span className="v2-field-label">Turno</span>
                      <select
                        value={appointmentId}
                        onChange={(e) => {
                          setAppointmentId(e.target.value);
                          setServiceName(null);
                          setFinalOverride(null);
                          setPriceOverride(null);
                          setDiscount(null);
                        }}
                      >
                        <option value="">Seleccionar turno</option>
                        {choices.map((a) => (
                          <option value={a.id} key={a.id}>
                            {a.name} · {a.time} hs ({a.barber})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : isAdmin ? (
                    <label className="v2-field v2-payment-col v2-payment-entry-field">
                      <span className="v2-field-label">Barbero</span>
                      <select value={barberId} onChange={(e) => setBarberId(e.target.value)}>
                        {staff.barbers.map((b) => (
                          <option value={b.id} key={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label className="v2-field v2-payment-col v2-payment-entry-field">
                      <span className="v2-field-label">Barbero</span>
                      <input
                        value={
                          staff.barbers.find((b) => b.id === barberId)?.name ||
                          staff.profile.display_name ||
                          "Lautaro"
                        }
                        disabled
                        readOnly
                      />
                    </label>
                  )}

                  <label className="v2-field v2-payment-col v2-payment-entry-field">
                    <span className="v2-field-label">Servicio</span>
                    <select
                      value={serviceName}
                      onChange={(e) => {
                        setServiceName(e.target.value);
                        setPriceOverride(null);
                        setFinalOverride(null);
                      }}
                    >
                      <option value="Corte">Corte</option>
                      <option value="Corte y barba">Corte y barba</option>
                      <option value="Barba">Barba</option>
                      <option value="Otros">Otro</option>
                      <option
                        value="Anulado"
                        disabled={
                          !!appointment?.depositPaid || (appointment?.depositAmountArs ?? 0) > 0
                        }
                      >
                        Anulado
                      </option>
                    </select>
                  </label>
                </div>

                {["Otro", "Otros"].includes(serviceName) && (
                  <div className="v2-payment-full-row">
                    <label className="v2-field">
                      <span className="v2-field-label">Detalle del servicio</span>
                      <input
                        required
                        placeholder="Ej. Corte especial"
                        value={customServiceName}
                        onChange={(e) => setCustomServiceName(e.target.value)}
                      />
                    </label>
                  </div>
                )}

                {origin === "appointment" && appointment && (
                  <div className="v2-payment-full-row v2-appointment-selected-note">
                    <p className="v2-footnote">
                      {appointment.name} · {appointment.phone || "Sin celular"} · {appointment.date}{" "}
                      a las {appointment.time} hs ({appointment.barber})
                    </p>
                  </div>
                )}

                {/* Fila 2: Método de pago | Importe */}
                <div className="v2-payment-row">
                  <label className="v2-field v2-payment-col v2-payment-entry-field">
                    <span className="v2-field-label">Método de pago</span>
                    <select
                      value={method}
                      onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                    >
                      <option value="Efectivo">Efectivo</option>
                      <option value="Transferencia">Transferencia</option>
                    </select>
                  </label>

                  <label className="v2-field v2-payment-col v2-payment-entry-field">
                    <span className="v2-field-label">Importe</span>
                    <input
                      type="number"
                      min={serviceName === "Anulado" ? 0 : 1}
                      disabled={serviceName === "Anulado"}
                      step={1}
                      value={
                        serviceName === "Anulado"
                          ? 0
                          : (priceOverride ??
                            (["Otro", "Otros"].includes(serviceName) ? "" : price))
                      }
                      placeholder={String(service?.price ?? 25000)}
                      onChange={(e) =>
                        setPriceOverride(e.target.value === "" ? null : Number(e.target.value))
                      }
                    />
                  </label>
                </div>

                {/* Fila 3: Agregar descuento | Asociar cliente */}
                <div className="v2-payment-row">
                  <button
                    type="button"
                    className={`v2-secondary v2-payment-toggle-btn ${showDiscount ? "active" : ""}`}
                    onClick={() => setShowDiscount(!showDiscount)}
                    aria-expanded={showDiscount}
                  >
                    <Tag size={16} />
                    <span>
                      {showDiscount ? (
                        "Quitar descuento"
                      ) : (
                        <>
                          <span className="v2-discount-text-desktop">Agregar descuento</span>
                          <span className="v2-discount-text-mobile">Descuento</span>
                        </>
                      )}
                    </span>
                  </button>

                  {origin === "walk_in" ? (
                    <button
                      type="button"
                      className={`v2-secondary v2-payment-toggle-btn ${showClient ? "active" : ""}`}
                      onClick={() => setShowClient(!showClient)}
                      aria-expanded={showClient}
                    >
                      <User size={16} />
                      <span>{showClient ? "Ocultar cliente" : "Asociar cliente"}</span>
                    </button>
                  ) : (
                    <div className="v2-payment-appointment-client-badge">
                      <User size={16} />
                      <span className="v2-truncate">
                        {appointment?.name || "Cliente del turno"}
                      </span>
                    </div>
                  )}
                </div>

                {showDiscount && (
                  <div className="v2-payment-full-row v2-payment-collapsible">
                    <label className="v2-field">
                      <span className="v2-field-label">
                        {discountKind === "PERCENT"
                          ? "Descuento porcentual (%)"
                          : "Descuento en pesos ($ ARS)"}
                      </span>
                      <input
                        type="number"
                        value={discountValue || ""}
                        min={0}
                        max={discountKind === "PERCENT" ? 100 : price}
                        step={1}
                        placeholder="0"
                        onChange={(e) => setDiscount(Number(e.target.value))}
                      />
                    </label>
                    <label className="v2-field">
                      Tipo de descuento
                      <select
                        value={discountKind}
                        onChange={(e) => setDiscountKind(e.target.value as DiscountKind)}
                      >
                        <option value="FIXED">Importe fijo ($)</option>
                        <option value="PERCENT">Porcentaje (%)</option>
                      </select>
                    </label>
                  </div>
                )}

                {showClient && origin === "walk_in" && (
                  <div className="v2-payment-full-row v2-payment-collapsible">
                    <label className="v2-field">
                      <span className="v2-field-label">Cliente existente</span>
                      <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                        <option value="">Cargar nombre y contacto</option>
                        {data.clients
                          .filter((c) => !c.draft && !c.archived && !(c as any).deleted_at)
                          .map((c) => (
                            <option value={c.id} key={c.id}>
                              {c.name} · {c.phone}
                            </option>
                          ))}
                      </select>
                    </label>
                    {!clientId && (
                      <div className="v2-payment-row" style={{ marginTop: "8px" }}>
                        <label className="v2-field v2-payment-col">
                          <span className="v2-field-label">Nombre</span>
                          <input
                            value={clientName}
                            placeholder="Nombre del cliente"
                            onChange={(e) => setClientName(e.target.value)}
                          />
                        </label>
                        <label className="v2-field v2-payment-col">
                          <span className="v2-field-label">Celular</span>
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

                {/* Fila 4: A cobrar ahora | Registrar cobro */}
                <div className="v2-payment-row v2-payment-row-final">
                  <div className="v2-payment-total-box">
                    <span className="v2-total-box-label">Importe:</span>
                    <span className="sr-only">A cobrar ahora</span>
                    <div className="v2-total-box-amount-wrap">
                      <strong className="v2-total-box-amount">{money(total)}</strong>
                      {(discount > 0 || deposit > 0) && (
                        <span className="v2-total-box-breakdown">
                          {deposit > 0 ? `Seña: -${money(deposit)} ` : ""}
                          {discount > 0 ? `Desc: -${money(discount)}` : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    className="v2-primary v2-payment-submit-btn"
                    type="submit"
                    disabled={
                      busy ||
                      (!price && serviceName !== "Anulado") ||
                      (origin === "appointment" && (!appointment || !depositVerifiable || total <= 0 || (appointmentBalance != null && total > appointmentBalance)))
                    }
                  >
                    <CheckCircle2 size={18} />
                    {busy ? (
                      <span>Registrando…</span>
                    ) : (
                      <>
                        <span className="v2-submit-btn-text-desktop">Registrar cobro</span>
                        <span className="v2-submit-btn-text-mobile">Cobrar</span>
                      </>
                    )}
                  </button>
                </div>
                {appointment && total <= 0 && <p role="status">Sin saldo pendiente.</p>}
              </div>
            </fieldset>
          </form>
          {message && (
            <p className={success ? "v2-success" : "v2-alert"} role="status">
              {message}
            </p>
          )}
        </section>
      </div>

      <section className="v2-panel v2-payments-history-panel">
        <div className="v2-section-title">
          <h2>Cobros registrados</h2>
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
          <p
            className="v2-notice"
            style={{ color: "var(--destructive, #ef4444)", margin: "8px 0" }}
          >
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

        {/* Presentación Desktop: Tabla con columnas estables y montos alineados a la derecha */}
        {history.length > 0 && (
          <div className="v2-payments-table-wrap">
            <table className="v2-payments-table">
              <thead>
                <tr>
                  <th className="col-datetime">Fecha del cobro</th>
                  <th className="col-service">Servicio</th>
                  <th className="col-client">Cliente</th>
                  <th className="col-method">Método</th>
                  <th className="col-amount">Importe</th>
                  <th className="col-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {history.map((p) => (
                  <tr key={p.id}>
                    <td className="col-datetime">
                      <div className="v2-table-datetime">
                        <span>{p.paymentDate}</span>
                        <small>{p.paymentTime} hs</small>
                      </div>
                    </td>
                    <td className="col-service">
                      <strong className="v2-table-service-name">
                        {p.serviceOtherDetail || formatServiceName(p.serviceName)}
                      </strong>
                      <small className="v2-table-barber-name">{p.barberName}</small>
                      {p.appointmentId && appointmentById.has(p.appointmentId) && <small>
                        Fecha del servicio: {appointmentById.get(p.appointmentId)!.date} {appointmentById.get(p.appointmentId)!.time} hs
                      </small>}
                    </td>
                    <td className="col-client">
                      <span className="v2-table-client-name">
                        {p.clientName || "Sin cliente asociado"}
                      </span>
                      {p.clientContact && (
                        <small className="v2-table-client-contact">{p.clientContact}</small>
                      )}
                    </td>
                    <td className="col-method">
                      <span className={`v2-method-badge ${p.paymentMethod.toLowerCase()}`}>
                        {formatPaymentMethodLabel(p.paymentMethod)}
                      </span>
                    </td>
                    <td className="col-amount">
                      <strong className="v2-table-amount-cell">
                        {money(p.collectedAmountArs)}
                      </strong>
                    </td>
                    <td className="col-actions">
                      <div className="v2-table-actions-cell">
                        {!p.isDepositMovement ? (
                          <>
                            <button
                              type="button"
                              className="v2-secondary v2-action-icon-btn edit"
                              onClick={() => openEditModal(p)}
                              title="Editar cobro"
                              aria-label="Editar cobro"
                            >
                              <Edit2 size={13} />
                              <span className="v2-btn-text">Editar</span>
                            </button>
                            {isAdmin && (
                              <button
                                type="button"
                                className="v2-quiet v2-action-icon-btn delete v2-destructive-text"
                                onClick={() => setDeletingPayment(p)}
                                title="Eliminar cobro"
                                aria-label="Eliminar cobro"
                              >
                                <Trash2 size={13} />
                                <span className="v2-btn-text">Eliminar</span>
                              </button>
                            )}
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Presentación Mobile: Tarjetas compactas estructuradas en 4 líneas, sin desborde horizontal */}
        {history.length > 0 && (
          <div className="v2-payments-mobile-cards">
            {history.map((p) => (
              <article className="v2-payment-card-mobile" key={p.id}>
                {/* 1. Línea superior: Servicio + Importe */}
                <div className="v2-pcm-row-top">
                  <div className="v2-pcm-service-group">
                    <strong className="v2-pcm-service">
                      {p.serviceOtherDetail || formatServiceName(p.serviceName)}
                    </strong>
                    <span className="v2-pcm-barber">{p.barberName}</span>
                  </div>
                  <strong className="v2-pcm-amount">{money(p.collectedAmountArs)}</strong>
                </div>

                {/* 2. Línea secundaria: Cliente + Teléfono */}
                <div className="v2-pcm-row-client">
                  <span className="v2-pcm-client-name">
                    {p.clientName || "Sin cliente asociado"}
                  </span>
                  {p.clientContact && (
                    <span className="v2-pcm-client-contact">{p.clientContact}</span>
                  )}
                </div>

                {/* 3. Línea terciaria: Fecha/Hora + Método */}
                <div className="v2-pcm-row-meta">
                  <span className="v2-pcm-datetime">
                    {p.paymentDate} · {p.paymentTime} hs
                  </span>
                  <span className={`v2-method-badge ${p.paymentMethod.toLowerCase()}`}>
                    {formatPaymentMethodLabel(p.paymentMethod)}
                  </span>
                </div>

                {/* 4. Línea inferior: Acciones compactas y estables */}
                <div className="v2-pcm-actions">
                  {!p.isDepositMovement ? (
                    <>
                      <button
                        type="button"
                        className="v2-secondary v2-pcm-btn edit"
                        onClick={() => openEditModal(p)}
                        title="Editar cobro"
                        aria-label="Editar cobro"
                      >
                        <Edit2 size={13} />
                        <span>Editar</span>
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          className="v2-quiet v2-pcm-btn delete v2-destructive-text"
                          onClick={() => setDeletingPayment(p)}
                          title="Eliminar cobro"
                          aria-label="Eliminar cobro"
                        >
                          <Trash2 size={13} />
                          <span>Eliminar</span>
                        </button>
                      )}
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Scoped full edit: own barber payments or all payments for operators. */}
      <Dialog
        open={!!editingPayment}
        onOpenChange={(open) => !open && !editBusy && setEditingPayment(null)}
      >
        <DialogContent className="v2-dialog v2-payment-edit-dialog">
          <DialogTitle>Editar cobro registrado</DialogTitle>
          <DialogDescription>
            Modificá los detalles del cobro. Los cambios se registran con trazabilidad.
          </DialogDescription>
          {editError && <p className="v2-alert">{editError}</p>}
          <form onSubmit={handleSavePayment} className="v2-form">
            <label className="v2-field v2-payment-entry-field">
              Barbero
              <select
                value={editBarberId}
                onChange={(e) => setEditBarberId(e.target.value)}
                disabled={editBusy || !isAdmin}
              >
                {staff.barbers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="v2-field v2-payment-entry-field">
              Servicio
              <select
                value={editServiceName}
                onChange={(e) => {
                  const name = e.target.value as ServicePaymentType;
                  setEditServiceName(name);
                  setEditFinal(null);
                  const service = data.services.find(
                    (s) => canonicalPaymentService(s.name) === name,
                  );
                  setEditPrice(name === "Anulado" ? 0 : (service?.price ?? editPrice));
                }}
                disabled={editBusy}
              >
                <option value="Corte">Corte</option>
                <option value="Corte y barba">Corte y barba</option>
                <option value="Barba">Barba</option>
                <option value="Otros">Otro</option>
                <option
                  value="Anulado"
                  disabled={
                    !!editingPayment?.onlineDepositPaid ||
                    (editingPayment?.onlineDepositAmountArs ?? 0) > 0 ||
                    !!data.appointments.find(
                      (a) =>
                        a.id === editingPayment?.appointmentId &&
                        (a.depositPaid || (a.depositAmountArs ?? 0) > 0),
                    )
                  }
                >
                  Anulado
                </option>
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
              <label className="v2-field v2-payment-entry-field">
                Precio servicio ($ ARS)
                <input
                  type="number"
                  min={editServiceName === "Anulado" ? 0 : 1}
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
            <div className="v2-form-row">
              <label className="v2-field">
                Tipo de descuento
                <select
                  value={editDiscountKind}
                  onChange={(e) => setEditDiscountKind(e.target.value as DiscountKind)}
                  disabled={editBusy || editServiceName === "Anulado"}
                >
                  <option value="FIXED">Importe fijo ($)</option>
                  <option value="PERCENT">Porcentaje (%)</option>
                </select>
              </label>
              <label className="v2-field v2-payment-entry-field">
                Importe total
                <input
                  type="number"
                  min={editingPayment?.onlineDepositAmountArs ?? 0}
                  step="1"
                  value={
                    editServiceName === "Anulado"
                      ? 0
                      : (editFinal ??
                        Math.max(
                          0,
                          editPrice -
                            Math.round(
                              editDiscountKind === "PERCENT"
                                ? (editPrice * editDiscount) / 100
                                : editDiscount,
                            ),
                        ))
                  }
                  onChange={(e) =>
                    setEditFinal(e.target.value === "" ? null : Number(e.target.value))
                  }
                  disabled={editBusy || editServiceName === "Anulado"}
                />
              </label>
            </div>
            <label className="v2-field v2-payment-entry-field">
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
              {formatServiceName(deletingPayment?.serviceName)} (
              {money(deletingPayment?.collectedAmountArs || 0)})
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
