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
import { CheckCircle2, ChevronDown, ChevronUp, Tag, Trash2, Edit2, User } from "lucide-react";
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
import { isLiquidGlassPath } from "@/components/kani/experimental/liquid-glass-shell";
import { BarberFilter, Empty } from "./shared";
import { useV2 } from "./data";
import './payment-amount-alignment.css';

export function formatPaymentMethodLabel(method: string): string {
  if (!method) return "";
  return method
    .replace(/Tarjeta\s*[-—–]{1,3}\s*Payway/i, "Tarjeta - Payway")
    .replace(/^Payway$/i, "Tarjeta - Payway");
}

function formatArsThousands(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return Math.max(0, Math.round(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function parseArsDigits(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  return Number(digits);
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
  const [amountInputEmpty, setAmountInputEmpty] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showClient, setShowClient] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [period, setPeriod] = useState<PaymentPeriodFilter>("TODAY");
  const [showCashBreakdown, setShowCashBreakdown] = useState(false);
  const [methodFilter, setMethodFilter] = useState<"ALL" | "Efectivo" | "Transferencia" | "Payway">("ALL");
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
  const isLiquidAdmin = isLiquidGlassPath(pathname);
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
  const hasDeposit =
    Boolean(appointment?.depositPaid) || (appointment?.depositAmountArs ?? 0) > 0;
  const deposit = hasDeposit ? (appointment?.depositAmountArs ?? 5000) : 0;
  const discount =
    discountKind === "PERCENT" ? Math.round((price * discountValue) / 100) : discountValue;
  const total =
    serviceName === "Anulado" ? 0 : Math.max(0, (finalOverride ?? price - discount) - deposit);
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
  const activeHistory = history.filter((p) => p.serviceName !== "Anulado");
  const isPaywayMethod = (pm: string) => /payway|tarjeta/i.test(pm);
  const cashTotal = activeHistory
    .filter((p) => p.paymentMethod === "Efectivo")
    .reduce((sum, p) => sum + p.collectedAmountArs, 0);
  const transferTotal = activeHistory
    .filter((p) => p.paymentMethod === "Transferencia")
    .reduce((sum, p) => sum + p.collectedAmountArs, 0);
  const paywayMovementsTotal = activeHistory
    .filter((p) => isPaywayMethod(p.paymentMethod))
    .reduce((sum, p) => sum + p.collectedAmountArs, 0);
  const paywayTotal = Math.max(paywayMovementsTotal, summary.deposits);
  const filteredHistory =
    methodFilter === "ALL"
      ? history
      : methodFilter === "Payway"
        ? history.filter((p) => isPaywayMethod(p.paymentMethod))
        : history.filter((p) => p.paymentMethod === methodFilter);
  const quickServiceOptions: Array<{ value: string; label: string }> = [
    { value: "Corte", label: "Corte" },
    { value: "Corte y barba", label: "Corte y barba" },
    { value: "Barba", label: "Barba" },
    { value: "Otros", label: "Otro" },
    ...(origin === "appointment" && !hasDeposit ? [{ value: "Anulado", label: "Anulado" }] : []),
  ];
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
    if (appointment && total <= 0 && serviceName !== "Anulado") { setMessage("Sin saldo pendiente."); return; }
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
      setAmountInputEmpty(false);
      setServiceName(null);
      setCustomServiceName("");
      setShowClient(false);
      setClientId("");
      setClientName("");
      setClientPhone("");
      await data.refresh({ silent: true });
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
      await data.refresh({ silent: true });
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
      await data.refresh({ silent: true });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al anular el cobro.");
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <main className="v2-page v2-payments-page">
      {actionNotice && (
        <p role="status" className="v2-success" style={{ marginBottom: "1rem" }}>
          {actionNotice}
        </p>
      )}

      {/* 1. Resumen de Caja del Día arriba (Cierre individual rápido, colapsable en móvil) */}
      <section className="v2-panel v2-cash-summary-card" aria-label="Resumen de caja">
        <div className="v2-cash-summary-main">
          <button
            type="button"
            className="v2-cash-summary-toggle"
            aria-expanded={showCashBreakdown}
            aria-controls="v2-cash-summary-breakdown"
            onClick={() => setShowCashBreakdown((prev) => !prev)}
          >
            <span className="v2-cash-summary-eyebrow">
              {period === "TODAY" ? "Caja del día" : "Caja del período"}
            </span>
            <span className="v2-cash-summary-amount-row">
              <strong className="v2-cash-summary-amount">{money(summary.collected)}</strong>
              <span className="v2-cash-summary-count">
                · {history.length} {history.length === 1 ? "cobro" : "cobros"}
              </span>
              <span className="v2-cash-summary-chevron" aria-hidden="true">
                {showCashBreakdown ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </span>
            </span>
          </button>
          <div
            id="v2-cash-summary-breakdown"
            className={`v2-cash-summary-breakdown ${showCashBreakdown ? "is-open" : ""}`}
            aria-label="Desglose por método de pago"
          >
            <div className="v2-cash-metric cash">
              <span>Efectivo</span>
              <strong>{money(cashTotal)}</strong>
            </div>
            <div className="v2-cash-metric transfer">
              <span>Transf.</span>
              <strong>{money(transferTotal)}</strong>
            </div>
            <div className="v2-cash-metric payway">
              <span>Payway</span>
              <strong>{money(paywayTotal)}</strong>
            </div>
          </div>
        </div>
      </section>

      <div className="v2-payment-layout">
        <section className="v2-panel v2-payment-form v2-cobro-panel" aria-label="Cobro rápido">
          <div className="v2-payment-form-header v2-cobro-header">
            <h2 className="v2-payment-form-title">Cobro rápido</h2>
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
                        setAmountInputEmpty(false);
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
          </div>
          <form onSubmit={(e) => void submit(e)} className="v2-payment-compact-form">
            <fieldset disabled={busy || data.loading} className="v2-payment-form-fieldset">
              <div className="v2-payment-grid">
                {/* Turno (solo en modo Con turno) */}
                {origin === "appointment" && (
                  <div className="v2-payment-full-row">
                    <label className="v2-field v2-payment-col">
                      <span className="v2-field-label">Turno</span>
                      <select
                        value={appointmentId}
                        onChange={(e) => {
                          setAppointmentId(e.target.value);
                          setServiceName(null);
                          setFinalOverride(null);
                          setPriceOverride(null);
                          setAmountInputEmpty(false);
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
                  </div>
                )}

                {/* 1. Servicio en 1 toque */}
                <div className="v2-payment-full-row">
                  <span className="v2-field-label">1. Servicio</span>
                  <div className="v2-quick-chips" role="group" aria-label="Servicio">
                    {quickServiceOptions.map((opt) => {
                      const isSelected =
                        opt.value === "Otros"
                          ? ["Otro", "Otros"].includes(serviceName)
                          : serviceName === opt.value;
                      const isDisabled =
                        opt.value === "Anulado" &&
                        (!!appointment?.depositPaid || (appointment?.depositAmountArs ?? 0) > 0);
                      const baseService = data.services.find(
                        (s) => canonicalPaymentService(s.name) === canonicalPaymentService(opt.value),
                      );
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          className={`v2-quick-chip ${isSelected ? "is-selected" : ""}`}
                          aria-pressed={isSelected}
                          disabled={isDisabled}
                          onClick={() => {
                            setServiceName(opt.value);
                            setPriceOverride(null);
                            setFinalOverride(null);
                            setAmountInputEmpty(false);
                          }}
                        >
                          <span className="v2-quick-chip-name">{opt.label}</span>
                          {baseService && baseService.price > 0 && (
                            <span className="v2-quick-chip-price">
                              {baseService.price >= 1000 && baseService.price % 1000 === 0
                                ? `$${baseService.price / 1000}k`
                                : money(baseService.price)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
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

                {/* 2. Método de pago en 1 toque (50/50) */}
                <div className="v2-payment-full-row">
                  <span className="v2-field-label">2. Método de pago</span>
                  <div className="v2-quick-method-grid" role="group" aria-label="Método de pago">
                    {(
                      [
                        { value: "Efectivo", label: "Efectivo", ariaLabel: "Efectivo" },
                        { value: "Transferencia", label: "Transferencia", ariaLabel: "Transferencia" },
                      ] as const
                    ).map((m) => {
                      const isSelected = method === m.value;
                      return (
                        <button
                          key={m.value}
                          type="button"
                          className={`v2-quick-chip v2-quick-method-btn ${isSelected ? "is-selected" : ""}`}
                          aria-pressed={isSelected}
                          aria-label={m.ariaLabel}
                          onClick={() => setMethod(m.value)}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Barbero | Importe en una misma fila 50/50 (o Importe al 100% si no aplica Barbero) */}
                <div
                  className={
                    origin === "walk_in" && isAdmin
                      ? "v2-cobro-barber-amount-row"
                      : "v2-payment-full-row"
                  }
                >
                  {origin === "walk_in" && isAdmin && (
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
                  )}

                  <label className="v2-field v2-payment-col v2-payment-entry-field">
                    <span className="v2-field-label">Importe</span>
                    <div className="v2-quick-amount-input-wrap">
                      <span className="v2-quick-amount-prefix" aria-hidden="true">$</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label="Importe"
                        disabled={serviceName === "Anulado"}
                        value={
                          serviceName === "Anulado"
                            ? "0"
                            : amountInputEmpty ||
                                (["Otro", "Otros"].includes(serviceName) &&
                                  priceOverride === null &&
                                  finalOverride === null &&
                                  !appointment)
                              ? ""
                              : formatArsThousands(total)
                        }
                        placeholder={
                          ["Otro", "Otros"].includes(serviceName)
                            ? "0"
                            : formatArsThousands(service?.price ?? 25000)
                        }
                        onChange={(e) => {
                          const parsed = parseArsDigits(e.target.value);
                          if (parsed === null) {
                            setAmountInputEmpty(true);
                            if (deposit > 0 || discount > 0) {
                              setFinalOverride(deposit);
                            } else {
                              setPriceOverride(null);
                              setFinalOverride(null);
                            }
                            return;
                          }
                          setAmountInputEmpty(false);
                          if (deposit > 0 || discount > 0) {
                            setFinalOverride(parsed + deposit);
                          } else {
                            setFinalOverride(null);
                            setPriceOverride(parsed);
                          }
                        }}
                      />
                    </div>
                  </label>
                </div>

                {/* Fila 50/50 discreta: Descuento | Asociar cliente */}
                <div className="v2-quick-secondary-toggles">
                  <button
                    type="button"
                    className={`v2-secondary v2-quick-secondary-btn ${showDiscount ? "active" : ""}`}
                    onClick={() => setShowDiscount(!showDiscount)}
                    aria-expanded={showDiscount}
                  >
                    <Tag size={14} />
                    <span>{showDiscount ? "Quitar descuento" : "Descuento"}</span>
                  </button>

                  {origin === "walk_in" ? (
                    <button
                      type="button"
                      className={`v2-secondary v2-quick-secondary-btn ${showClient ? "active" : ""}`}
                      onClick={() => setShowClient(!showClient)}
                      aria-expanded={showClient}
                    >
                      <User size={14} />
                      <span>{showClient ? "Ocultar cliente" : "Asociar cliente"}</span>
                    </button>
                  ) : (
                    <div className="v2-payment-appointment-client-badge v2-quick-secondary-pill">
                      <User size={14} />
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

                {(discount > 0 || deposit > 0) && (
                  <p className="v2-quick-breakdown-note">
                    {`Servicio ${money(serviceName === "Anulado" ? 0 : (finalOverride !== null ? finalOverride + discount : price))}`}
                    {deposit > 0 ? ` · Seña Payway -${money(deposit)}` : ""}
                    {discount > 0 ? ` · Descuento -${money(discount)}` : ""}
                  </p>
                )}

                <button
                  className="v2-primary v2-payment-submit-btn v2-quick-submit-full"
                  type="submit"
                  disabled={
                    busy ||
                    (!price && finalOverride === null && serviceName !== "Anulado") ||
                    (origin === "appointment" && (!appointment || !depositVerifiable || (total <= 0 && serviceName !== "Anulado")))
                  }
                >
                  <CheckCircle2 size={18} />
                  {busy ? (
                    <span>Registrando…</span>
                  ) : (
                    <span>{`Cobrar ${money(total)}`}</span>
                  )}
                </button>
                {appointment && total <= 0 && serviceName !== "Anulado" && <p role="status">Sin saldo pendiente.</p>}
              </div>
            </fieldset>
          </form>
          {message && (
            <p className={success ? "v2-success" : "v2-alert"} role={success ? "status" : "alert"}>
              {message}
            </p>
          )}
        </section>

        <section className="v2-panel v2-payments-history-panel" aria-label="Cobros registrados">
          <div className="v2-section-title">
            <h2>Cobros registrados</h2>
            <span>{filteredHistory.length} servicios</span>
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
          <div className="v2-method-filter-pills" role="group" aria-label="Filtrar por método">
            {(
              [
                { value: "ALL", label: "Todos", ariaLabel: "Todos" },
                { value: "Efectivo", label: "Efectivo", ariaLabel: "Efectivo" },
                { value: "Transferencia", label: "Transf.", ariaLabel: "Transferencia" },
                { value: "Payway", label: "Payway", ariaLabel: "Payway" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`v2-method-pill ${methodFilter === opt.value ? "is-active" : ""}`}
                aria-pressed={methodFilter === opt.value}
                aria-label={opt.ariaLabel}
                onClick={() => setMethodFilter(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {isInvalidRange && (
            <p
              role="alert"
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
          {!filteredHistory.length && (
            <Empty>
              {history.length > 0
                ? "No hay cobros con este método en el período seleccionado."
                : "No hay cobros registrados en este período."}
            </Empty>
          )}

          {/* Presentación Desktop: Tabla con columnas estables y montos alineados a la derecha */}
          {filteredHistory.length > 0 && (
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
                  {filteredHistory.map((p) => (
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
                                  className="v2-destructive v2-action-icon-btn delete"
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
          {filteredHistory.length > 0 && (
            <div className="v2-payments-mobile-cards">
              {filteredHistory.map((p) => (
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
                          className="v2-destructive v2-pcm-btn delete"
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
      </div>

      {/* Scoped full edit: own barber payments or all payments for operators. */}
      <Dialog
        open={!!editingPayment}
        onOpenChange={(open) => !open && !editBusy && setEditingPayment(null)}
      >
        <DialogContent
          className="v2-dialog v2-payment-edit-dialog v2-modal-pinned-shell"
          transitionMode="container-transform"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
          }}
        >
          <div className="v2-modal-pinned-header">
            <DialogTitle>Editar cobro registrado</DialogTitle>
            <DialogDescription>
              Modificá los detalles del cobro. Los cambios se registran con trazabilidad.
            </DialogDescription>
          </div>
          <form onSubmit={handleSavePayment} className="v2-form v2-modal-pinned-form">
            <div className="v2-modal-pinned-scroll">
              {editError && <p className="v2-alert" role="alert">{editError}</p>}
              <div className="v2-form-row">
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
              </div>
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
                  Precio ($ ARS)
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
            </div>
            <div className="v2-dialog-actions v2-modal-pinned-footer">
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
        <DialogContent
          className="v2-dialog max-w-[calc(100vw-24px)] max-h-[calc(100dvh-32px)] overflow-y-auto"
          transitionMode="container-transform"
        >
          <DialogTitle className="pr-10">Anular pago</DialogTitle>
          <DialogDescription>¿Querés anular este cobro?</DialogDescription>
          {deletingPayment && (
            <dl className="my-2 rounded-xl border border-border/60 bg-muted/30 px-3.5 py-2.5 text-sm space-y-1.5 min-w-0">
              <div className="flex items-baseline justify-between gap-3 min-w-0">
                <dt className="text-muted-foreground shrink-0">Cliente</dt>
                <dd className="font-medium text-foreground text-right min-w-0 break-words">
                  {deletingPayment.clientName || "Sin cliente asociado"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 min-w-0">
                <dt className="text-muted-foreground shrink-0">Fecha y horario</dt>
                <dd className="font-medium text-foreground text-right min-w-0">
                  {`${deletingPayment.paymentDate ?? ""} · ${deletingPayment.paymentTime ?? ""} hs`}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 min-w-0">
                <dt className="text-muted-foreground shrink-0">Servicio</dt>
                <dd className="font-medium text-foreground text-right min-w-0 break-words">
                  {deletingPayment.serviceOtherDetail ||
                    formatServiceName(deletingPayment.serviceName)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 min-w-0">
                <dt className="text-muted-foreground shrink-0">Método de pago</dt>
                <dd className="font-medium text-foreground text-right min-w-0">
                  {formatPaymentMethodLabel(deletingPayment.paymentMethod || "")}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 min-w-0">
                <dt className="text-muted-foreground shrink-0">Importe</dt>
                <dd className="font-semibold text-foreground text-right min-w-0">
                  {money(deletingPayment.collectedAmountArs || 0)}
                </dd>
              </div>
            </dl>
          )}
          <div
            className="v2-dialog-actions w-full flex-nowrap sm:justify-end"
            style={{ flexWrap: "nowrap" }}
          >
            <button
              type="button"
              className="v2-secondary flex-1 min-w-0 sm:flex-none"
              onClick={() => setDeletingPayment(null)}
              disabled={editBusy}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="v2-destructive action-reject flex-1 min-w-0 sm:flex-none"
              onClick={handleConfirmDelete}
              disabled={editBusy}
            >
              {editBusy ? "Anulando…" : "Anular pago"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
