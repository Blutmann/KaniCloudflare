import { useMemo, useState, type FormEvent } from "react";
import {
  PackageCheck,
  Plus,
  RefreshCw,
  Tag,
} from "lucide-react";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { buildMembershipCardUrl } from "@/lib/kani-membership-urls";
import { isStaffOperator } from "@/lib/kani-permissions";
import { businessDateToday, addCalendarDays } from "@/lib/kani-mobile-appointments";
import { money, dateLabel, formatServiceName } from "@/lib/kani-model";
import {
  HOMOGENEOUS_MEMBERSHIP_PACKAGES,
  buildHomogeneousMembershipPricing,
  consumeMembershipSession,
  createClientMembership,
  regenerateMembershipPublicToken,
  KANI_MEMBERSHIP_PAYMENT_METHODS,
  modifyRecurringAppointmentSeries,
  refundMembershipSession,
  registerMembershipPayment,
  updateClientMembershipDetails,
  type ClientMembershipRecord,
  type HomogeneousMembershipPackageId,
  type KaniMembershipPaymentMethod,
  type MembershipConsumptionType,
  type MembershipStatus,
} from "@/lib/kani-recurrences-memberships";
import { BenefitCodesAdminSection } from "@/components/kani/admin-benefit-codes-section";
import { Dialog, DialogContent, DialogDescription, DialogTitle, KaniModalClose } from "@/components/ui/dialog";
import { AdminClientCombobox, AdminContextualSelect } from "./admin-mobile-select";
import { useV2 } from "./data";
import { V2Discounts } from "./discounts";
import { EditMembershipModal, MembershipCard } from "./MembershipCard";
import { AdminFilterCell, AdminFilterPanel, Empty, Metric } from "./shared";

