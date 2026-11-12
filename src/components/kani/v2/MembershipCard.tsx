import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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

/** Visual progress indicator for consumed vs. total membership sessions. */
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
    <div className="kani-mcard-progress">
      <div className="kani-mcard-progress-head">
        <span className="kani-mcard-progress-label">Progreso de sesiones</span>
        <span className="kani-mcard-progress-value">
          {consumed}/{safeTotal} utilizadas
        </span>
      </div>
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
    </div>
  );
}

/** Three-action footer for each membership card: Edit (modal), View Card, and compact Copy Link. */
export function MembershipActions({
  publicToken,
  copied,
  onEdit,
  onCopyLink,
}: {
  publicToken?: string | null;
  copied: boolean;
  onEdit: () => void;
  onCopyLink: () => void;
}) {
  const cardHref = publicToken ? `/membresia/${publicToken}` : undefined;

  return (
    <div className="kani-mcard-actions">
      <button
        type="button"
        className="v2-primary kani-mcard-btn-edit"
        onClick={onEdit}
      >
        <Pencil size={14} aria-hidden="true" />
        <span>Editar</span>
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
        aria-label="Copiar enlace"
        title={copied ? "¡Enlace copiado!" : "Copiar enlace de tarjeta digital"}
        disabled={!publicToken}
        onClick={onCopyLink}
      >
        {copied ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Copy size={14} aria-hidden="true" />
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

/** Clean, editorial membership card keeping visual hierarchy clear across mobile and desktop. */
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

  const breakdown = membership.items
    .map((item) => `${item.serviceName}: ${item.remainingQuantity}/${item.totalQuantity}`)
    .join(" · ");

  const expiryText = membership.expiresAt
    ? `Vence: ${formatCompactExpiryDate(membership.expiresAt)}`
    : "Sin vencimiento";

  const remainingUnitLabel =
    membership.remainingSessions === 1 ? "sesión disponible" : "sesiones disponibles";

  return (
    <article
      className="kani-mcard"
      data-testid={`membership-card-${membership.id}`}
      data-status={membership.status}
    >
      <div className="kani-mcard-body">
        <header className="kani-mcard-header">
          <h3 className="kani-mcard-title">{membership.planName}</h3>
          <MembershipStatusBadge status={membership.status} />
        </header>

        <div className="kani-mcard-identity">
          <div className="kani-mcard-client">{clientName}</div>
          {barberName ? (
            <div className="kani-mcard-barber">Barbero: {barberName}</div>
          ) : null}
        </div>

        <div className="kani-mcard-sessions">
          <div className="kani-mcard-sessions-main">
            <span className="kani-mcard-sessions-count">{membership.remainingSessions}</span>
            <span className="kani-mcard-sessions-label">
              {remainingUnitLabel} de {membership.totalSessions}
            </span>
          </div>
          {breakdown ? (
            <div className="kani-mcard-sessions-breakdown">{breakdown}</div>
          ) : null}
        </div>

        <div className="kani-mcard-meta">
          <span
            className={`kani-mcard-expiry${
              isExpiredDate ? " is-expired" : isExpiringSoon ? " is-expiring" : ""
            }`}
          >
            <Calendar size={14} aria-hidden="true" />
            <span>{expiryText}</span>
          </span>

          {membership.status === "PENDING_PAYMENT" ? (
            <span className="kani-mcard-due">
              <AlertCircle size={13} aria-hidden="true" />
              <span>Pago pendiente · {money(membership.totalPriceArs)}</span>
            </span>
          ) : null}
        </div>

        <MembershipProgress
          totalSessions={membership.totalSessions}
          remainingSessions={membership.remainingSessions}
          status={membership.status}
        />
      </div>

      <MembershipActions
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

/**
 * Unified administrative modal opened by "Editar" on a membership card.
 * Concentrates payment confirmation, session consumption, expiration/notes editing,
 * Black Card token tools, session refund, and event history without cluttering cards.
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

  const [localError, setLocalError] = useState("");
  const [payMethod, setPayMethod] = useState<KaniMembershipPaymentMethod>("Transferencia");

  const [consumeService, setConsumeService] = useState<MembershipAllowedServiceName>("Corte");
  const [consumeType, setConsumeType] = useState<MembershipConsumptionType>("SERVICE_COMPLETED");
  const [consumeAppointmentId, setConsumeAppointmentId] = useState("");
  const [consumeNotes, setConsumeNotes] = useState("");

  const [expMode, setExpMode] = useState<"NONE" | "DATE">("NONE");
  const [expDate, setExpDate] = useState(addCalendarDays(today, 90));
  const [editNotes, setEditNotes] = useState("");

  const [refundingConsumptionId, setRefundingConsumptionId] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  useEffect(() => {
    if (!membership) return;
    setLocalError("");
    setPayMethod("Transferencia");
    const firstAvailable =
      membership.items.find((item) => item.remainingQuantity > 0) ?? membership.items[0];
    setConsumeService(firstAvailable?.serviceName ?? "Corte");
    setConsumeType("SERVICE_COMPLETED");
    setConsumeAppointmentId("");
    setConsumeNotes("");
    setExpMode(membership.expiresAt ? "DATE" : "NONE");
    setExpDate(membership.expiresAt || addCalendarDays(today, 90));
    setEditNotes(membership.notes || "");
    setRefundingConsumptionId(null);
    setRefundReason("");
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

  async function runSafely(task: () => Promise<void>) {
    setLocalError("");
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

  return (
    <Dialog
      open={!!membership}
      onOpenChange={(open) => {
        if (!open && !busy && !isRegenerating) onClose();
      }}
    >
      <DialogContent className="v2-dialog kani-medit-dialog">
        {membership && (
          <>
            <div className="kani-medit-header">
              <div>
                <DialogTitle>{membership.planName}</DialogTitle>
                <DialogDescription>
                  {clientName}
                  {barberName ? ` · Barbero: ${barberName}` : ""} · Total congelado:{" "}
                  <strong>{money(membership.totalPriceArs)}</strong>
                </DialogDescription>
              </div>
              <MembershipStatusBadge status={membership.status} />
            </div>

            {localError ? (
              <p role="alert" className="v2-alert" style={{ marginTop: "8px" }}>
                {localError}
              </p>
            ) : null}

            <div className="kani-medit-scroll">
              {/* Resumen comercial */}
              <section className="kani-medit-section" aria-label="Resumen de membresía">
                <div className="kani-medit-kv-grid">
                  <div className="kani-medit-kv">
                    <span className="kani-medit-kv-label">Titular</span>
                    <span className="kani-medit-kv-value">{clientName}</span>
                  </div>
                  <div className="kani-medit-kv">
                    <span className="kani-medit-kv-label">Barbero asignado</span>
                    <span className="kani-medit-kv-value">{barberName || "Sin asignar"}</span>
                  </div>
                  <div className="kani-medit-kv">
                    <span className="kani-medit-kv-label">Sesiones disponibles</span>
                    <span className="kani-medit-kv-value">
                      {membership.remainingSessions} de {membership.totalSessions}
                    </span>
                  </div>
                  <div className="kani-medit-kv">
                    <span className="kani-medit-kv-label">
                      Valor ({membership.discountPercent}% OFF)
                    </span>
                    <span className="kani-medit-kv-value">
                      {money(membership.totalPriceArs)} (Subtotal {money(membership.subtotalArs)})
                    </span>
                  </div>
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
                        className="v2-primary"
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

              {/* Registrar consumo */}
              {membership.status === "ACTIVE" && membership.remainingSessions > 0 && (
                <section className="kani-medit-section" aria-label="Registrar consumo de sesión">
                  <h3 className="kani-medit-section-title">
                    <CheckCircle2 size={14} aria-hidden="true" />
                    <span>Registrar consumo de sesión</span>
                  </h3>
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
                  <div className="kani-medit-form-grid">
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
                      <span className="v2-field-label">Observación</span>
                      <input
                        type="text"
                        value={consumeNotes}
                        disabled={busy}
                        onChange={(e) => setConsumeNotes(e.target.value)}
                        placeholder="Opcional"
                      />
                    </label>
                  </div>
                  <div className="kani-medit-row-actions">
                    <button
                      type="button"
                      className="v2-primary"
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
                </section>
              )}

              {/* Renovación cuando está agotada */}
              {membership.status === "EXHAUSTED" && (
                <section className="kani-medit-section" aria-label="Renovación">
                  <h3 className="kani-medit-section-title">
                    <RefreshCw size={14} aria-hidden="true" />
                    <span>Membresía agotada</span>
                  </h3>
                  <div className="kani-medit-row-actions">
                    <button
                      type="button"
                      className="v2-primary"
                      disabled={busy}
                      onClick={() => onRenew(membership)}
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                      <span>Renovar membresía</span>
                    </button>
                  </div>
                </section>
              )}

              {/* Vigencia y vencimiento */}
              <form
                className="kani-medit-section"
                onSubmit={handleSaveExpiration}
                aria-label="Vigencia y vencimiento"
              >
                <h3 className="kani-medit-section-title">
                  <Calendar size={14} aria-hidden="true" />
                  <span>Vigencia, vencimiento y notas</span>
                </h3>
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
                  <span className="v2-field-label">Observaciones administrativas</span>
                  <input
                    type="text"
                    value={editNotes}
                    disabled={busy}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Motivo del cambio o nota interna"
                  />
                </label>
                <div className="kani-medit-row-actions">
                  <button type="submit" className="v2-secondary" disabled={busy}>
                    {busy ? "Guardando…" : "Guardar vigencia"}
                  </button>
                </div>
              </form>

              {/* Black Card */}
              {membership.publicToken && (
                <section className="kani-medit-section" aria-label="Black Card digital">
                  <h3 className="kani-medit-section-title">
                    <CreditCard size={14} aria-hidden="true" />
                    <span>Black Card del titular</span>
                  </h3>
                  <div className="kani-medit-row-actions">
                    <a
                      href={`/membresia/${membership.publicToken}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="v2-secondary"
                      style={{
                        minHeight: "32px",
                        padding: "0 10px",
                        fontSize: "12px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        textDecoration: "none",
                      }}
                    >
                      <ExternalLink size={13} aria-hidden="true" />
                      <span>Abrir tarjeta</span>
                    </a>
                    <button
                      type="button"
                      className="v2-secondary"
                      style={{ minHeight: "32px", padding: "0 10px", fontSize: "12px" }}
                      onClick={() => void onCopyLink(membership)}
                    >
                      {copied ? (
                        <Check size={13} style={{ color: "#10b981" }} aria-hidden="true" />
                      ) : (
                        <Copy size={13} aria-hidden="true" />
                      )}
                      <span>{copied ? "Enlace copiado" : "Copiar enlace"}</span>
                    </button>
                    {isOperator && !confirmRegenerate && (
                      <button
                        type="button"
                        className="v2-secondary"
                        style={{
                          minHeight: "32px",
                          padding: "0 10px",
                          fontSize: "12px",
                          color: "#b91c1c",
                        }}
                        disabled={isRegenerating}
                        onClick={() => setConfirmRegenerate(true)}
                      >
                        <RefreshCw size={13} aria-hidden="true" />
                        <span>Regenerar enlace</span>
                      </button>
                    )}
                  </div>
                  {isOperator && confirmRegenerate && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        padding: "10px",
                        borderRadius: "8px",
                        border: "1px solid rgba(220, 38, 38, 0.3)",
                      }}
                    >
                      <span style={{ fontSize: "12px" }}>
                        El enlace actual dejará de funcionar inmediatamente al regenerarlo.
                      </span>
                      <div className="kani-medit-row-actions">
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
                          onClick={() =>
                            void runSafely(async () => {
                              await onRegenerateToken(membership);
                              setConfirmRegenerate(false);
                            })
                          }
                        >
                          {isRegenerating ? "Regenerando…" : "Sí, regenerar y copiar"}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Sesiones por servicio */}
              <section className="kani-medit-section" aria-label="Sesiones por servicio">
                <h3 className="kani-medit-section-title">Sesiones por servicio</h3>
                {membership.items.map((item) => (
                  <div key={item.id} className="kani-medit-item-row">
                    <span>
                      {item.serviceName} (Tarifa congelada: {money(item.unitPriceSnapshotArs)})
                    </span>
                    <strong>
                      {item.remainingQuantity} disponibles / {item.totalQuantity} totales
                    </strong>
                  </div>
                ))}
              </section>

              {/* Historial de sesiones consumidas y reintegros */}
              <section className="kani-medit-section" aria-label="Historial de sesiones consumidas">
                <h3 className="kani-medit-section-title">
                  <History size={14} aria-hidden="true" />
                  <span>Historial de sesiones consumidas y reintegros</span>
                </h3>
                {!membership.consumptions.length ? (
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--muted-foreground)" }}>
                    Aún no se registraron consumos en esta membresía.
                  </p>
                ) : (
                  membership.consumptions.map((c) => {
                    const isRefundingThis = refundingConsumptionId === c.id;
                    return (
                      <div key={c.id} className="kani-medit-history-row">
                        <div className="kani-medit-history-top">
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
                            !isRefundingThis && (
                              <button
                                type="button"
                                className="v2-secondary"
                                style={{ minHeight: "28px", padding: "0 9px", fontSize: "11.5px" }}
                                disabled={busy}
                                onClick={() => {
                                  setRefundingConsumptionId(c.id);
                                  setRefundReason("");
                                }}
                              >
                                Reintegrar sesión
                              </button>
                            )
                          ) : (
                            <span style={{ fontSize: "11px", color: "#047857", fontWeight: 600 }}>
                              Reintegrada
                            </span>
                          )}
                        </div>

                        {isRefundingThis && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <input
                              type="text"
                              value={refundReason}
                              disabled={busy}
                              onChange={(e) => setRefundReason(e.target.value)}
                              placeholder="Motivo del reintegro (ej. Cancelación acordada)"
                            />
                            <div className="kani-medit-row-actions">
                              <button
                                type="button"
                                className="v2-secondary"
                                disabled={busy}
                                onClick={() => {
                                  setRefundingConsumptionId(null);
                                  setRefundReason("");
                                }}
                              >
                                No, conservar consumo
                              </button>
                              <button
                                type="button"
                                className="v2-primary"
                                disabled={busy}
                                onClick={() =>
                                  void runSafely(async () => {
                                    await onRefundSession({
                                      membership,
                                      consumptionId: c.id,
                                      reason:
                                        refundReason.trim() || "Reintegro autorizado por personal",
                                    });
                                    setRefundingConsumptionId(null);
                                    setRefundReason("");
                                  })
                                }
                              >
                                {busy ? "Reintegrando…" : "Sí, reintegrar sesión"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </section>

              {/* Auditoría de eventos */}
              <section className="kani-medit-section" aria-label="Auditoría de eventos">
                <h3 className="kani-medit-section-title">Auditoría de eventos</h3>
                {!membership.events.length ? (
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--muted-foreground)" }}>
                    Sin eventos adicionales.
                  </p>
                ) : (
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: "16px",
                      fontSize: "11.5px",
                      color: "var(--muted-foreground)",
                    }}
                  >
                    {membership.events.map((ev) => (
                      <li key={ev.id}>
                        <strong>{ev.eventType}</strong> — {ev.description} (
                        {ev.createdAt.replace("T", " ").slice(0, 16)})
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
                marginTop: "12px",
              }}
            >
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
  );
}
