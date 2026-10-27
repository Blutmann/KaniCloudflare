import { useRef, useState, type FormEvent } from "react";
import { useSearch } from "@tanstack/react-router";
import { CheckCircle2, Tag, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { businessDateToday, addCalendarDays } from "@/lib/kani-mobile-appointments";
import { money } from "@/lib/kani-model";
import { paymentSummary, scopeV2 } from "@/lib/kani-v2";
import type { PaymentMethod, ServicePaymentType } from "@/lib/kani-payments";
import { BarberFilter, Empty } from "./shared";
import { useV2 } from "./data";

export function V2Payments() {
  const data = useV2();
  const staff = useAdminStaff();
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
  const [date, setDate] = useState(today);
  const [period, setPeriod] = useState("DAY");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const paid = new Set(data.payments.map((p) => p.appointmentId));
  const choices = data.appointments.filter(
    (a) => ["CONFIRMED", "COMPLETED"].includes(a.statusCode) && !paid.has(a.id) && a.date <= today,
  );
  const appointment =
    origin === "appointment" ? choices.find((a) => a.id === appointmentId) : undefined;
  const service = data.services.find((s) => s.name === serviceName);
  const price =
    priceOverride ?? (appointment ? (appointment.servicePrice ?? 0) : (service?.price ?? 0));
  const deposit = appointment?.depositPaid ? (appointment.depositAmountArs ?? 5000) : 0;
  const total = Math.max(0, price - discount - deposit);
  const history = scopeV2(
    data.payments,
    staff.profile.role,
    staff.profile.barber_id,
    data.barberId,
  ).filter(
    (p) =>
      p.paymentDate <= date &&
      p.paymentDate >= (period === "WEEK" ? addCalendarDays(date, -6) : date),
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

      // Use only the existing transactional RPC: no direct-insert fallback after errors.
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
  return (
    <main className="v2-page">
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
                      required
                    >
                      <option value="">Elegí un turno para cobrar</option>
                      {choices.map((a) => (
                        <option value={a.id} key={a.id}>
                          {a.date} · {a.time} · {a.name} · {a.barber}
                        </option>
                      ))}
                    </select>
                  </label>
                  {appointment && (
                    <div className="v2-payment-client">
                      <h2>{appointment.name}</h2>
                      <p>
                        {appointment.serviceName} · {appointment.barber}
                      </p>
                      <p>
                        {appointment.date} · {appointment.time}
                      </p>
                    </div>
                  )}
                  {!data.depositSupported && (
                    <p className="v2-alert">
                      No se pueden verificar las señas de estos turnos. El cobro con turno está
                      bloqueado hasta que esa información esté disponible.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="v2-form-row">
                    <label className="v2-field">
                      Servicio
                      <select
                        value={serviceName}
                        onChange={(e) => {
                          setServiceName(e.target.value);
                          setPriceOverride(null);
                          setDiscount(0);
                        }}
                        required
                      >
                        {data.services.map((s) => (
                          <option key={s.id} value={s.name}>
                            {s.name}
                          </option>
                        ))}
                        <option value="Otro">Otro</option>
                      </select>
                    </label>
                    {staff.profile.role === "ADMIN" && (
                      <label className="v2-field">
                        Barbero
                        <select
                          value={barberId}
                          onChange={(e) => setBarberId(e.target.value)}
                          required
                        >
                          {staff.barbers.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {serviceName === "Otro" && (
                    <label className="v2-field">
                      Nombre del servicio
                      <input
                        type="text"
                        required
                        placeholder="Ej. Tintura de color"
                        value={customServiceName}
                        onChange={(e) => setCustomServiceName(e.target.value)}
                      />
                    </label>
                  )}
                </>
              )}
              <label className="v2-field">
                Método de pago
                <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  <option>Efectivo</option>
                  <option>Transferencia</option>
                </select>
              </label>
              <label className="v2-field">
                Importe ($ ARS)
                <input
                  type="number"
                  min={1}
                  step={1}
                  required
                  placeholder={serviceName === "Otro" ? "Ej. 35000" : "0"}
                  value={price || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPriceOverride(val === "" ? null : Number(val));
                  }}
                />
              </label>

              <div className="v2-payment-actions-row">
                {origin === "walk_in" && (
                  <button
                    className={`v2-secondary ${showClient ? "v2-active" : ""}`}
                    type="button"
                    aria-expanded={showClient}
                    onClick={() => setShowClient(!showClient)}
                  >
                    <User size={14} />
                    <span>{showClient ? "Ocultar cliente" : "Asociar cliente"}</span>
                  </button>
                )}
                <button
                  className={`v2-secondary ${showDiscount ? "v2-active" : ""}`}
                  type="button"
                  aria-expanded={showDiscount}
                  onClick={() => {
                    const next = !showDiscount;
                    setShowDiscount(next);
                    if (!next) setDiscount(0);
                  }}
                >
                  <Tag size={14} />
                  <span>{showDiscount ? "Quitar descuento" : "Agregar descuento"}</span>
                </button>
              </div>

              {origin === "walk_in" && showClient && (
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
                  <p>
                    Se guardan nombre y contacto en el cobro. La vinculación permanente con la
                    ficha se incorporará en la próxima etapa.
                  </p>
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

              <div className="v2-payment-summary-block">
                <div className="v2-summary-line">
                  <span className="v2-summary-label">Importe</span>
                  <span className="v2-summary-value">{money(price)}</span>
                </div>
                {discount > 0 && (
                  <div className="v2-summary-line v2-summary-discount">
                    <span className="v2-summary-label">Descuento</span>
                    <span className="v2-summary-value">- {money(discount)}</span>
                  </div>
                )}
                {appointment && (
                  <div className="v2-summary-line v2-summary-deposit">
                    <span className="v2-summary-label">Seña abonada</span>
                    <span className="v2-summary-value">
                      {!data.depositSupported
                        ? "Sin dato"
                        : deposit > 0
                          ? `- ${money(deposit)}`
                          : "$0"}
                    </span>
                  </div>
                )}
                <div className="v2-summary-divider" />
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
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="DAY">Un día</option>
              <option value="WEEK">Últimos 7 días</option>
            </select>
          </label>
          <label className="v2-field">
            Hasta
            <input type="date" value={date} onChange={(e) => setDate(e.target.value || today)} />
          </label>
          <BarberFilter />
        </div>
        <div className="v2-history-total">
          <strong>{money(summary.collected)}</strong>
          <span>
            Cobrado en el local · valor de servicios {money(summary.value)} · señas previas{" "}
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
                {p.paymentDate} · {p.paymentTime} · {p.paymentMethod}
              </small>
            </div>
            <strong>{money(p.collectedAmountArs)}</strong>
          </article>
        ))}
      </section>
    </main>
  );
}