export function V2MembershipsAndDiscounts({
  initialTab = "MEMBRESIAS",
  standaloneTab,
}: {
  initialTab?: "MEMBRESIAS" | "DESCUENTOS";
  standaloneTab?: "MEMBRESIAS" | "DESCUENTOS";
}) {
  const data = useV2();
  const staff = useAdminStaff();
  const isOperator = isStaffOperator(staff.profile.role);
  const canViewDiscounts = isOperator || staff.profile.role === "BARBER";
  const isAdmin = staff.profile.role === "ADMIN";
  const today = businessDateToday();
  const soonThreshold = addCalendarDays(today, 30);

  const [tabState, setTabState] = useState<"MEMBRESIAS" | "DESCUENTOS">(
    !isOperator && initialTab === "DESCUENTOS" ? "MEMBRESIAS" : initialTab,
  );
  const activeTab = standaloneTab
    ? !canViewDiscounts && standaloneTab === "DESCUENTOS"
      ? "MEMBRESIAS"
      : standaloneTab
    : tabState;
  const setActiveTab = setTabState;
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
  const [selectedPackageId, setSelectedPackageId] =
    useState<HomogeneousMembershipPackageId>("CORTE_4");
  const [expirationMode, setExpirationMode] = useState<"NONE" | "DATE">("NONE");
  const [expiresAt, setExpiresAt] = useState(addCalendarDays(today, 90));
  const [payImmediately, setPayImmediately] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<KaniMembershipPaymentMethod>("Transferencia");

  // Detail & Unified Edit Modal
  const [detailMembershipId, setDetailMembershipId] = useState<string | null>(null);

  // Exhausted Membership Warning Modal (FASE 7)
  const [exhaustedMembership, setExhaustedMembership] = useState<ClientMembershipRecord | null>(null);
  const [confirmEndRecurrence, setConfirmEndRecurrence] = useState(false);

  // Black Card & Digital Link State (b733a0b2)
  const [copiedMembershipId, setCopiedMembershipId] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);

  async function handleCopyLink(token?: string | null, membershipId?: string) {
    if (!token) return;
    const url = buildMembershipCardUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      if (membershipId) {
        setCopiedMembershipId(membershipId);
        setTimeout(() => setCopiedMembershipId(null), 2500);
      }
      setNotice("Enlace de tarjeta digital copiado al portapapeles.");
    } catch {
      setErrorNotice("No se pudo copiar el enlace automáticamente.");
    }
  }

  async function handleRegenerateToken(target: ClientMembershipRecord) {
    if (!isOperator) {
      const msg = "Solo administradores o encargados pueden regenerar enlaces.";
      setErrorNotice(msg);
      throw new Error(msg);
    }
    setIsRegenerating(true);
    try {
      const res = await regenerateMembershipPublicToken(target.id, staff);
      if (res?.publicToken) {
        target.publicToken = res.publicToken;
        target.publicTokenRevokedAt = null;
        await handleCopyLink(res.publicToken, target.id);
        setNotice(
          "Enlace regenerado con éxito y copiado al portapapeles. El enlace anterior quedó revocado.",
        );
        await data.refresh();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo regenerar el enlace.";
      setErrorNotice(msg);
      throw err instanceof Error ? err : new Error(msg);
    } finally {
      setIsRegenerating(false);
    }
  }

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

  const livePricing = useMemo(
    () => buildHomogeneousMembershipPricing(selectedPackageId),
    [selectedPackageId],
  );

  const detailMembership = useMemo(
    () => (data.memberships ?? []).find((m) => m.id === detailMembershipId) ?? null,
    [data.memberships, detailMembershipId],
  );

  function openRenewalModal(m: ClientMembershipRecord) {
    setExhaustedMembership(null);
    setConfirmEndRecurrence(false);
    setClientId(m.clientId);
    setBarberId(m.barberId || staff.profile.barber_id || (staff.barbers[0]?.id ?? "lautaro"));
    const primaryService = m.items[0]?.serviceName;
    setSelectedPackageId(
      primaryService === "Barba"
        ? "BARBA_4"
        : primaryService === "Corte y barba"
          ? "CORTE_BARBA_4"
          : "CORTE_4",
    );
    setExpirationMode(m.expiresAt ? "DATE" : "NONE");
    setExpiresAt(addCalendarDays(today, 90));
    setPayImmediately(true);
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
          packageSize: livePricing.packageSize,
          items: livePricing.items.map((item) => ({
            serviceName: item.serviceName,
            quantity: item.quantity,
            unitPriceArs: item.unitPriceArs,
          })),
          expiresAt: expirationMode === "DATE" ? expiresAt : null,
          notes: null,
          paymentNow: payImmediately,
          paymentMethod,
        },
        staff,
        client ? { name: client.name, phone: client.phone, email: client.email } : undefined,
      );
      setCreateOpen(false);
      setClientId("");
      setSelectedPackageId("CORTE_4");
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

  async function handleRegisterPayment(
    membership: ClientMembershipRecord,
    method: KaniMembershipPaymentMethod,
  ) {
    if (busy) return;
    setBusy(true);
    setErrorNotice("");
    try {
      await registerMembershipPayment(membership.id, method, staff);
      setNotice("Pago registrado. La membresía ahora está Activa.");
      await data.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo registrar el pago.";
      setErrorNotice(msg);
      throw err instanceof Error ? err : new Error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleConsumeSession(input: {
    membership: ClientMembershipRecord;
    serviceName: MembershipAllowedServiceName;
    appointmentId: string | null;
    consumptionType: MembershipConsumptionType;
    notes: string | null;
  }) {
    if (busy) return;
    setBusy(true);
    setErrorNotice("");
    try {
      const res = await consumeMembershipSession(
        {
          membershipId: input.membership.id,
          serviceName: input.serviceName,
          appointmentId: input.appointmentId,
          consumptionType: input.consumptionType,
          notes: input.notes,
        },
        staff,
      );
      await data.refresh();
      if (res.isExhausted) {
        setDetailMembershipId(null);
        setExhaustedMembership(res.membership);
      } else {
        setNotice(`Sesión consumida correctamente. Sesiones restantes: ${res.remainingSessions}.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo consumir la sesión.";
      setErrorNotice(msg);
      throw err instanceof Error ? err : new Error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleRefundSession(input: {
    membership: ClientMembershipRecord;
    consumptionId: string;
    reason: string;
  }) {
    if (busy) return;
    setBusy(true);
    setErrorNotice("");
    try {
      const res = await refundMembershipSession(
        {
          consumptionId: input.consumptionId,
          membershipId: input.membership.id,
          reason: input.reason,
        },
        staff,
      );
      setNotice(`Sesión reintegrada al cliente. Sesiones disponibles: ${res.remainingSessions}.`);
      await data.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo reintegrar la sesión.";
      setErrorNotice(msg);
      throw err instanceof Error ? err : new Error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateMembershipDetails(input: {
    membership: ClientMembershipRecord;
    expiresAt: string | null;
    notes: string | null;
  }) {
    if (busy) return;
    setBusy(true);
    setErrorNotice("");
    try {
      await updateClientMembershipDetails(
        {
          membershipId: input.membership.id,
          expiresAt: input.expiresAt,
          clearExpiration: !input.expiresAt,
          notes: input.notes,
        },
        staff,
      );
      setNotice("Vigencia y observaciones actualizadas y auditadas en el historial.");
      await data.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo actualizar el vencimiento.";
      setErrorNotice(msg);
      throw err instanceof Error ? err : new Error(msg);
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

  const hideHeaderBlock = standaloneTab === "DESCUENTOS" || standaloneTab === "MEMBRESIAS";

  return (
    <main className="v2-page v2-memberships-page">
      <section className="v2-panel" style={{ padding: "16px 18px" }}>
        {!hideHeaderBlock && (
          <div
            className="v2-memberships-header"
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

            {!standaloneTab && (
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
            )}
          </div>
        )}

        {notice && (
          <p role="status" className="v2-success" style={{ marginTop: hideHeaderBlock ? 0 : "12px" }}>
            {notice}
          </p>
        )}
        {errorNotice && (
          <p role="alert" className="v2-alert" style={{ marginTop: hideHeaderBlock && !notice ? 0 : "12px" }}>
            {errorNotice}
          </p>
        )}

        {activeTab === "MEMBRESIAS" ? (
          <div
            className="v2-memberships-stage"
            style={{
              marginTop: hideHeaderBlock && !notice && !errorNotice ? 0 : "16px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {data.membershipsError && (
              <div
                role="alert"
                className="v2-alert"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "12px 14px",
                  borderRadius: "8px",
                }}
              >
                <div>
                  <strong style={{ display: "block" }}>No se pudieron cargar las membresías</strong>
                  <span style={{ fontSize: "12.5px", opacity: 0.9 }}>
                    {data.membershipsError}
                  </span>
                </div>
                <button
                  type="button"
                  className="v2-secondary"
                  style={{
                    minHeight: "32px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12.5px",
                    whiteSpace: "nowrap",
                  }}
                  onClick={() => {
                    if (data.refreshMemberships) {
                      void data.refreshMemberships();
                    } else {
                      void data.refresh();
                    }
                  }}
                >
                  <RefreshCw size={14} />
                  <span>Reintentar</span>
                </button>
              </div>
            )}

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
                {data.membershipsError ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                    <span>No se pudieron cargar las membresías desde la base de datos.</span>
                    <button
                      type="button"
                      className="v2-secondary"
                      style={{
                        minHeight: "32px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "12.5px",
                      }}
                      onClick={() => {
                        if (data.refreshMemberships) {
                          void data.refreshMemberships();
                        } else {
                          void data.refresh();
                        }
                      }}
                    >
                      <RefreshCw size={14} />
                      <span>Reintentar carga</span>
                    </button>
                  </div>
                ) : (
                  "No hay membresías para este filtro."
                )}
              </Empty>
            ) : (
              <div className={`kani-mgrid${scopedMemberships.length === 1 ? " is-single" : ""}`}>
                {scopedMemberships.map((m) => {
                  const client = data.clients.find((c) => c.id === m.clientId);
                  const barber = staff.barbers.find((b) => b.id === m.barberId);
                  return (
                    <MembershipCard
                      key={m.id}
                      membership={m}
                      clientName={m.clientName || client?.name || "Cliente"}
                      barberName={barber?.name || m.barberName || null}
                      today={today}
                      soonThreshold={soonThreshold}
                      copied={copiedMembershipId === m.id}
                      onEdit={(selected) => {
                        setErrorNotice("");
                        setDetailMembershipId(selected.id);
                      }}
                      onCopyLink={(selected) => {
                        void handleCopyLink(selected.publicToken, selected.id);
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        ) : !canViewDiscounts ? (
          <p role="alert" className="v2-alert" style={{ marginTop: "16px" }}>
            No tenés permisos para consultar ni gestionar códigos de descuento.
          </p>
        ) : isAdmin ? (
          <div className="v2-discounts-stage" style={hideHeaderBlock ? undefined : { marginTop: "16px" }}>
            <BenefitCodesAdminSection hideHeading={hideHeaderBlock} />
          </div>
        ) : (
          <div className="v2-discounts-stage" style={hideHeaderBlock ? undefined : { marginTop: "16px" }}>
            <V2Discounts hideHeading={hideHeaderBlock} />
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
        <DialogContent
          className="v2-dialog v2-membership-create-dialog v2-modal-pinned-shell kani-modal-shell"
          transitionMode="container-transform"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <div className="v2-modal-pinned-header kani-modal-header">
            <DialogTitle>Nueva membresía</DialogTitle>
            <KaniModalClose label="Cerrar" />
          </div>
          <form onSubmit={handleCreateSubmit} className="v2-form v2-modal-pinned-form">
            <div className="v2-modal-pinned-scroll kani-modal-body">
              <div className="v2-field min-w-0">
                <label htmlFor="membership-client-select" className="v2-field-label">
                  Cliente titular
                </label>
                <AdminClientCombobox
                  id="membership-client-select"
                  clients={data.clients.filter((c) => !c.archived)}
                  value={clientId}
                  onChange={setClientId}
                  required
                  ariaLabel="Cliente titular"
                />
              </div>

              <div className="v2-membership-create-row">
                <label className="v2-field min-w-0">
                  <span className="v2-field-label">Barbero</span>
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

                <div className="v2-field min-w-0">
                  <label htmlFor="membership-package-select" className="v2-field-label">
                    Tipo de membresía
                  </label>
                  <AdminContextualSelect
                    id="membership-package-select"
                    ariaLabel="Tipo de membresía"
                    value={selectedPackageId}
                    onValueChange={(val) =>
                      setSelectedPackageId(val as HomogeneousMembershipPackageId)
                    }
                    options={HOMOGENEOUS_MEMBERSHIP_PACKAGES.map((pkg) => ({
                      value: pkg.id,
                      label: pkg.label,
                    }))}
                  />
                </div>
              </div>

              <div className="v2-membership-summary-card">
                <div>
                  <span>Subtotal</span>
                  <span>{money(livePricing.subtotalArs)}</span>
                </div>
                <div>
                  <span>Descuento ({livePricing.discountPercent}%)</span>
                  <span style={{ color: "#10b981" }}>-{money(livePricing.discountAmountArs)}</span>
                </div>
                <div className="v2-membership-summary-total">
                  <span>Total final</span>
                  <span>{money(livePricing.totalPriceArs)}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="v2-field min-w-0">
                  <span className="v2-field-label">Vencimiento</span>
                  <select
                    value={expirationMode}
                    onChange={(e) => setExpirationMode(e.target.value as "NONE" | "DATE")}
                  >
                    <option value="NONE">Sin vencimiento</option>
                    <option value="DATE">Fecha determinada</option>
                  </select>
                </label>
                {expirationMode === "DATE" && (
                  <label className="v2-field min-w-0">
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="v2-field min-w-0">
                  <label htmlFor="membership-payment-status" className="v2-field-label">
                    Estado de pago
                  </label>
                  <AdminContextualSelect
                    id="membership-payment-status"
                    ariaLabel="Estado de pago"
                    value={payImmediately ? "PAID" : "PENDING"}
                    onValueChange={(val) => setPayImmediately(val === "PAID")}
                    options={[
                      { value: "PAID", label: "Pagada ahora (Activa)" },
                      { value: "PENDING", label: "Pendiente de pago" },
                    ]}
                  />
                </div>
                {payImmediately && (
                  <label className="v2-field min-w-0">
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
            </div>

            <div className="v2-dialog-actions v2-modal-pinned-footer kani-modal-footer kani-mcreate-footer">
              <button
                type="button"
                className="v2-secondary"
                style={{ fontSize: "14px", fontWeight: 500, minHeight: "44px", borderRadius: "var(--v2-radius-btn, 12px)" }}
                disabled={busy}
                onClick={() => setCreateOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="v2-primary"
                style={{ fontSize: "14px", fontWeight: 600, minHeight: "44px", borderRadius: "var(--v2-radius-btn, 12px)" }}
                disabled={busy || !livePricing.isValidComposition}
              >
                {busy ? "Guardando…" : "Crear membresía"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Unificado: Editar y Administrar Membresía */}
      <EditMembershipModal
        membership={detailMembership}
        clientName={
          detailMembership?.clientName ||
          data.clients.find((c) => c.id === detailMembership?.clientId)?.name ||
          "Cliente"
        }
        barberName={
          staff.barbers.find((b) => b.id === detailMembership?.barberId)?.name ||
          detailMembership?.barberName ||
          null
        }
        appointments={data.appointments ?? []}
        isOperator={isOperator}
        busy={busy}
        isRegenerating={isRegenerating}
        copied={copiedMembershipId === detailMembership?.id}
        onClose={() => setDetailMembershipId(null)}
        onCopyLink={(selected) => handleCopyLink(selected.publicToken, selected.id)}
        onRegenerateToken={handleRegenerateToken}
        onRegisterPayment={handleRegisterPayment}
        onConsumeSession={handleConsumeSession}
        onRefundSession={handleRefundSession}
        onUpdateDetails={handleUpdateMembershipDetails}
        onRenew={(selected) => {
          setDetailMembershipId(null);
          openRenewalModal(selected);
        }}
      />

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
