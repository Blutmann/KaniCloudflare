import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  CreditCard,
  ExternalLink,
  History,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { addCalendarDays, businessDateToday } from "@/lib/kani-mobile-appointments";
import type { RealAppointment } from "@/lib/kani-appointments";
import { dateLabel, formatServiceName, money } from "@/lib/kani-model";
import {
  KANI_MEMBERSHIP_PAYMENT_METHODS,
  MEMBERSHIP_STATUS_LABELS,
  type ClientMembershipRecord,
  type KaniMembershipPaymentMethod,
  type MembershipAllowedServiceName,
  type MembershipConsumptionType,
  type MembershipStatus,
} from "@/lib/kani-recurrences-memberships";
import { Dialog, DialogContent, DialogDescription, DialogTitle, KaniModalClose } from "@/components/ui/dialog";
import "./membership-card.css";

const STATUS_BADGE_CLASS: Record<MembershipStatus, string> = {
  ACTIVE: "is-active",
  PENDING_PAYMENT: "is-pending",
  EXHAUSTED: "is-exhausted",
  EXPIRED: "is-expired",
  CANCELLED: "is-cancelled",
};

const SHORT_MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatCompactExpiryDate(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return dateLabel(isoDate);
  const [, year, monthStr, dayStr] = match;
  const month = SHORT_MONTHS_ES[Number(monthStr) - 1];
  if (!month) return dateLabel(isoDate);
  return `${Number(dayStr)} ${month} ${year}`;
}

const PROGRESS_FILL_CLASS: Record<MembershipStatus, string> = {
  ACTIVE: "is-active",
  PENDING_PAYMENT: "is-pending",
  EXHAUSTED: "is-exhausted",
  EXPIRED: "is-expired",
  CANCELLED: "is-cancelled",
};

/** Status chip displaying the membership lifecycle state in crisp uppercase typography. */
export function MembershipStatusBadge({ status }: { status: MembershipStatus }) {
  const label = MEMBERSHIP_STATUS_LABELS[status] ?? status;
  return (
    <span className={`kani-mcard-badge ${STATUS_BADGE_CLASS[status] ?? "is-exhausted"}`}>
      {label}
    </span>
  );
}

