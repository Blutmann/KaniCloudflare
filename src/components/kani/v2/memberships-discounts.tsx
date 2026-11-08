import { useMemo, useState, type FormEvent } from "react";
import { Calendar, CheckCircle2, CreditCard, History, PackageCheck, Plus, RefreshCw, Tag } from "lucide-react";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { isStaffOperator } from "@/lib/kani-permissions";
import { businessDateToday, addCalendarDays } from "@/lib/kani-mobile-appointments";
import { money, dateLabel, formatServiceName } from "@/lib/kani-model";
import {
  calculateMembershipPricing,
  consumeMembershipSession,
  createClientMembership,
  KANI_MEMBERSHIP_PAYMENT_METHODS,
  MEMBERSHIP_STATUS_LABELS,
  modifyRecurringAppointmentSeries,
  refundMembershipSession,
  registerMembershipPayment,
  updateClientMembershipDetails,
  type ClientMembershipRecord,
  type KaniMembershipPaymentMethod,
  type MembershipAllowedServiceName,
  type MembershipConsumptionType,
  type MembershipPackageSize,
  type MembershipStatus,
} from "@/lib/kani-recurrences-memberships";
import { BenefitCodesAdminSection } from "@/components/kani/admin-benefit-codes-section";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useV2 } from "./data";
import { V2Discounts } from "./discounts";
import { AdminFilterCell, AdminFilterPanel, Empty, Metric } from "./shared";

const SERVICE_DEFAULT_PRICES: Record<MembershipAllowedServiceName, number> = {
  Corte: 25000,
  Barba: 19000,
  "Corte y barba": 28000,
};

