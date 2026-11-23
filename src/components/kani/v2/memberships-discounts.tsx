import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Tag,
  UserRound,
  X,
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
import { supabase } from "@/integrations/supabase/client";
import { AdminContextualSelect } from "./admin-mobile-select";
import { useV2 } from "./data";
import { EditMembershipModal, MembershipCard } from "./MembershipCard";
import { AdminFilterCell, AdminFilterPanel, Empty } from "./shared";

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
  const [statusFilter, setStatusFilter] = useState<"ALL" | "INACTIVE_GROUP" | MembershipStatus>("ALL");
  const [sortOrder, setSortOrder] = useState<"NEWEST" | "OLDEST">("NEWEST");
  const [barberFilter, setBarberFilter] = useState<string>(
    isOperator ? "ALL" : (staff.profile.barber_id ?? ""),
  );
  const [showSummary, setShowSummary] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorNotice, setErrorNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Create Membership Modal State
  const [createOpen, setCreateOpen] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientPickerTab, setClientPickerTab] = useState<"SEARCH" | "CREATE">("SEARCH");
  const [clientPickerQuery, setClientPickerQuery] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientSaving, setNewClientSaving] = useState(false);
  const [newClientError, setNewClientError] = useState("");
  const [clientId, setClientId] = useState("");

  async function handleCreateInlineClient(event: FormEvent) {
    event.preventDefault();
    if (newClientName.trim().length < 2) {
      setNewClientError("El nombre debe tener al menos 2 caracteres.");
      return;
    }
    const phoneDigits = newClientPhone.replace(/\D/g, "");
    if (phoneDigits.length < 6) {
      setNewClientError("El teléfono debe tener al menos 6 dígitos.");
      return;
    }
    setNewClientSaving(true);
    setNewClientError("");
    try {
      const { data: createdClient, error } = await supabase.rpc("save_client", {
        p_id: null,
        p_name: newClientName.trim(),
        p_phone: newClientPhone.trim(),
        p_email: newClientEmail.trim() || null,
      });
      if (error) throw error;
      await data.refresh({ silent: true });
      if (createdClient && typeof createdClient === "object" && "id" in createdClient && createdClient.id) {
        setClientId(String(createdClient.id));
      }
      setNewClientName("");
      setNewClientPhone("");
      setNewClientEmail("");
      setClientPickerTab("SEARCH");
      setClientPickerQuery("");
      setClientPickerOpen(false);
    } catch (err) {
      setNewClientError(err instanceof Error ? err.message : "No se pudo crear el cliente.");
    } finally {
      setNewClientSaving(false);
    }
  }
  const activeCreateClients = useMemo(
    () => (data.clients ?? []).filter((c) => !c.archived),
    [data.clients],
  );
  const selectedCreateClient = useMemo(
    () => activeCreateClients.find((c) => c.id === clientId) ?? null,
    [activeCreateClients, clientId],
  );
  const filteredPickerClients = useMemo(() => {
    const q = clientPickerQuery.trim().toLowerCase();
    if (!q) return activeCreateClients;
    const digitsQuery = q.replace(/\D/g, "");
    return activeCreateClients.filter((c) => {
      const nameMatch = c.name.toLowerCase().includes(q);
      const phoneStr = (c.phone ?? "").toLowerCase();
      const phoneMatch = phoneStr.includes(q);
      const digitsMatch =
        digitsQuery.length > 0 && phoneStr.replace(/\D/g, "").includes(digitsQuery);
      return nameMatch || phoneMatch || digitsMatch;
    });
  }, [activeCreateClients, clientPickerQuery]);
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
        await data.refresh({ silent: true });
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
    const filtered = (data.memberships ?? []).filter((m) => {
      if (!isOperator && m.barberId && m.barberId !== staff.profile.barber_id) {
        return false;
      }
      if (isOperator && barberFilter !== "ALL" && m.barberId !== barberFilter) {
        return false;
      }
      if (statusFilter === "INACTIVE_GROUP") {
        if (!["EXHAUSTED", "EXPIRED", "CANCELLED"].includes(m.status)) return false;
      } else if (statusFilter !== "ALL" && m.status !== statusFilter) {
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
    return [...filtered].sort((a, b) => {
      const aTime = new Date(a.createdAt ?? 0).getTime();
      const bTime = new Date(b.createdAt ?? 0).getTime();
      return sortOrder === "OLDEST" ? aTime - bTime : bTime - aTime;
    });
  }, [data.memberships, data.clients, isOperator, staff.profile.barber_id, barberFilter, statusFilter, sortOrder, search]);

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
      await data.refresh({ silent: true });
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
      await data.refresh({ silent: true });
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
      await data.refresh({ silent: true });
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
      await data.refresh({ silent: true });
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
      await data.refresh({ silent: true });
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
      await data.refresh({ silent: true });
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : "No se pudo finalizar la recurrencia.");
    } finally {
      setBusy(false);
    }
  }

  const hideHeaderBlock = standaloneTab === "DESCUENTOS" || standaloneTab === "MEMBRESIAS";

  return (
    <main className="v2-page v2-memberships-page">
      <section
        className={hideHeaderBlock ? "v2-memberships-standalone-panel" : "v2-panel"}
        style={hideHeaderBlock ? undefined : { padding: "16px 18px" }}
      >
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
              marginTop: hideHeaderBlock && !notice && !errorNotice ? 0 : "12px",
              display: "flex",
              flexDirection: "column",
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
                    minHeight: "44px",
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
                      void data.refresh({ silent: true });
                    }
                  }}
                >
                  <RefreshCw size={14} />
                  <span>Reintentar</span>
                </button>
              </div>
            )}

            <section className="v2-panel v2-memberships-unified-card" aria-label="Resumen y filtros de membresías">
              <div className="v2-memberships-summary-card">
                <button
                  type="button"
                  className="v2-memberships-summary-toggle"
                  aria-expanded={showSummary}
                  aria-controls="v2-memberships-summary-breakdown"
                  onClick={() => setShowSummary((prev) => !prev)}
                >
                  <span className="v2-memberships-summary-eyebrow">Resumen</span>
                  <span className="v2-memberships-summary-meta">
                    <strong className="v2-memberships-summary-highlight">
                      {kpiActive} {kpiActive === 1 ? "activa" : "activas"} · {kpiRemainingSessions}{" "}
                      {kpiRemainingSessions === 1 ? "sesión" : "sesiones"}
                    </strong>
                    <span className="v2-memberships-summary-chevron" aria-hidden="true">
                      {showSummary ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </span>
                  </span>
                </button>
                <div
                  id="v2-memberships-summary-breakdown"
                  className={`v2-memberships-summary-breakdown ${showSummary ? "is-open" : ""}`}
                >
                  <div className="v2-memberships-summary-metric">
                    <span>Membresías activas</span>
                    <strong>{kpiActive}</strong>
                  </div>
                  <div className="v2-memberships-summary-metric">
                    <span>Pendientes de pago</span>
                    <strong>{kpiPending}</strong>
                  </div>
                  <div className="v2-memberships-summary-metric">
                    <span>Próximas a vencer</span>
                    <strong>{kpiExpiringSoon}</strong>
                  </div>
                  <div className="v2-memberships-summary-metric">
                    <span>Sesiones restantes</span>
                    <strong>{kpiRemainingSessions}</strong>
                  </div>
                </div>
              </div>

              <div className="v2-memberships-card-divider" aria-hidden="true" />

              <AdminFilterPanel
                ariaLabel="Filtros de membresías"
                className="v2-memberships-filter-panel v2-memberships-filter-panel--embedded"
                mobileExpanded={false}
                mobileQuickBar={
                  <>
                    <div className="v2-quickbar-chips" role="group" aria-label="Estados rápidos de membresías">
                      <button
                        type="button"
                        className={`v2-quickbar-chip${statusFilter === "ALL" ? " is-active" : ""}`}
                        aria-pressed={statusFilter === "ALL"}
                        onClick={() => setStatusFilter("ALL")}
                      >
                        Todas
                      </button>
                      <button
                        type="button"
                        className={`v2-quickbar-chip${statusFilter === "ACTIVE" ? " is-active" : ""}`}
                        aria-pressed={statusFilter === "ACTIVE"}
                        onClick={() => setStatusFilter("ACTIVE")}
                      >
                        Activas
                      </button>
                      <button
                        type="button"
                        className={`v2-quickbar-chip${statusFilter === "INACTIVE_GROUP" ? " is-active" : ""}`}
                        aria-pressed={statusFilter === "INACTIVE_GROUP"}
                        onClick={() => setStatusFilter("INACTIVE_GROUP")}
                      >
                        Inactivas
                      </button>
                    </div>
                    <button
                      type="button"
                      className="v2-filter-toggle-btn v2-memberships-sort-btn"
                      aria-label={`Ordenar por ${sortOrder === "NEWEST" ? "viejas" : "nuevas"}`}
                      onClick={() => setSortOrder((prev) => (prev === "NEWEST" ? "OLDEST" : "NEWEST"))}
                    >
                      <ArrowUpDown size={13} aria-hidden="true" />
                      <span>{sortOrder === "NEWEST" ? "Nuevas" : "Viejas"}</span>
                    </button>
                  </>
                }
              >
                <AdminFilterCell
                  label="Buscar cliente"
                  htmlFor="v2-memberships-search"
                  className="v2-memberships-search-cell v2-memberships-desktop-only"
                >
                  <input
                    id="v2-memberships-search"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Nombre, teléfono o email"
                  />
                </AdminFilterCell>
                <AdminFilterCell label="Estado" htmlFor="v2-memberships-status">
                  <select
                    id="v2-memberships-status"
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(e.target.value as "ALL" | "INACTIVE_GROUP" | MembershipStatus)
                    }
                  >
                    <option value="ALL">Todas</option>
                    <option value="ACTIVE">Activa</option>
                    <option value="INACTIVE_GROUP">Inactivas</option>
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
            </section>

            <div
              className="v2-memberships-toolbar-row"
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
              }}
            >
              <span className="v2-memberships-count">
                {scopedMemberships.length === 1
                  ? "1 membresía encontrada"
                  : `${scopedMemberships.length} membresías encontradas`}
              </span>
              <button
                type="button"
                className="v2-primary v2-client-add-btn v2-client-add-btn--desktop"
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
                        minHeight: "44px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "12.5px",
                      }}
                      onClick={() => {
                        if (data.refreshMemberships) {
                          void data.refreshMemberships();
                        } else {
                          void data.refresh({ silent: true });
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
        ) : (
          <div className="v2-discounts-stage" style={hideHeaderBlock ? undefined : { marginTop: "16px" }}>
            <BenefitCodesAdminSection hideHeading={hideHeaderBlock} />
          </div>
        )}
      </section>

      {/* Modal: Crear Nueva Membresía */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open && !busy && !newClientSaving) {
            setCreateOpen(false);
            setClientPickerOpen(false);
            setClientPickerTab("SEARCH");
            setClientPickerQuery("");
            setNewClientError("");
          }
        }}
      >
        <DialogContent
          className="v2-dialog v2-membership-create-dialog v2-modal-pinned-shell kani-modal-shell"
          transitionMode="container-transform"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          {clientPickerOpen ? (
            <>
              <div className="v2-modal-pinned-header kani-modal-header">
                <DialogTitle>
                  {clientPickerTab === "CREATE" ? "Nuevo cliente" : "Elegir cliente"}
                </DialogTitle>
                <button
                  type="button"
                  aria-label="Volver al formulario"
                  className="kani-modal-close"
                  disabled={newClientSaving}
                  onClick={() => {
                    setClientPickerOpen(false);
                    setClientPickerTab("SEARCH");
                    setClientPickerQuery("");
                    setNewClientError("");
                  }}
                >
                  <X size={18} aria-hidden="true" />
                  <span className="sr-only">Volver al formulario</span>
                </button>
              </div>
              <div className="v2-modal-pinned-scroll kani-modal-body v2-client-picker-body">
                {clientPickerTab === "SEARCH" ? (
                  <>
                    <div className="v2-client-picker-search-wrap">
                      <Search
                        size={15}
                        className="v2-client-picker-search-icon"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={clientPickerQuery}
                        onChange={(e) => setClientPickerQuery(e.target.value)}
                        placeholder="Buscar por nombre o teléfono…"
                        aria-label="Buscar cliente por nombre o teléfono"
                        className="v2-client-picker-search-input"
                        style={{ paddingLeft: "36px" }}
                        autoFocus
                      />
                    </div>
                    <ul role="listbox" aria-label="Clientes" className="v2-client-picker-list">
                      {filteredPickerClients.length === 0 ? (
                        <li className="px-3 py-5 text-center text-xs text-muted-foreground">
                          No se encontraron clientes para “{clientPickerQuery}”.
                        </li>
                      ) : (
                        filteredPickerClients.map((c) => {
                          const isSelected = c.id === clientId;
                          return (
                            <li key={c.id}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                className={`v2-client-picker-row${isSelected ? " is-selected" : ""}`}
                                onClick={() => {
                                  setClientId(c.id);
                                  setClientPickerOpen(false);
                                  setClientPickerTab("SEARCH");
                                  setClientPickerQuery("");
                                }}
                              >
                                <span className="v2-client-picker-name">{c.name}</span>
                                {c.phone && <span className="v2-client-picker-phone">{c.phone}</span>}
                                {isSelected && (
                                  <Check size={14} className="shrink-0 text-gold" aria-hidden="true" />
                                )}
                              </button>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  </>
                ) : (
                  <form onSubmit={handleCreateInlineClient} className="v2-form space-y-3">
                    {newClientError && (
                      <p role="alert" className="v2-alert">
                        {newClientError}
                      </p>
                    )}
                    <label className="v2-field min-w-0">
                      <span className="v2-field-label">Nombre</span>
                      <input
                        type="text"
                        required
                        minLength={2}
                        disabled={newClientSaving}
                        value={newClientName}
                        onChange={(e) => setNewClientName(e.target.value)}
                        autoFocus
                      />
                    </label>
                    <label className="v2-field min-w-0">
                      <span className="v2-field-label">Celular</span>
                      <input
                        type="tel"
                        required
                        minLength={6}
                        disabled={newClientSaving}
                        value={newClientPhone}
                        onChange={(e) => setNewClientPhone(e.target.value)}
                      />
                    </label>
                    <label className="v2-field min-w-0">
                      <span className="v2-field-label">Email · opcional</span>
                      <input
                        type="email"
                        disabled={newClientSaving}
                        value={newClientEmail}
                        onChange={(e) => setNewClientEmail(e.target.value)}
                      />
                    </label>
                    <button
                      type="submit"
                      className="v2-primary w-full"
                      style={{ width: "100%" }}
                      disabled={newClientSaving}
                    >
                      {newClientSaving ? "Guardando…" : "Guardar cliente"}
                    </button>
                  </form>
                )}
              </div>
            </>
          ) : (
            <>
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
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        id="membership-client-select"
                        type="button"
                        role="combobox"
                        aria-expanded={clientPickerOpen}
                        aria-haspopup="listbox"
                        aria-label="Cliente titular"
                        onClick={() => {
                          setClientPickerTab("SEARCH");
                          setClientPickerOpen(true);
                        }}
                        className="v2-admin-select-trigger flex h-[44px] min-h-[44px] flex-1 min-w-0 max-w-full items-center justify-between gap-2.5 overflow-hidden rounded-[var(--v2-radius-btn,12px)] border border-input bg-background px-3 py-0 text-left text-[14px] leading-none text-foreground shadow-xs transition-colors focus:outline-none focus:ring-1 focus:ring-gold"
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden text-left">
                          <UserRound size={16} className="shrink-0 text-gold" aria-hidden="true" />
                          <span
                            className={`block min-w-0 flex-1 truncate leading-[1.35]${
                              !selectedCreateClient ? " text-muted-foreground" : ""
                            }`}
                          >
                            {selectedCreateClient
                              ? `${selectedCreateClient.name}${
                                  selectedCreateClient.phone ? ` (${selectedCreateClient.phone})` : ""
                                }`
                              : "Seleccionar cliente…"}
                          </span>
                        </span>
                        <ChevronDown size={16} className="ml-1 shrink-0 opacity-60" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="Nuevo cliente"
                        title="Nuevo cliente"
                        onClick={() => {
                          setClientPickerTab("CREATE");
                          setNewClientError("");
                          setClientPickerOpen(true);
                        }}
                        className="v2-secondary inline-flex shrink-0 items-center justify-center rounded-[var(--v2-radius-btn,12px)]"
                        style={{ minWidth: "44px", minHeight: "44px", padding: "0 12px" }}
                      >
                        <Plus size={16} aria-hidden="true" />
                      </button>
                    </div>
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

                <div
                  className="v2-dialog-actions v2-modal-pinned-footer kani-modal-footer kani-mcreate-footer flex-nowrap w-full"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: "10px",
                    width: "100%",
                  }}
                >
                  <button
                    type="button"
                    className="v2-secondary flex-1 min-w-0"
                    style={{ width: "100%", minWidth: 0, flex: "initial", margin: 0 }}
                    disabled={busy}
                    onClick={() => {
                      setCreateOpen(false);
                      setClientPickerOpen(false);
                      setClientPickerQuery("");
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="v2-primary flex-1 min-w-0"
                    style={{ width: "100%", minWidth: 0, flex: "initial", margin: 0 }}
                    disabled={busy || !livePricing.isValidComposition}
                  >
                    {busy ? "Guardando…" : "Crear membresía"}
                  </button>
                </div>
              </form>
            </>
          )}
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

      {activeTab === "MEMBRESIAS" && (
        <div
          className="v2-client-sticky-bar v2-mobile-sticky-cta"
          role="region"
          aria-label="Acciones de membresías"
        >
          <button
            type="button"
            className="v2-primary v2-client-add-btn v2-client-add-btn--mobile"
            onClick={() => {
              setErrorNotice("");
              if (!clientId && data.clients[0]) {
                setClientId(data.clients[0].id);
              }
              setCreateOpen(true);
            }}
          >
            <Plus size={17} aria-hidden="true" />
            <span>Nueva membresía</span>
          </button>
        </div>
      )}
    </main>
  );
}