/** Compact visual progress bar for consumed vs. total membership sessions. */
export function MembershipProgress({
  totalSessions,
  remainingSessions,
  status,
}: {
  totalSessions: number;
  remainingSessions: number;
  status: MembershipStatus;
}) {
  const safeTotal = Math.max(0, totalSessions);
  const safeRemaining = Math.max(0, Math.min(safeTotal, remainingSessions));
  const consumed = Math.max(0, safeTotal - safeRemaining);
  const percent = safeTotal > 0 ? Math.min(100, Math.round((consumed / safeTotal) * 100)) : 0;

  return (
    <div
      className="kani-mcard-progress-track"
      role="progressbar"
      aria-label="Progreso de sesiones utilizadas"
      aria-valuemin={0}
      aria-valuemax={safeTotal}
      aria-valuenow={consumed}
    >
      <div
        className={`kani-mcard-progress-fill ${PROGRESS_FILL_CLASS[status] ?? "is-active"}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** Three-action footer for each membership card: contextual primary CTA, View Card, and Copy Link. */
export function MembershipActions({
  status,
  publicToken,
  copied,
  onEdit,
  onCopyLink,
}: {
  status: MembershipStatus;
  publicToken?: string | null;
  copied: boolean;
  onEdit: () => void;
  onCopyLink: () => void;
}) {
  const cardHref = publicToken ? `/membresia/${publicToken}` : undefined;
  const primaryLabel = status === "PENDING_PAYMENT" ? "Registrar pago" : "Gestionar";

  return (
    <div className="kani-mcard-actions">
      <button
        type="button"
        className="v2-primary kani-mcard-btn-edit"
        onClick={onEdit}
      >
        {status === "PENDING_PAYMENT" ? (
          <CreditCard size={14} aria-hidden="true" />
        ) : (
          <Pencil size={14} aria-hidden="true" />
        )}
        <span>{primaryLabel}</span>
      </button>

      <a
        href={cardHref}
        role={cardHref ? undefined : "link"}
        tabIndex={cardHref ? undefined : -1}
        target="_blank"
        rel="noopener noreferrer"
        className={`v2-secondary kani-mcard-btn-view${cardHref ? "" : " is-disabled"}`}
        aria-disabled={!cardHref}
        title={cardHref ? "Abrir tarjeta digital en nueva pestaña" : "Sin enlace público disponible"}
        onClick={(e) => {
          if (!cardHref) e.preventDefault();
        }}
      >
        <ExternalLink size={14} aria-hidden="true" />
        <span>Ver tarjeta</span>
      </a>

      <button
        type="button"
        className={`v2-secondary kani-mcard-btn-copy${copied ? " is-copied" : ""}`}
        aria-label={copied ? "Enlace copiado" : "Copiar enlace"}
        title={copied ? "¡Enlace copiado!" : "Copiar enlace de tarjeta digital"}
        disabled={!publicToken}
        onClick={onCopyLink}
      >
        {copied ? (
          <Check size={15} aria-hidden="true" />
        ) : (
          <Copy size={15} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

export interface MembershipCardProps {
  membership: ClientMembershipRecord;
  clientName: string;
  barberName?: string | null;
  today: string;
  soonThreshold: string;
  copied: boolean;
  onEdit: (membership: ClientMembershipRecord) => void;
  onCopyLink: (membership: ClientMembershipRecord) => void;
}

/** Structural Alternativa B membership card: client-first hierarchy, single surface, zero redundant repetition. */
export function MembershipCard({
  membership,
  clientName,
  barberName,
  today,
  soonThreshold,
  copied,
  onEdit,
  onCopyLink,
}: MembershipCardProps) {
  const isExpiredDate =
    Boolean(membership.expiresAt) &&
    (membership.status === "EXPIRED" || (membership.expiresAt ?? "") < today);
  const isExpiringSoon =
    Boolean(membership.expiresAt) &&
    !isExpiredDate &&
    membership.status === "ACTIVE" &&
    (membership.expiresAt ?? "") <= soonThreshold;

  const hasMultipleServices = membership.items.length > 1;
  const breakdown = hasMultipleServices
    ? membership.items
        .map((item) => `${item.serviceName}: ${item.remainingQuantity}/${item.totalQuantity}`)
        .join(" · ")
    : "";

  const expiryText = membership.expiresAt
    ? `Vence ${formatCompactExpiryDate(membership.expiresAt)}`
    : "Sin vencimiento";

  const sessionsSuffix =
    membership.totalSessions === 1 ? "sesión disponible" : "sesiones disponibles";

  return (
    <article
      className="kani-mcard"
      data-testid={`membership-card-${membership.id}`}
      data-status={membership.status}
    >
      <div className="kani-mcard-body">
        <header className="kani-mcard-header">
          <div className="kani-mcard-identity">
            <h3 className="kani-mcard-client">{clientName}</h3>
            <p className="kani-mcard-plan">
              {membership.planName}
              {barberName ? ` · ${barberName}` : ""}
            </p>
          </div>
          <MembershipStatusBadge status={membership.status} />
        </header>

        <div className="kani-mcard-kpi-row">
          <div className="kani-mcard-sessions-inline">
            <span className="kani-mcard-sessions-count">
              {membership.remainingSessions} de {membership.totalSessions}
            </span>
            <span className="kani-mcard-sessions-label">{sessionsSuffix}</span>
          </div>

          <span
            className={`kani-mcard-expiry${
              isExpiredDate ? " is-expired" : isExpiringSoon ? " is-expiring" : ""
            }`}
          >
            <Calendar size={13} aria-hidden="true" />
            <span>{expiryText}</span>
          </span>
        </div>

        {breakdown ? (
          <div className="kani-mcard-sessions-breakdown">{breakdown}</div>
        ) : null}

        {membership.status === "PENDING_PAYMENT" ? (
          <div className="kani-mcard-due">
            <AlertCircle size={13} aria-hidden="true" />
            <span>Cobro pendiente · {money(membership.totalPriceArs)}</span>
          </div>
        ) : null}

        <MembershipProgress
          totalSessions={membership.totalSessions}
          remainingSessions={membership.remainingSessions}
          status={membership.status}
        />
      </div>

      <MembershipActions
        status={membership.status}
        publicToken={membership.publicToken}
        copied={copied}
        onEdit={() => onEdit(membership)}
        onCopyLink={() => onCopyLink(membership)}
      />
    </article>
  );
}

export interface EditMembershipModalProps {
  membership: ClientMembershipRecord | null;
  clientName: string;
  barberName?: string | null;
  appointments: RealAppointment[];
  isOperator: boolean;
  busy: boolean;
  isRegenerating: boolean;
  copied: boolean;
  onClose: () => void;
  onCopyLink: (membership: ClientMembershipRecord) => Promise<void> | void;
  onRegenerateToken: (membership: ClientMembershipRecord) => Promise<void>;
  onRegisterPayment: (
    membership: ClientMembershipRecord,
    method: KaniMembershipPaymentMethod,
  ) => Promise<void>;
  onConsumeSession: (input: {
    membership: ClientMembershipRecord;
    serviceName: MembershipAllowedServiceName;
    appointmentId: string | null;
    consumptionType: MembershipConsumptionType;
    notes: string | null;
  }) => Promise<void>;
  onRefundSession: (input: {
    membership: ClientMembershipRecord;
    consumptionId: string;
    reason: string;
  }) => Promise<void>;
  onUpdateDetails: (input: {
    membership: ClientMembershipRecord;
    expiresAt: string | null;
    notes: string | null;
  }) => Promise<void>;
  onRenew: (membership: ClientMembershipRecord) => void;
}

type EditModalSectionId = "consume" | "validity" | "card" | "history" | "activity";

const MEMBERSHIP_EVENT_LABELS: Record<string, string> = {
  CREATED: "Membresía creada",
  PAYMENT_REGISTERED: "Pago registrado",
  SESSION_CONSUMED: "Sesión utilizada",
  SESSION_REFUNDED: "Sesión reintegrada",
  EXPIRATION_UPDATED: "Vigencia actualizada",
  DETAILS_UPDATED: "Vigencia actualizada",
  PUBLIC_TOKEN_REGENERATED: "Enlace regenerado",
  DIGITAL_CARD_EMAIL_SENT: "Tarjeta digital enviada",
  EXHAUSTED: "Membresía agotada",
  EXPIRED: "Membresía vencida",
  CANCELLED: "Membresía cancelada",
};

function formatMembershipEventType(eventType: string): string {
  if (MEMBERSHIP_EVENT_LABELS[eventType]) {
    return MEMBERSHIP_EVENT_LABELS[eventType];
  }
  const readable = eventType.replace(/_/g, " ").trim().toLowerCase();
  return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : "Movimiento registrado";
}

function formatArDateTime(isoOrDate: string): string {
  const parsed = new Date(isoOrDate);
  if (Number.isNaN(parsed.getTime())) return isoOrDate;
  try {
    const parts = new Intl.DateTimeFormat("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(parsed);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const d = get("day");
    const m = get("month");
    const y = get("year");
    const hh = get("hour");
    const mm = get("minute");
    if (d && m && y && hh && mm) return `${d}/${m}/${y} · ${hh}:${mm} hs`;
  } catch {
    // Fallback below
  }
  return isoOrDate.replace("T", " ").slice(0, 16);
}

function formatServiceSlotLabel(dateStr?: string | null, timeStr?: string | null): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const formattedDate = match ? `${match[3]}/${match[2]}/${match[1]}` : dateStr;
  return timeStr ? `${formattedDate} · ${timeStr} hs` : formattedDate;
}

function MembershipAccordionSection({
  id,
  title,
  icon,
  isOpen,
  onToggle,
  children,
}: {
  id: EditModalSectionId;
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: (id: EditModalSectionId) => void;
  children: React.ReactNode;
}) {
  const triggerId = `kani-medit-trigger-${id}`;
  const panelId = `kani-medit-panel-${id}`;

  return (
    <section className={`kani-medit-accordion${isOpen ? " is-open" : ""}`} aria-labelledby={triggerId}>
      <button
        type="button"
        id={triggerId}
        className="kani-medit-accordion-trigger"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => onToggle(id)}
      >
        <span className="kani-medit-accordion-leading">
          <span className="kani-medit-accordion-icon" aria-hidden="true">
            {icon}
          </span>
          <span className="kani-medit-accordion-title">{title}</span>
        </span>
        <ChevronDown size={16} className="kani-medit-accordion-chevron" aria-hidden="true" />
      </button>

      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        className="kani-medit-accordion-panel"
        hidden={!isOpen}
      >
        <div className="kani-medit-accordion-body">{children}</div>
      </div>
    </section>
  );
}

/**
 * Unified administrative modal opened by "Gestionar" / "Registrar pago" on a membership card.
 * v2.3: simplified "Membresía" header, full-width mobile CTAs, collapsible optional notes,
 * independent confirmation dialogs for token regeneration and session refund, and readable activity log.
 */
export function EditMembershipModal({
  membership,
  clientName,
  barberName,
  appointments,
  isOperator,
  busy,
  isRegenerating,
  copied,
  onClose,
  onCopyLink,
  onRegenerateToken,
  onRegisterPayment,
  onConsumeSession,
  onRefundSession,
  onUpdateDetails,
  onRenew,
}: EditMembershipModalProps) {
  const today = businessDateToday();

  const [openSection, setOpenSection] = useState<EditModalSectionId | null>(null);
  const [localError, setLocalError] = useState("");
  const [localStatus, setLocalStatus] = useState("");
  const [payMethod, setPayMethod] = useState<KaniMembershipPaymentMethod>("Transferencia");

  const [consumeService, setConsumeService] = useState<MembershipAllowedServiceName>("Corte");
  const [consumeType, setConsumeType] = useState<MembershipConsumptionType>("SERVICE_COMPLETED");
  const [consumeAppointmentId, setConsumeAppointmentId] = useState("");
  const [consumeNotes, setConsumeNotes] = useState("");

  const [expMode, setExpMode] = useState<"NONE" | "DATE">("NONE");
  const [expDate, setExpDate] = useState(addCalendarDays(today, 90));
  const [editNotes, setEditNotes] = useState("");

  const [refundTarget, setRefundTarget] = useState<ClientMembershipRecord["consumptions"][number] | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  useEffect(() => {
    if (!membership) return;
    setOpenSection(null);
    setLocalError("");
    setLocalStatus("");
    setPayMethod("Transferencia");
    const firstAvailable =
      membership.items.find((item) => item.remainingQuantity > 0) ?? membership.items[0];
    setConsumeService(firstAvailable?.serviceName ?? "Corte");
    setConsumeType("SERVICE_COMPLETED");
    setConsumeAppointmentId("");
    setConsumeNotes("");
    setExpMode(membership.expiresAt ? "DATE" : "NONE");
    setExpDate(membership.expiresAt || addCalendarDays(today, 90));
    const existingNotes = membership.notes || "";
    setEditNotes(existingNotes);
    setRefundTarget(null);
    setConfirmRegenerate(false);
  }, [membership?.id, membership?.expiresAt, membership?.notes, membership?.status, membership?.remainingSessions, today]);

  const linkableAppointments = useMemo(() => {
    if (!membership) return [];
    return appointments.filter((a) => {
      const consumptionId = (a as RealAppointment & { membershipConsumptionId?: string | null })
        .membershipConsumptionId;
      return (
        a.clientId === membership.clientId &&
        a.statusCode !== "CANCELLED" &&
        !consumptionId
      );
    });
  }, [appointments, membership]);

  function handleToggleSection(id: EditModalSectionId) {
    setOpenSection((prev) => (prev === id ? null : id));
  }

  async function runSafely(task: () => Promise<void>) {
    setLocalError("");
    setLocalStatus("");
    try {
      await task();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "No se pudo completar la operación.");
    }
  }

  function handleSaveExpiration(e: FormEvent) {
    e.preventDefault();
    if (!membership || busy) return;
    void runSafely(() =>
      onUpdateDetails({
        membership,
        expiresAt: expMode === "DATE" && expDate ? expDate : null,
        notes: editNotes.trim() || null,
      }),
    );
  }

  const hasMultipleServices = (membership?.items.length ?? 0) > 1;
  const hasSubDialogOpen = confirmRegenerate || !!refundTarget;

  return (
    <>
      <Dialog
        open={!!membership}
        onOpenChange={(open) => {
          if (!open && !busy && !isRegenerating && !hasSubDialogOpen) onClose();
        }}
      >
        <DialogContent
          className="v2-dialog kani-medit-dialog v2-modal-pinned-shell kani-modal-shell"
          transitionMode="container-transform"
          showCloseButton={false}
          inert={hasSubDialogOpen || undefined}
        >
          {membership && (
            <>
              <div className="v2-modal-pinned-header kani-modal-header kani-medit-header">
                <div className="kani-medit-header-copy">
                  <div className="kani-medit-title-row">
                    <DialogTitle className="kani-modal-title">Membresía</DialogTitle>
                    <MembershipStatusBadge status={membership.status} />
                  </div>
                  <DialogDescription>
                    {clientName}
                    {barberName ? ` · ${barberName}` : ""}
                  </DialogDescription>
                </div>
                <KaniModalClose label="Cerrar" />
              </div>

              {localError ? (
                <p role="alert" className="v2-alert" style={{ margin: "8px 16px 0" }}>
                  {localError}
                </p>
              ) : null}

              {localStatus ? (
                <p role="status" aria-live="polite" className="v2-success" style={{ margin: "8px 16px 0" }}>
                  {localStatus}
                </p>
              ) : null}

              <div className="v2-modal-pinned-scroll kani-modal-body kani-medit-scroll">
                {/* Resumen siempre visible */}
                <section className="kani-medit-summary" aria-label="Resumen de membresía">
                  <div className="kani-medit-summary-main">
                    <div className="kani-medit-summary-client">{membership.planName}</div>
                    <div className="kani-medit-summary-sessions">
                      <strong>
                        {membership.remainingSessions} de {membership.totalSessions} sesiones disponibles
                      </strong>
                      {hasMultipleServices ? (
                        <span className="kani-medit-summary-breakdown">
                          {membership.items
                            .map((item) => `${item.serviceName}: ${item.remainingQuantity}/${item.totalQuantity}`)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="kani-medit-summary-price">
                    <span className="kani-medit-kv-label">Precio</span>
                    <strong>{money(membership.totalPriceArs)}</strong>
                  </div>
                </section>

                {/* Pago pendiente */}
                {membership.status === "PENDING_PAYMENT" && (
                  <section className="kani-medit-section" aria-label="Registrar pago de membresía">
                    <h3 className="kani-medit-section-title">
                      <CreditCard size={14} aria-hidden="true" />
                      <span>Registrar pago ({money(membership.totalPriceArs)})</span>
                    </h3>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--muted-foreground)" }}>
                      Al confirmar el pago completo, la membresía pasará a estado <strong>Activa</strong> y permitirá consumir sesiones.
                    </p>
                    <div className="kani-medit-form-grid">
                      <label className="v2-field">
                        <span className="v2-field-label">Medio de pago</span>
                        <select
                          value={payMethod}
                          disabled={busy}
                          onChange={(e) =>
                            setPayMethod(e.target.value as KaniMembershipPaymentMethod)
                          }
                        >
                          {KANI_MEMBERSHIP_PAYMENT_METHODS.map((method) => (
                            <option key={method} value={method}>
                              {method}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div style={{ display: "flex", alignItems: "flex-end" }}>
                        <button
                          type="button"
                          className="v2-primary kani-medit-full-mobile"
                          disabled={busy}
                          onClick={() =>
                            void runSafely(() => onRegisterPayment(membership, payMethod))
                          }
                        >
                          {busy ? "Procesando…" : "Confirmar pago y activar"}
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                {/* Renovación cuando está agotada */}
                {membership.status === "EXHAUSTED" && (
                  <section className="kani-medit-section" aria-label="Renovación">
                    <div className="kani-medit-row-actions" style={{ justifyContent: "space-between" }}>
                      <span style={{ fontSize: "12.5px", fontWeight: 500 }}>Membresía agotada</span>
                      <button
                        type="button"
                        className="v2-primary kani-medit-full-mobile"
                        disabled={busy}
                        onClick={() => onRenew(membership)}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                        <span>Renovar membresía</span>
                      </button>
                    </div>
                  </section>
                )}

                {/* Categoría 1 — Registrar consumo */}
                {membership.status === "ACTIVE" && membership.remainingSessions > 0 && (
                  <MembershipAccordionSection
                    id="consume"
                    title="Registrar consumo"
                    icon={<CheckCircle2 size={16} />}
                    isOpen={openSection === "consume"}
                    onToggle={handleToggleSection}
                  >
                    <div className="kani-medit-form-grid">
                      <label className="v2-field">
                        <span className="v2-field-label">Servicio a descontar</span>
                        <select
                          value={consumeService}
                          disabled={busy}
                          onChange={(e) =>
                            setConsumeService(e.target.value as MembershipAllowedServiceName)
                          }
                        >
                          {membership.items.map((item) => (
                            <option
                              key={item.id}
                              value={item.serviceName}
                              disabled={item.remainingQuantity <= 0}
                            >
                              {item.serviceName} ({item.remainingQuantity}/{item.totalQuantity})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="v2-field">
                        <span className="v2-field-label">Motivo del consumo</span>
                        <select
                          value={consumeType}
                          disabled={busy}
                          onChange={(e) =>
                            setConsumeType(e.target.value as MembershipConsumptionType)
                          }
                        >
                          <option value="SERVICE_COMPLETED">Servicio realizado</option>
                          <option value="NO_SHOW_DEDUCTION">
                            Descontar sesión por inasistencia
                          </option>
                        </select>
                      </label>
                    </div>
                    <label className="v2-field">
                      <span className="v2-field-label">Turno vinculado (opcional)</span>
                      <select
                        value={consumeAppointmentId}
                        disabled={busy}
                        onChange={(e) => setConsumeAppointmentId(e.target.value)}
                      >
                        <option value="">Sin turno específico / registro directo</option>
                        {linkableAppointments.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.date} · {a.time} — {formatServiceName(a.serviceName)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="v2-field">
                      <span className="v2-field-label">Observación (opcional)</span>
                      <textarea
                        rows={1}
                        className="kani-medit-textarea"
                        value={consumeNotes}
                        disabled={busy}
                        onChange={(e) => {
                          setConsumeNotes(e.target.value);
                          e.currentTarget.style.height = "auto";
                          e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 120)}px`;
                        }}
                        placeholder="Agregar una observación..."
                      />
                    </label>
                    <div className="kani-medit-row-actions">
                      <button
                        type="button"
                        className="v2-primary kani-medit-full-mobile"
                        disabled={busy}
                        onClick={() =>
                          void runSafely(() =>
                            onConsumeSession({
                              membership,
                              serviceName: consumeService,
                              appointmentId: consumeAppointmentId || null,
                              consumptionType: consumeType,
                              notes: consumeNotes.trim() || null,
                            }),
                          )
                        }
                      >
                        {busy ? "Registrando…" : "Confirmar consumo"}
                      </button>
                    </div>
                  </MembershipAccordionSection>
                )}

                {/* Categoría 2 — Vigencia */}
                <MembershipAccordionSection
                  id="validity"
                  title="Vigencia"
                  icon={<Calendar size={16} />}
                  isOpen={openSection === "validity"}
                  onToggle={handleToggleSection}
                >
                  <form className="kani-medit-accordion-form" onSubmit={handleSaveExpiration}>
                    <div className="kani-medit-form-grid">
                      <label className="v2-field">
                        <span className="v2-field-label">Tipo de vigencia</span>
                        <select
                          value={expMode}
                          disabled={busy}
                          onChange={(e) => setExpMode(e.target.value as "NONE" | "DATE")}
                        >
                          <option value="NONE">Sin vencimiento</option>
                          <option value="DATE">Con fecha de vencimiento</option>
                        </select>
                      </label>
                      {expMode === "DATE" && (
                        <label className="v2-field">
                          <span className="v2-field-label">Fecha de vencimiento</span>
                          <input
                            type="date"
                            value={expDate}
                            disabled={busy}
                            onChange={(e) => setExpDate(e.target.value)}
                          />
                        </label>
                      )}
                    </div>
                    <label className="v2-field">
                      <span className="v2-field-label">Nota administrativa (opcional)</span>
                      <textarea
                        rows={1}
                        className="kani-medit-textarea"
                        value={editNotes}
                        disabled={busy}
                        onChange={(e) => {
                          setEditNotes(e.target.value);
                          e.currentTarget.style.height = "auto";
                          e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 120)}px`;
                        }}
                        placeholder="Agregar una nota..."
                      />
                    </label>
                    <div className="kani-medit-row-actions">
                      <button type="submit" className="v2-primary kani-medit-full-mobile" disabled={busy}>
                        {busy ? "Guardando…" : "Guardar vigencia"}
                      </button>
                    </div>
                  </form>
                </MembershipAccordionSection>

                {/* Categoría 3 — Tarjeta digital */}
                {membership.publicToken && (
                  <MembershipAccordionSection
                    id="card"
                    title="Tarjeta digital"
                    icon={<CreditCard size={16} />}
                    isOpen={openSection === "card"}
                    onToggle={handleToggleSection}
                  >
                    <span className="sr-only" role="status" aria-live="polite">
                      {copied ? "Enlace copiado al portapapeles" : ""}
                    </span>
                    <div className="kani-medit-card-actions">
                      <a
                        href={`/membresia/${membership.publicToken}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="v2-primary kani-medit-card-ver"
                      >
                        <ExternalLink size={14} aria-hidden="true" />
                        <span>Ver tarjeta digital</span>
                      </a>
                      <button
                        type="button"
                        className={`v2-secondary kani-medit-card-copy${copied ? " is-copied" : ""}`}
                        aria-label="Copiar enlace"
                        title={copied ? "¡Enlace copiado!" : "Copiar enlace"}
                        onClick={() => void onCopyLink(membership)}
                      >
                        {copied ? (
                          <Check size={15} aria-hidden="true" />
                        ) : (
                          <Copy size={15} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {copied && (
                      <span className="kani-medit-copy-feedback">Enlace copiado</span>
                    )}
                    {isOperator && (
                      <div className="kani-medit-card-regen-row">
                        <button
                          type="button"
                          className="v2-secondary kani-medit-btn-regen"
                          disabled={isRegenerating}
                          onClick={() => setConfirmRegenerate(true)}
                        >
                          <RefreshCw size={14} aria-hidden="true" />
                          <span>Regenerar enlace</span>
                        </button>
                      </div>
                    )}
                  </MembershipAccordionSection>
                )}

                {/* Categoría 4 — Historial de sesiones */}
                <MembershipAccordionSection
                  id="history"
                  title="Historial de sesiones"
                  icon={<History size={16} />}
                  isOpen={openSection === "history"}
                  onToggle={handleToggleSection}
                >
                  {!membership.consumptions.length ? (
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--muted-foreground)" }}>
                      Aún no se registraron consumos en esta membresía.
                    </p>
                  ) : (
                    membership.consumptions.map((c) => {
                      const linkedAppt = c.appointmentId
                        ? appointments.find((a) => a.id === c.appointmentId)
                        : undefined;
                      const serviceSlot = linkedAppt
                        ? formatServiceSlotLabel(linkedAppt.date, linkedAppt.time)
                        : null;

                      return (
                        <div key={c.id} className="kani-medit-history-row">
                          <div className="kani-medit-history-top">
                            <div className="kani-medit-history-info">
                              <span className="kani-medit-history-title">
                                {c.serviceName} ·{" "}
                                {c.consumptionType === "NO_SHOW_DEDUCTION"
                                  ? "Descontada por inasistencia"
                                  : "Servicio realizado"}
                              </span>
                              <span className="kani-medit-history-meta">
                                {serviceSlot ? `Servicio: ${serviceSlot} · ` : ""}
                                Registro: {formatArDateTime(c.consumedAt)}
                                {c.status === "REFUNDED"
                                  ? ` · Reintegrada (${c.refundReason || "Autorizado"})`
                                  : ""}
                              </span>
                              {c.notes ? (
                                <span className="kani-medit-history-meta">Obs.: {c.notes}</span>
                              ) : null}
                            </div>

                            {c.status !== "CONSUMED" && (
                              <span className="kani-medit-refunded-tag">Reintegrada</span>
                            )}
                          </div>

                          {c.status === "CONSUMED" && (
                            <button
                              type="button"
                              className="v2-secondary kani-medit-full-mobile kani-medit-btn-refund"
                              disabled={busy}
                              onClick={() => setRefundTarget(c)}
                            >
                              Reintegrar sesión
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </MembershipAccordionSection>

                {/* Categoría 5 — Registro de actividad */}
                <MembershipAccordionSection
                  id="activity"
                  title="Registro de actividad"
                  icon={<Activity size={16} />}
                  isOpen={openSection === "activity"}
                  onToggle={handleToggleSection}
                >
                  {!membership.events.length ? (
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--muted-foreground)" }}>
                      Sin movimientos registrados.
                    </p>
                  ) : (
                    <ul className="kani-medit-activity-list">
                      {membership.events.map((ev) => {
                        const meta = ev.metadata ?? {};
                        const linkedConsumption = meta.consumption_id
                          ? membership.consumptions.find((c) => c.id === meta.consumption_id)
                          : undefined;
                        const apptId = meta.appointment_id ?? linkedConsumption?.appointmentId;
                        const linkedAppt = apptId
                          ? appointments.find((a) => a.id === apptId)
                          : undefined;
                        const serviceName =
                          (typeof meta.service_name === "string" && meta.service_name) ||
                          linkedConsumption?.serviceName ||
                          (linkedAppt ? formatServiceName(linkedAppt.serviceName) : null);
                        const serviceSlot = linkedAppt
                          ? formatServiceSlotLabel(linkedAppt.date, linkedAppt.time)
                          : null;

                        const isEmailEvent = ev.eventType === "DIGITAL_CARD_EMAIL_SENT";
                        const rawMetaEmail =
                          typeof meta.recipient_email === "string" ? meta.recipient_email : null;
                        const emailToDisplay = isEmailEvent
                          ? isOperator && membership.clientEmail && !membership.clientEmail.includes("***")
                            ? membership.clientEmail
                            : rawMetaEmail ||
                              (membership.clientEmail ? membership.clientEmail : null)
                          : null;

                        const authorLabel = ev.actorDisplayName
                          ? `Registrado por ${ev.actorDisplayName}`
                          : "Registrado por el sistema";

                        return (
                          <li key={ev.id} className="kani-medit-activity-item">
                            <div className="kani-medit-activity-head">
                              <span>
                                {formatMembershipEventType(ev.eventType)}
                                {serviceName ? ` · ${serviceName}` : ""}
                              </span>
                            </div>
                            {serviceSlot ? (
                              <div className="kani-medit-activity-meta">Servicio: {serviceSlot}</div>
                            ) : null}
                            {emailToDisplay ? (
                              <div className="kani-medit-activity-meta">
                                Destinatario: {emailToDisplay}
                              </div>
                            ) : null}
                            <div className="kani-medit-activity-meta">{authorLabel}</div>
                            <div className="kani-medit-activity-meta">
                              Registro: {formatArDateTime(ev.createdAt)}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </MembershipAccordionSection>
              </div>

              <div className="v2-dialog-actions v2-modal-pinned-footer kani-modal-footer">
                <button
                  type="button"
                  className="v2-secondary"
                  disabled={busy || isRegenerating}
                  onClick={onClose}
                >
                  Cerrar
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal independiente: Confirmar regeneración de enlace */}
      <Dialog
        open={confirmRegenerate && !!membership}
        onOpenChange={(open) => {
          if (!open && !isRegenerating) setConfirmRegenerate(false);
        }}
      >
        <DialogContent
          overlayClassName="kani-mconfirm-overlay"
          className="v2-dialog kani-mconfirm-dialog v2-modal-pinned-shell kani-modal-shell"
          transitionMode="container-transform"
          showCloseButton={false}
        >
          <div className="v2-modal-pinned-header kani-modal-header">
            <DialogTitle>Regenerar enlace</DialogTitle>
            <KaniModalClose label="Cerrar" />
          </div>
          <div className="v2-modal-pinned-scroll kani-modal-body">
            <DialogDescription className="kani-mconfirm-desc">
              El enlace actual dejará de funcionar. Deberás compartir el nuevo enlace con el cliente.
            </DialogDescription>
          </div>
          <div className="v2-dialog-actions v2-modal-pinned-footer kani-modal-footer kani-mconfirm-footer">
            <button
              type="button"
              className="v2-secondary"
              disabled={isRegenerating}
              onClick={() => setConfirmRegenerate(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="v2-primary"
              disabled={isRegenerating}
              onClick={() => {
                if (!membership || isRegenerating) return;
                void runSafely(async () => {
                  await onRegenerateToken(membership);
                  setConfirmRegenerate(false);
                  setLocalStatus("Enlace regenerado y copiado al portapapeles.");
                });
              }}
            >
              {isRegenerating ? "Regenerando…" : "Regenerar enlace"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal independiente: Confirmar reintegro de sesión */}
      <Dialog
        open={!!refundTarget && !!membership}
        onOpenChange={(open) => {
          if (!open && !busy) setRefundTarget(null);
        }}
      >
        <DialogContent
          overlayClassName="kani-mconfirm-overlay"
          className="v2-dialog kani-mconfirm-dialog v2-modal-pinned-shell kani-modal-shell"
          transitionMode="container-transform"
          showCloseButton={false}
        >
          <div className="v2-modal-pinned-header kani-modal-header">
            <DialogTitle>Reintegrar sesión</DialogTitle>
            <KaniModalClose label="Cerrar" />
          </div>
          {refundTarget && membership && (
            <>
              <div className="v2-modal-pinned-scroll kani-modal-body">
                <DialogDescription className="kani-mconfirm-desc">
                  Vas a devolver una sesión de {refundTarget.serviceName} a la membresía de {clientName}.
                </DialogDescription>
                <div className="kani-mconfirm-counter">
                  Sesiones disponibles:{" "}
                  <span>
                    {membership.remainingSessions} →{" "}
                    {Math.min(membership.totalSessions, membership.remainingSessions + 1)}
                  </span>
                </div>
              </div>
              <div className="v2-dialog-actions v2-modal-pinned-footer kani-modal-footer kani-mconfirm-footer">
                <button
                  type="button"
                  className="v2-secondary"
                  disabled={busy}
                  onClick={() => setRefundTarget(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="v2-primary"
                  disabled={busy}
                  onClick={() => {
                    if (busy) return;
                    void runSafely(async () => {
                      await onRefundSession({
                        membership,
                        consumptionId: refundTarget.id,
                        reason: "Reintegro autorizado por personal",
                      });
                      setRefundTarget(null);
                      setLocalStatus("Sesión reintegrada correctamente.");
                    });
                  }}
                >
                  {busy ? "Reintegrando…" : "Reintegrar sesión"}
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