export function V2MembershipsAndDiscounts({
  initialTab = "MEMBRESIAS",
}: {
  initialTab?: "MEMBRESIAS" | "DESCUENTOS";
}) {
  const data = useV2();
  const staff = useAdminStaff();
  const isOperator = isStaffOperator(staff.profile.role);
  const isAdmin = staff.profile.role === "ADMIN";
  const today = businessDateToday();
  const soonThreshold = addCalendarDays(today, 30);

  const [activeTab, setActiveTab] = useState<"MEMBRESIAS" | "DESCUENTOS">(
    !isOperator && initialTab === "DESCUENTOS" ? "MEMBRESIAS" : initialTab,
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | MembershipStatus>("ALL");
  const [barberFilter, setBarberFilter] = useState<string>(
    isOperator ? "ALL" : (staff.profile.barber_id ?? ""),
  );
  const [notice, setNotice] = useState("");
  const [errorNotice, setErrorNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Create Membership Modal State
  const [createOpen, setCreateOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [barberId, setBarberId] = useState(
    !isOperator && staff.profile.barber_id
      ? staff.profile.barber_id
      : (staff.barbers[0]?.id ?? "lautaro"),
  );
  const [packageSize, setPackageSize] = useState<MembershipPackageSize>(4);
  const [qtyCorte, setQtyCorte] = useState<number>(4);
  const [qtyBarba, setQtyBarba] = useState<number>(0);
  const [qtyCorteBarba, setQtyCorteBarba] = useState<number>(0);
  const [expirationMode, setExpirationMode] = useState<"NONE" | "DATE">("NONE");
  const [expiresAt, setExpiresAt] = useState(addCalendarDays(today, 90));
  const [payImmediately, setPayImmediately] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<KaniMembershipPaymentMethod>("Transferencia");
  const [createNotes, setCreateNotes] = useState("");

  // Detail & History Modal
  const [detailMembershipId, setDetailMembershipId] = useState<string | null>(null);

  // Register Payment Modal
  const [payModalMembership, setPayModalMembership] = useState<ClientMembershipRecord | null>(null);
  const [payModalMethod, setPayModalMethod] = useState<KaniMembershipPaymentMethod>("Transferencia");

  // Consume Session Modal
  const [consumeModalMembership, setConsumeModalMembership] = useState<ClientMembershipRecord | null>(null);
  const [consumeServiceName, setConsumeServiceName] = useState<MembershipAllowedServiceName>("Corte");
  const [consumeType, setConsumeType] = useState<MembershipConsumptionType>("SERVICE_COMPLETED");
  const [consumeAppointmentId, setConsumeAppointmentId] = useState<string>("");
  const [consumeNotes, setConsumeNotes] = useState("");

  // Refund Confirmation Modal
  const [refundTarget, setRefundTarget] = useState<{
    membership: ClientMembershipRecord;
    consumptionId: string;
    serviceName: string;
  } | null>(null);
  const [refundNotes, setRefundNotes] = useState("");

  // Edit Expiration Modal
  const [editExpirationMembership, setEditExpirationMembership] = useState<ClientMembershipRecord | null>(null);
  const [editExpMode, setEditExpMode] = useState<"NONE" | "DATE">("NONE");
  const [editExpDate, setEditExpDate] = useState("");
  const [editExpNotes, setEditExpNotes] = useState("");

  // Exhausted Membership Warning Modal (FASE 7)
  const [exhaustedMembership, setExhaustedMembership] = useState<ClientMembershipRecord | null>(null);
  const [confirmEndRecurrence, setConfirmEndRecurrence] = useState(false);

  const scopedMemberships = useMemo(() => {
    return (data.memberships ?? []).filter((m) => {
      if (!isOperator && m.barberId && m.barberId !== staff.profile.barber_id) {
        return false;
      }
      if (isOperator && barberFilter !== "ALL" && m.barberId !== barberFilter) {
        return false;
      }
      if (statusFilter !== "ALL" && m.status !== statusFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const client = data.clients.find((c) => c.id === m.clientId);
        const hay = `${m.clientName ?? ""} ${client?.name ?? ""} ${client?.phone ?? ""} ${client?.email ?? ""} ${m.planName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data.memberships, data.clients, isOperator, staff.profile.barber_id, barberFilter, statusFilter, search]);

  const kpiActive = scopedMemberships.filter((m) => m.status === "ACTIVE").length;
  const kpiPending = scopedMemberships.filter((m) => m.status === "PENDING_PAYMENT").length;
  const kpiExpiringSoon = scopedMemberships.filter(
    (m) => m.status === "ACTIVE" && m.expiresAt && m.expiresAt >= today && m.expiresAt <= soonThreshold,
  ).length;
  const kpiRemainingSessions = scopedMemberships
    .filter((m) => m.status === "ACTIVE")
    .reduce((acc, m) => acc + m.remainingSessions, 0);

  const currentQuantitySum = qtyCorte + qtyBarba + qtyCorteBarba;

  const livePricing = useMemo(() => {
    const items = [
      {
        serviceName: "Corte" as const,
        quantity: qtyCorte,
        unitPriceArs: SERVICE_DEFAULT_PRICES.Corte,
      },
      {
        serviceName: "Barba" as const,
        quantity: qtyBarba,
        unitPriceArs: SERVICE_DEFAULT_PRICES.Barba,
      },
      {
        serviceName: "Corte y barba" as const,
        quantity: qtyCorteBarba,
        unitPriceArs: SERVICE_DEFAULT_PRICES["Corte y barba"],
      },
    ].filter((i) => i.quantity > 0);
    return calculateMembershipPricing(packageSize, items);
  }, [packageSize, qtyCorte, qtyBarba, qtyCorteBarba]);

  const detailMembership = useMemo(
    () => (data.memberships ?? []).find((m) => m.id === detailMembershipId) ?? null,
    [data.memberships, detailMembershipId],
  );

  function handlePackageSizeChange(next: MembershipPackageSize) {
    setPackageSize(next);
    setQtyCorte(next);
    setQtyBarba(0);
    setQtyCorteBarba(0);
  }

  function openRenewalModal(m: ClientMembershipRecord) {
    setExhaustedMembership(null);
    setConfirmEndRecurrence(false);
    setClientId(m.clientId);
    setBarberId(m.barberId || staff.profile.barber_id || (staff.barbers[0]?.id ?? "lautaro"));
    setPackageSize(m.packageSize);
    const c = m.items.find((i) => i.serviceName === "Corte")?.totalQuantity ?? m.packageSize;
    const b = m.items.find((i) => i.serviceName === "Barba")?.totalQuantity ?? 0;
    const cb = m.items.find((i) => i.serviceName === "Corte y barba")?.totalQuantity ?? 0;
    setQtyCorte(c);
    setQtyBarba(b);
    setQtyCorteBarba(cb);
    setExpirationMode(m.expiresAt ? "DATE" : "NONE");
    setExpiresAt(addCalendarDays(today, 90));
    setPayImmediately(true);
    setCreateNotes(`Renovación de ${m.planName}`);
    setCreateOpen(true);
  }

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorNotice("");
    setNotice("");
    if (!clientId) {
      setErrorNotice("Seleccioná un cliente para asociar la membresía.");
      return;
    }
    if (!livePricing.isValidComposition) {
      setErrorNotice(livePricing.validationError || "La composición de servicios no es válida.");
      return;
    }
    setBusy(true);
    try {
      const client = data.clients.find((c) => c.id === clientId);
      await createClientMembership(
        {
          clientId,
          barberId,
          packageSize,
          items: livePricing.items.map((item) => ({
            serviceName: item.serviceName,
            quantity: item.quantity,
            unitPriceArs: item.unitPriceArs,
          })),
          expiresAt: expirationMode === "DATE" ? expiresAt : null,
          notes: createNotes.trim() || null,
          paymentNow: payImmediately,
          paymentMethod,
        },
        staff,
        client ? { name: client.name, phone: client.phone, email: client.email } : undefined,
      );
      setCreateOpen(false);
      setNotice(
        payImmediately
          ? "Membresía creada y activada con pago registrado."
          : "Membresía creada en estado Pendiente de pago.",
      );
      await data.refresh();
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : "No se pudo crear la membresía.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRegisterPayment() {
    if (!payModalMembership || busy) return;
    setBusy(true);
    setErrorNotice("");
    try {
      await registerMembershipPayment(payModalMembership.id, payModalMethod, staff);
      setPayModalMembership(null);
      setNotice("Pago registrado. La membresía ahora está Activa.");
      await data.refresh();
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : "No se pudo registrar el pago.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConsumeSession() {
    if (!consumeModalMembership || busy) return;
    setBusy(true);
    setErrorNotice("");
    try {
      const res = await consumeMembershipSession(
        {
          membershipId: consumeModalMembership.id,
          serviceName: consumeServiceName,
          appointmentId: consumeAppointmentId || null,
          consumptionType: consumeType,
          notes: consumeNotes.trim() || null,
        },
        staff,
      );
      setConsumeModalMembership(null);
      setConsumeNotes("");
      setConsumeAppointmentId("");
      await data.refresh();
      if (res.isExhausted) {
        setExhaustedMembership(res.membership);
      } else {
        setNotice(`Sesión consumida correctamente. Sesiones restantes: ${res.remainingSessions}.`);
      }
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : "No se pudo consumir la sesión.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefundSession() {
    if (!refundTarget || busy) return;
    setBusy(true);
    setErrorNotice("");
    try {
      const res = await refundMembershipSession(
        {
          consumptionId: refundTarget.consumptionId,
          membershipId: refundTarget.membership.id,
          reason: refundNotes.trim() || "Reintegro autorizado por personal",
        },
        staff,
      );
      setRefundTarget(null);
      setRefundNotes("");
      setNotice(`Sesión reintegrada al cliente. Sesiones disponibles: ${res.remainingSessions}.`);
      await data.refresh();
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : "No se pudo reintegrar la sesión.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveExpiration() {
    if (!editExpirationMembership || busy) return;
    setBusy(true);
    setErrorNotice("");
    try {
      await updateClientMembershipDetails(
        {
          membershipId: editExpirationMembership.id,
          expiresAt: editExpMode === "DATE" && editExpDate ? editExpDate : null,
          clearExpiration: editExpMode === "NONE",
          notes: editExpNotes.trim() || null,
        },
        staff,
      );
      setEditExpirationMembership(null);
      setNotice("Fecha de vencimiento actualizada y auditada en el historial.");
      await data.refresh();
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : "No se pudo actualizar el vencimiento.");
    } finally {
      setBusy(false);
    }
  }

  const futureRecurringAppointmentsForExhausted = useMemo(() => {
    if (!exhaustedMembership) return [];
    return (data.appointments ?? []).filter(
      (a) =>
        a.clientId === exhaustedMembership.clientId &&
        a.date >= today &&
        ["PENDING", "CONFIRMED"].includes(a.statusCode) &&
        Boolean(a.recurringRuleId || a.membershipId === exhaustedMembership.id),
    );
  }, [exhaustedMembership, data.appointments, today]);

  async function handleEndAssociatedRecurrence() {
    if (!exhaustedMembership || busy) return;
    setBusy(true);
    try {
      const firstRecurring = futureRecurringAppointmentsForExhausted.find((a) => a.recurringRuleId);
      if (firstRecurring) {
        await modifyRecurringAppointmentSeries(
          {
            appointmentId: firstRecurring.id,
            scope: "ALL_FUTURE",
            action: "CANCEL",
          },
          staff,
        );
      }
      setExhaustedMembership(null);
      setConfirmEndRecurrence(false);
      setNotice("Se finalizó la recurrencia asociada a la membresía agotada.");
      await data.refresh();
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : "No se pudo finalizar la recurrencia.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="v2-page v2-memberships-page">
      <section className="v2-panel" style={{ padding: "16px 18px" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            borderBottom: "1px solid var(--border)",
            paddingBottom: "12px",
          }}
        >
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>
              Membresías y descuentos
            </h1>
            <p style={{ fontSize: "12.5px", color: "var(--muted-foreground)", margin: "2px 0 0" }}>
              Gestión integral de paquetes prepagados de 4 y 10 servicios, sesiones y códigos de beneficio.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Pestañas de Membresías y descuentos"
            style={{
              display: "inline-flex",
              gap: "6px",
              padding: "4px",
              borderRadius: "10px",
              background: "var(--v2-inset, rgba(255,255,255,0.04))",
              border: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "MEMBRESIAS"}
              className={activeTab === "MEMBRESIAS" ? "v2-primary" : "v2-secondary"}
              style={{ minHeight: "34px", padding: "0 14px", fontSize: "12.5px" }}
              onClick={() => setActiveTab("MEMBRESIAS")}
            >
              <PackageCheck size={15} />
              <span>Membresías</span>
            </button>
            {isOperator && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "DESCUENTOS"}
                className={activeTab === "DESCUENTOS" ? "v2-primary" : "v2-secondary"}
                style={{ minHeight: "34px", padding: "0 14px", fontSize: "12.5px" }}
                onClick={() => setActiveTab("DESCUENTOS")}
              >
                <Tag size={15} />
                <span>Descuentos</span>
              </button>
            )}
          </div>
        </div>

        {notice && (
          <p role="status" className="v2-success" style={{ marginTop: "12px" }}>
            {notice}
          </p>
        )}
        {errorNotice && (
          <p role="alert" className="v2-alert" style={{ marginTop: "12px" }}>
            {errorNotice}
          </p>
        )}

        {activeTab === "MEMBRESIAS" ? (
          <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="v2-metrics">
              <Metric label="Membresías activas" value={kpiActive} />
              <Metric label="Pendientes de pago" value={kpiPending} />
              <Metric label="Próximas a vencer" value={kpiExpiringSoon} />
              <Metric label="Sesiones restantes" value={kpiRemainingSessions} />
            </div>

            <AdminFilterPanel ariaLabel="Filtros de membresías">
              <AdminFilterCell label="Buscar cliente" htmlFor="v2-memberships-search">
                <input
                  id="v2-memberships-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nombre, teléfono o paquete"
                />
              </AdminFilterCell>
              <AdminFilterCell label="Estado" htmlFor="v2-memberships-status">
                <select
                  id="v2-memberships-status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "ALL" | MembershipStatus)}
                >
                  <option value="ALL">Todos los estados</option>
                  <option value="ACTIVE">Activa</option>
                  <option value="PENDING_PAYMENT">Pendiente de pago</option>
                  <option value="EXHAUSTED">Agotada</option>
                  <option value="EXPIRED">Vencida</option>
                  <option value="CANCELLED">Cancelada</option>
                </select>
              </AdminFilterCell>
              <AdminFilterCell label="Barbero" htmlFor="v2-memberships-barber">
                <select
                  id="v2-memberships-barber"
                  value={isOperator ? barberFilter : (staff.profile.barber_id ?? "")}
                  onChange={(e) => setBarberFilter(e.target.value)}
                  disabled={!isOperator}
                >
                  {isOperator && <option value="ALL">Todo Kani</option>}
                  {staff.barbers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </AdminFilterCell>
            </AdminFilterPanel>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
              }}
            >
              <span style={{ fontSize: "13px", color: "var(--muted-foreground)" }}>
                {scopedMemberships.length === 1
                  ? "1 membresía encontrada"
                  : `${scopedMemberships.length} membresías encontradas`}
              </span>
              <button
                type="button"
                className="v2-primary"
                onClick={() => {
                  setErrorNotice("");
                  if (!clientId && data.clients[0]) {
                    setClientId(data.clients[0].id);
                  }
                  setCreateOpen(true);
                }}
              >
                <Plus size={16} />
                <span>Nueva membresía</span>
              </button>
            </div>

            {!scopedMemberships.length ? (
              <Empty>
                No hay membresías registradas para este filtro. Podés crear una Membresía 4 servicios (10% OFF) o Membresía 10 servicios (15% OFF).
              </Empty>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
                  gap: "12px",
                }}
              >
                {scopedMemberships.map((m) => {
                  const client = data.clients.find((c) => c.id === m.clientId);
                  const barber = staff.barbers.find((b) => b.id === m.barberId);
                  return (
                    <article
                      key={m.id}
                      className="v2-panel"
                      style={{
                        padding: "14px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: "10px",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "8px",
                          }}
                        >
                          <strong style={{ fontSize: "14px" }}>{m.planName}</strong>
                          <span
                            className="v2-manual-badge"
                            style={{
                              background:
                                m.status === "ACTIVE"
                                  ? "rgba(16, 185, 129, 0.14)"
                                  : m.status === "PENDING_PAYMENT"
                                    ? "rgba(234, 179, 8, 0.16)"
                                    : "rgba(148, 163, 184, 0.15)",
                              color:
                                m.status === "ACTIVE"
                                  ? "#10b981"
                                  : m.status === "PENDING_PAYMENT"
                                    ? "#eab308"
                                    : "var(--muted-foreground)",
                            }}
                          >
                            {MEMBERSHIP_STATUS_LABELS[m.status]}
                          </span>
                        </div>

                        <div style={{ fontSize: "13px", fontWeight: 600 }}>
                          {m.clientName || client?.name || "Cliente"}
                          {barber?.name || m.barberName ? (
                            <span style={{ fontWeight: 400, color: "var(--muted-foreground)" }}>
                              {" "}
                              · {barber?.name || m.barberName}
                            </span>
                          ) : null}
                        </div>

                        <div
                          style={{
                            padding: "8px 10px",
                            borderRadius: "8px",
                            background: "var(--v2-inset, rgba(255,255,255,0.03))",
                            fontSize: "12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>Sesiones disponibles:</span>
                            <strong>
                              {m.remainingSessions} de {m.totalSessions}
                            </strong>
                          </div>
                          <div style={{ color: "var(--muted-foreground)", fontSize: "11.5px" }}>
                            {m.items
                              .map(
                                (item) =>
                                  `${item.serviceName}: ${item.remainingQuantity}/${item.totalQuantity}`,
                              )
                              .join(" · ")}
                          </div>
                        </div>

                        <div
                          style={{
                            fontSize: "11.5px",
                            color: "var(--muted-foreground)",
                            display: "flex",
                            flexWrap: "wrap",
                            justifyContent: "space-between",
                            gap: "4px",
                          }}
                        >
                          <span>
                            Total ({m.discountPercent}% OFF):{" "}
                            <strong style={{ color: "var(--foreground)" }}>
                              {money(m.totalPriceArs)}
                            </strong>
                          </span>
                          <span>
                            {m.expiresAt ? `Vence: ${dateLabel(m.expiresAt)}` : "Sin vencimiento"}
                          </span>
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "6px",
                          paddingTop: "8px",
                          borderTop: "1px solid var(--border)",
                        }}
                      >
                        {m.status === "PENDING_PAYMENT" && (
                          <button
                            type="button"
                            className="v2-primary"
                            style={{ minHeight: "32px", padding: "0 10px", fontSize: "12px" }}
                            onClick={() => {
                              setPayModalMembership(m);
                              setPayModalMethod("Transferencia");
                            }}
                          >
                            <CreditCard size={13} />
                            <span>Registrar pago</span>
                          </button>
                        )}
                        {m.status === "ACTIVE" && m.remainingSessions > 0 && (
                          <button
                            type="button"
                            className="v2-primary"
                            style={{ minHeight: "32px", padding: "0 10px", fontSize: "12px" }}
                            onClick={() => {
                              const availableItem =
                                m.items.find((i) => i.remainingQuantity > 0) ?? m.items[0];
                              setConsumeModalMembership(m);
                              setConsumeServiceName(availableItem?.serviceName ?? "Corte");
                              setConsumeType("SERVICE_COMPLETED");
                              setConsumeAppointmentId("");
                              setConsumeNotes("");
                            }}
                          >
                            <CheckCircle2 size={13} />
                            <span>Registrar consumo</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="v2-secondary"
                          style={{ minHeight: "32px", padding: "0 10px", fontSize: "12px" }}
                          onClick={() => setDetailMembershipId(m.id)}
                        >
                          <History size={13} />
                          <span>Detalle e historial</span>
                        </button>
                        <button
                          type="button"
                          className="v2-secondary"
                          style={{ minHeight: "32px", padding: "0 10px", fontSize: "12px" }}
                          onClick={() => {
                            setEditExpirationMembership(m);
                            setEditExpMode(m.expiresAt ? "DATE" : "NONE");
                            setEditExpDate(m.expiresAt || addCalendarDays(today, 90));
                            setEditExpNotes(m.notes || "");
                          }}
                        >
                          <Calendar size={13} />
                          <span>Vencimiento</span>
                        </button>
                        {m.status === "EXHAUSTED" && (
                          <button
                            type="button"
                            className="v2-secondary"
                            style={{ minHeight: "32px", padding: "0 10px", fontSize: "12px" }}
                            onClick={() => openRenewalModal(m)}
                          >
                            <RefreshCw size={13} />
                            <span>Renovar</span>
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        ) : !isOperator ? (
          <p role="alert" className="v2-alert" style={{ marginTop: "16px" }}>
            No tenés permisos para consultar ni gestionar códigos de descuento.
          </p>
        ) : isAdmin ? (
          <div style={{ marginTop: "16px" }}>
            <BenefitCodesAdminSection />
          </div>
        ) : (
          <div style={{ marginTop: "16px" }}>
            <V2Discounts />
          </div>
        )}
      </section>

      {/* Modal: Crear Nueva Membresía */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open && !busy) setCreateOpen(false);
        }}
      >
        <DialogContent className="v2-dialog" style={{ maxWidth: "540px" }}>
          <DialogTitle>Nueva membresía prepagada</DialogTitle>
          <DialogDescription>
            Configurá la combinación de servicios. Los precios actuales quedan congelados en la membresía al crearse.
          </DialogDescription>
          <form onSubmit={handleCreateSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <label className="v2-field">
                <span className="v2-field-label">Cliente titular (individual)</span>
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  required
                >
                  <option value="">Seleccionar cliente…</option>
                  {data.clients
                    .filter((c) => !c.archived)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.phone ? `(${c.phone})` : ""}
                      </option>
                    ))}
                </select>
              </label>

              <label className="v2-field">
                <span className="v2-field-label">Barbero asignado</span>
                <select
                  value={barberId}
                  onChange={(e) => setBarberId(e.target.value)}
                  disabled={!isOperator}
                >
                  {staff.barbers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="v2-field">
              <span className="v2-field-label">Tipo de membresía</span>
              <select
                value={packageSize}
                onChange={(e) =>
                  handlePackageSizeChange((Number(e.target.value) === 10 ? 10 : 4) as MembershipPackageSize)
                }
              >
                <option value={4}>Membresía 4 servicios (10% de descuento)</option>
                <option value={10}>Membresía 10 servicios (15% de descuento)</option>
              </select>
            </label>

            <div
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                <strong>Composición de servicios permitidos</strong>
                <span
                  style={{
                    color: currentQuantitySum === packageSize ? "#10b981" : "#eab308",
                    fontWeight: 600,
                  }}
                >
                  Suma: {currentQuantitySum} / {packageSize} sesiones
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                <label className="v2-field">
                  <span className="v2-field-label">Corte ({money(25000)})</span>
                  <input
                    type="number"
                    min={0}
                    max={packageSize}
                    value={qtyCorte}
                    onChange={(e) => setQtyCorte(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
                <label className="v2-field">
                  <span className="v2-field-label">Barba ({money(19000)})</span>
                  <input
                    type="number"
                    min={0}
                    max={packageSize}
                    value={qtyBarba}
                    onChange={(e) => setQtyBarba(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
                <label className="v2-field">
                  <span className="v2-field-label">Corte y barba ({money(28000)})</span>
                  <input
                    type="number"
                    min={0}
                    max={packageSize}
                    value={qtyCorteBarba}
                    onChange={(e) => setQtyCorteBarba(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
              </div>
            </div>

            <div
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                background: "var(--v2-inset, rgba(255,255,255,0.04))",
                fontSize: "12.5px",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Subtotal sin descuento:</span>
                <span>{money(livePricing.subtotalArs)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Descuento porcentual ({livePricing.discountPercent}%):</span>
                <span style={{ color: "#10b981" }}>-{money(livePricing.discountAmountArs)}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontWeight: 700,
                  fontSize: "14px",
                  borderTop: "1px solid var(--border)",
                  paddingTop: "4px",
                  marginTop: "2px",
                }}
              >
                <span>Total final a abonar:</span>
                <span>{money(livePricing.totalPriceArs)}</span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <label className="v2-field">
                <span className="v2-field-label">Vencimiento</span>
                <select
                  value={expirationMode}
                  onChange={(e) => setExpirationMode(e.target.value as "NONE" | "DATE")}
                >
                  <option value="NONE">Sin vencimiento</option>
                  <option value="DATE">Fecha de vencimiento determinada</option>
                </select>
              </label>
              {expirationMode === "DATE" && (
                <label className="v2-field">
                  <span className="v2-field-label">Fecha de vencimiento</span>
                  <input
                    type="date"
                    value={expiresAt}
                    min={today}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                </label>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <label className="v2-field">
                <span className="v2-field-label">Estado de pago inicial</span>
                <select
                  value={payImmediately ? "PAID" : "PENDING"}
                  onChange={(e) => setPayImmediately(e.target.value === "PAID")}
                >
                  <option value="PAID">Registrar pago completo ahora (Activa)</option>
                  <option value="PENDING">Dejar Pendiente de pago</option>
                </select>
              </label>
              {payImmediately && (
                <label className="v2-field">
                  <span className="v2-field-label">Medio de pago</span>
                  <select
                    value={paymentMethod}
                    onChange={(e) =>
                      setPaymentMethod(e.target.value as KaniMembershipPaymentMethod)
                    }
                  >
                    {KANI_MEMBERSHIP_PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <label className="v2-field">
              <span className="v2-field-label">Notas u observaciones</span>
              <input
                type="text"
                value={createNotes}
                onChange={(e) => setCreateNotes(e.target.value)}
                placeholder="Opcional: detalle de acuerdo o referencia"
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
              <button
                type="button"
                className="v2-secondary"
                disabled={busy}
                onClick={() => setCreateOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="v2-primary"
                disabled={busy || !livePricing.isValidComposition}
              >
                {busy ? "Guardando…" : "Crear membresía"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Registrar Pago de Membresía Pendiente */}
      <Dialog
        open={!!payModalMembership}
        onOpenChange={(open) => {
          if (!open && !busy) setPayModalMembership(null);
        }}
      >
        <DialogContent className="v2-dialog">
          <DialogTitle>Registrar pago de membresía</DialogTitle>
          <DialogDescription>
            {payModalMembership?.planName} · Total a cobrar:{" "}
            <strong>{money(payModalMembership?.totalPriceArs ?? 0)}</strong>. Al registrar el pago completo, la membresía pasará a estado <strong>Activa</strong> y permitirá consumir sesiones.
          </DialogDescription>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
            <label className="v2-field">
              <span className="v2-field-label">Medio de pago</span>
              <select
                value={payModalMethod}
                onChange={(e) => setPayModalMethod(e.target.value as KaniMembershipPaymentMethod)}
              >
                {KANI_MEMBERSHIP_PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
              <button
                type="button"
                className="v2-secondary"
                disabled={busy}
                onClick={() => setPayModalMembership(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="v2-primary"
                disabled={busy}
                onClick={() => void handleRegisterPayment()}
              >
                {busy ? "Procesando…" : "Confirmar pago y activar"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Registrar Consumo de Sesión */}
      <Dialog
        open={!!consumeModalMembership}
        onOpenChange={(open) => {
          if (!open && !busy) setConsumeModalMembership(null);
        }}
      >
        <DialogContent className="v2-dialog">
          <DialogTitle>Registrar consumo de sesión</DialogTitle>
          <DialogDescription>
            {consumeModalMembership?.planName} · Sesiones disponibles:{" "}
            {consumeModalMembership?.remainingSessions}.
          </DialogDescription>
          {consumeModalMembership && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
              <label className="v2-field">
                <span className="v2-field-label">Servicio a descontar</span>
                <select
                  value={consumeServiceName}
                  onChange={(e) =>
                    setConsumeServiceName(e.target.value as MembershipAllowedServiceName)
                  }
                >
                  {consumeModalMembership.items.map((item) => (
                    <option
                      key={item.id}
                      value={item.serviceName}
                      disabled={item.remainingQuantity <= 0}
                    >
                      {item.serviceName} (Disponibles: {item.remainingQuantity}/{item.totalQuantity})
                    </option>
                  ))}
                </select>
              </label>

              <label className="v2-field">
                <span className="v2-field-label">Motivo del consumo</span>
                <select
                  value={consumeType}
                  onChange={(e) => setConsumeType(e.target.value as MembershipConsumptionType)}
                >
                  <option value="SERVICE_COMPLETED">Servicio realizado</option>
                  <option value="NO_SHOW_DEDUCTION">Descontar sesión por inasistencia</option>
                </select>
              </label>

              <label className="v2-field">
                <span className="v2-field-label">Turno vinculado (opcional)</span>
                <select
                  value={consumeAppointmentId}
                  onChange={(e) => setConsumeAppointmentId(e.target.value)}
                >
                  <option value="">Sin turno específico / registro directo</option>
                  {(data.appointments ?? [])
                    .filter(
                      (a) =>
                        a.clientId === consumeModalMembership.clientId &&
                        a.statusCode !== "CANCELLED" &&
                        !a.membershipConsumptionId,
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.date} · {a.time} — {formatServiceName(a.serviceName)}
                      </option>
                    ))}
                </select>
              </label>

              <label className="v2-field">
                <span className="v2-field-label">Observación</span>
                <input
                  type="text"
                  value={consumeNotes}
                  onChange={(e) => setConsumeNotes(e.target.value)}
                  placeholder="Opcional"
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
                <button
                  type="button"
                  className="v2-secondary"
                  disabled={busy}
                  onClick={() => setConsumeModalMembership(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="v2-primary"
                  disabled={busy}
                  onClick={() => void handleConsumeSession()}
                >
                  {busy ? "Registrando…" : "Confirmar consumo"}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal: Detalle e Historial de Membresía */}
      <Dialog
        open={!!detailMembership}
        onOpenChange={(open) => {
          if (!open) setDetailMembershipId(null);
        }}
      >
        <DialogContent className="v2-dialog" style={{ maxWidth: "560px" }}>
          <DialogTitle>{detailMembership?.planName}</DialogTitle>
          <DialogDescription>
            Estado:{" "}
            <strong>
              {detailMembership ? MEMBERSHIP_STATUS_LABELS[detailMembership.status] : ""}
            </strong>{" "}
            · Subtotal: {money(detailMembership?.subtotalArs ?? 0)} · Descuento (
            {detailMembership?.discountPercent}%): -{money(detailMembership?.discountAmountArs ?? 0)}{" "}
            · Total congelado: <strong>{money(detailMembership?.totalPriceArs ?? 0)}</strong>
          </DialogDescription>
          {detailMembership && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                marginTop: "10px",
                maxHeight: "65vh",
                overflowY: "auto",
              }}
            >
              <div>
                <h3 style={{ fontSize: "13px", fontWeight: 700, marginBottom: "6px" }}>
                  Sesiones por servicio
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12.5px" }}>
                  {detailMembership.items.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "6px 10px",
                        borderRadius: "6px",
                        background: "var(--v2-inset, rgba(255,255,255,0.03))",
                      }}
                    >
                      <span>
                        {item.serviceName} (Tarifa congelada: {money(item.unitPriceSnapshotArs)})
                      </span>
                      <strong>
                        {item.remainingQuantity} disponibles / {item.totalQuantity} totales
                      </strong>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: "13px", fontWeight: 700, marginBottom: "6px" }}>
                  Historial de sesiones consumidas y reintegros
                </h3>
                {!detailMembership.consumptions.length ? (
                  <p style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>
                    Aún no se registraron consumos en esta membresía.
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {detailMembership.consumptions.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--border)",
                          fontSize: "12px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                        }}
                      >
                        <div>
                          <strong>{c.serviceName}</strong> ·{" "}
                          {c.consumptionType === "NO_SHOW_DEDUCTION"
                            ? "Descontada por inasistencia"
                            : "Servicio realizado"}
                          <div style={{ color: "var(--muted-foreground)", fontSize: "11px" }}>
                            {c.consumedAt.replace("T", " ").slice(0, 16)}
                            {c.status === "REFUNDED"
                              ? ` · Reintegrada (${c.refundReason || "Autorizado"})`
                              : ""}
                          </div>
                        </div>
                        {c.status === "CONSUMED" ? (
                          <button
                            type="button"
                            className="v2-secondary"
                            style={{ minHeight: "28px", padding: "0 8px", fontSize: "11.5px" }}
                            onClick={() => {
                              setRefundTarget({
                                membership: detailMembership,
                                consumptionId: c.id,
                                serviceName: c.serviceName,
                              });
                              setRefundNotes("");
                            }}
                          >
                            Reintegrar sesión
                          </button>
                        ) : (
                          <span style={{ fontSize: "11px", color: "#10b981", fontWeight: 600 }}>
                            Reintegrada
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 style={{ fontSize: "13px", fontWeight: 700, marginBottom: "6px" }}>
                  Auditoría de eventos
                </h3>
                {!detailMembership.events.length ? (
                  <p style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>
                    Sin eventos adicionales.
                  </p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "11.5px", color: "var(--muted-foreground)" }}>
                    {detailMembership.events.map((ev) => (
                      <li key={ev.id}>
                        <strong>{ev.eventType}</strong> — {ev.description} (
                        {ev.createdAt.replace("T", " ").slice(0, 16)})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal: Reintegrar Sesión (FASE 7) */}
      <Dialog
        open={!!refundTarget}
        onOpenChange={(open) => {
          if (!open && !busy) setRefundTarget(null);
        }}
      >
        <DialogContent className="v2-dialog">
          <DialogTitle>Este turno consumió una sesión de membresía. ¿Querés reintegrarla?</DialogTitle>
          <DialogDescription>
            Se devolverá 1 sesión de <strong>{refundTarget?.serviceName}</strong> a{" "}
            {refundTarget?.membership.planName}, conservando la trazabilidad completa en el historial sin borrar registros previos.
          </DialogDescription>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
            <label className="v2-field">
              <span className="v2-field-label">Motivo del reintegro</span>
              <input
                type="text"
                value={refundNotes}
                onChange={(e) => setRefundNotes(e.target.value)}
                placeholder="Ej. Cancelación acordada / corrección administrativa"
              />
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px" }}>
              <button
                type="button"
                className="v2-secondary"
                disabled={busy}
                onClick={() => setRefundTarget(null)}
              >
                Volver
              </button>
              <button
                type="button"
                className="v2-secondary"
                disabled={busy}
                onClick={() => {
                  setRefundTarget(null);
                  setNotice("Se conservó el consumo de la sesión.");
                }}
              >
                No, conservar el consumo
              </button>
              <button
                type="button"
                className="v2-primary"
                disabled={busy}
                onClick={() => void handleRefundSession()}
              >
                {busy ? "Reintegrando…" : "Sí, reintegrar sesión"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Editar Vencimiento */}
      <Dialog
        open={!!editExpirationMembership}
        onOpenChange={(open) => {
          if (!open && !busy) setEditExpirationMembership(null);
        }}
      >
        <DialogContent className="v2-dialog">
          <DialogTitle>Vigencia y vencimiento de membresía</DialogTitle>
          <DialogDescription>
            Cualquier modificación de vencimiento queda registrada con fecha y usuario en la auditoría de la membresía.
          </DialogDescription>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
            <label className="v2-field">
              <span className="v2-field-label">Modalidad de vencimiento</span>
              <select
                value={editExpMode}
                onChange={(e) => setEditExpMode(e.target.value as "NONE" | "DATE")}
              >
                <option value="NONE">Sin vencimiento</option>
                <option value="DATE">Fecha de vencimiento determinada</option>
              </select>
            </label>
            {editExpMode === "DATE" && (
              <label className="v2-field">
                <span className="v2-field-label">Fecha de vencimiento</span>
                <input
                  type="date"
                  value={editExpDate}
                  onChange={(e) => setEditExpDate(e.target.value)}
                />
              </label>
            )}
            <label className="v2-field">
              <span className="v2-field-label">Nota de auditoría</span>
              <input
                type="text"
                value={editExpNotes}
                onChange={(e) => setEditExpNotes(e.target.value)}
                placeholder="Motivo del ajuste de vigencia"
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
              <button
                type="button"
                className="v2-secondary"
                disabled={busy}
                onClick={() => setEditExpirationMembership(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="v2-primary"
                disabled={busy}
                onClick={() => void handleSaveExpiration()}
              >
                {busy ? "Guardando…" : "Guardar vencimiento"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Membresía Agotada (FASE 7) */}
      <Dialog
        open={!!exhaustedMembership}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setExhaustedMembership(null);
            setConfirmEndRecurrence(false);
          }
        }}
      >
        <DialogContent className="v2-dialog">
          <DialogTitle>Membresía agotada</DialogTitle>
          <DialogDescription>
            Se consumieron todas las sesiones disponibles de{" "}
            <strong>{exhaustedMembership?.planName}</strong>. Elegí cómo continuar con los próximos turnos del cliente:
          </DialogDescription>
          {!confirmEndRecurrence ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
              <button
                type="button"
                className="v2-primary"
                onClick={() => exhaustedMembership && openRenewalModal(exhaustedMembership)}
              >
                1. Renovar membresía
              </button>
              <button
                type="button"
                className="v2-secondary"
                onClick={() => {
                  setExhaustedMembership(null);
                  setNotice("Los próximos turnos continuarán como turnos individuales sin membresía.");
                }}
              >
                2. Continuar con turnos individuales sin membresía
              </button>
              <button
                type="button"
                className="v2-secondary action-reject"
                onClick={() => setConfirmEndRecurrence(true)}
              >
                3. Finalizar la recurrencia asociada
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" }}>
              <p style={{ fontSize: "12.5px" }}>
                <strong>Confirmar finalización de recurrencia:</strong> Se cancelarán las siguientes fechas futuras asociadas ({futureRecurringAppointmentsForExhausted.length}):
              </p>
              {futureRecurringAppointmentsForExhausted.length > 0 ? (
                <ul style={{ maxHeight: "140px", overflowY: "auto", fontSize: "12px", paddingLeft: "18px" }}>
                  {futureRecurringAppointmentsForExhausted.map((a) => (
                    <li key={a.id}>
                      {dateLabel(a.date)} · {a.time} hs — {formatServiceName(a.serviceName)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>
                  No se encontraron turnos futuros activos vinculados a una serie recurrente para este cliente.
                </p>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button
                  type="button"
                  className="v2-secondary"
                  disabled={busy}
                  onClick={() => setConfirmEndRecurrence(false)}
                >
                  Volver
                </button>
                <button
                  type="button"
                  className="v2-secondary action-reject"
                  disabled={busy}
                  onClick={() => void handleEndAssociatedRecurrence()}
                >
                  {busy ? "Finalizando…" : "Confirmar finalización"}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
