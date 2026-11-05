import { useEffect, useState } from "react";
import { Tag, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { isStaffOperator } from "@/lib/kani-permissions";
import {
  BENEFIT_TYPE_DEFINITIONS,
  computeBenefitCodeStatus,
  formatBuenosAiresDate,
  type BenefitCodeType,
} from "@/lib/kani-benefit-codes";
import { Empty } from "./shared";

export type StaffBenefitCode = {
  id: string;
  code: string;
  type: string;
  status: string;
  created_at: string;
  valid_from?: string | null;
  valid_until?: string | null;
  times_used?: number;
  internal_note?: string;
  consumed_at?: string | null;
  consumed_appointment_id?: string | null;
  locked_expires_at?: string | null;
  usages?: Array<{
    appointmentId: string;
    requestNumber?: number;
    clientName?: string;
    bookingDate?: string;
    appointmentStatus?: string;
  }>;
};

const statusLabels: Record<string, string> = {
  ACTIVE: "Activo",
  CONSUMED: "Utilizado",
  EXPIRED: "Vencido",
  INACTIVE: "Inactivo",
  DISABLED: "Desactivado",
  DELETED: "Eliminado",
  SCHEDULED: "Programado",
  LOCKED: "En proceso",
};
const appointmentLabels: Record<string, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmado",
  CANCELLED: "Cancelado",
  COMPLETED: "Completado",
  NO_SHOW: "Ausente",
  REQUESTED: "Solicitado",
};
function metadata(row: StaffBenefitCode): Record<string, unknown> {
  const match = (row.internal_note ?? "").match(/\[\[KANI_META:([\s\S]+)\]\]$/);
  try {
    const parsed = match?.[1] ? JSON.parse(match[1]) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function dateText(value?: string | null) {
  if (!value) return "Sin fecha";
  return formatBuenosAiresDate(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + "T12:00:00-03:00" : value,
  );
}
export function StaffCodeCard({ row }: { row: StaffBenefitCode }) {
  const meta = metadata(row);
  const usages = row.usages ?? [];
  const validFrom =
    row.valid_from ?? (typeof meta["validFrom"] === "string" ? meta["validFrom"] : row.created_at);
  const validUntil =
    row.valid_until ?? (typeof meta["validUntil"] === "string" ? meta["validUntil"] : null);
  const usageMode = meta["usageMode"] === "REUSABLE" ? "REUSABLE" : "SINGLE_USE";
  const count = Number(row.times_used ?? meta["timesUsed"] ?? 0);
  const timesUsed = Math.max(
    Number.isFinite(count) && count > 0 ? count : 0,
    usages.length,
    row.consumed_at || row.consumed_appointment_id || row.status === "CONSUMED" ? 1 : 0,
  );
  const status = meta["deletedAt"]
    ? "DELETED"
    : row.status !== "ACTIVE"
      ? row.status
      : row.locked_expires_at &&
          new Date(row.locked_expires_at).getTime() > Date.now() &&
          usageMode === "SINGLE_USE"
        ? "LOCKED"
        : computeBenefitCodeStatus({
            status: row.status,
            usageMode,
            timesUsed,
            validFrom,
            validUntil:
              validUntil && /^\d{4}-\d{2}-\d{2}$/.test(validUntil)
                ? validUntil + "T23:59:59.999-03:00"
                : validUntil,
          });
  const definition = BENEFIT_TYPE_DEFINITIONS[row.type as BenefitCodeType];
  const benefitLabel =
    row.type === "FREE_SERVICE"
      ? "Servicio gratuito · 100%"
      : row.type === "NO_DEPOSIT"
        ? "Reserva sin seña · $0 online"
        : (definition?.label ?? "Beneficio no disponible");
  const details = [
    ["Tipo y valor", benefitLabel],
    ["Creado", dateText(row.created_at)],
    ["Inicio de vigencia", dateText(validFrom)],
    ["Vencimiento", validUntil ? dateText(validUntil) : "Sin vencimiento"],
    ["Modalidad", usageMode === "REUSABLE" ? "Reutilizable" : "Un solo uso"],
    ["Utilizaciones", String(timesUsed)],
  ];
  return (
    <article
      className="v2-code-card p-4 rounded-lg border border-border bg-background/50 space-y-3"
      aria-label={`Código ${row.code}`}
    >
      <div className="v2-code-card-heading">
        <h2 className="font-mono text-base font-bold tracking-wider select-all px-2.5 py-1 rounded border text-foreground bg-muted/50 border-border/80">
          {row.code}
        </h2>
        <span className="v2-code-status" data-status={status}>
          {statusLabels[status] ?? "Estado no informado"}
        </span>
      </div>
      <dl className="v2-code-facts border-t border-border/50 pt-3">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {usages.length > 0 && (
        <details className="v2-code-usages border-t border-border/50 pt-3">
          <summary className="text-xs font-medium text-foreground">
            <Users size={14} aria-hidden="true" /> Clientes y turnos asociados ({usages.length})
          </summary>
          <ul>
            {usages.map((usage) => (
              <li
                key={usage.appointmentId}
                className="rounded border border-border bg-muted/20 p-3"
              >
                <strong className="block text-sm text-foreground">
                  {usage.clientName || "Cliente"}
                </strong>
                <span className="block text-xs text-muted-foreground">
                  Turno #{usage.requestNumber ?? "—"} · {dateText(usage.bookingDate)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {appointmentLabels[usage.appointmentStatus ?? ""] ?? "Estado no informado"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
export function V2Discounts() {
  const { profile } = useAdminStaff();
  const [rows, setRows] = useState<StaffBenefitCode[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    if (!isStaffOperator(profile.role)) {
      setLoading(false);
      return;
    }
    setRows([]);
    setError("");
    setLoading(true);
    void (async () => {
      try {
        const { data, error } = await (supabase.rpc as any)("staff_list_benefit_codes");
        if (error) throw error;
        if (!cancelled) setRows(data ?? []);
      } catch {
        if (!cancelled) setError("No pudimos consultar los códigos. Volvé a intentar.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.role]);
  if (!isStaffOperator(profile.role))
    return <p role="alert">No tenés permisos para consultar códigos.</p>;
  return (
    <main className="v2-page">
      <section
        className="maintenance-section w-full p-5 sm:p-6 rounded-[var(--radius-card)] border border-border bg-card space-y-5"
        aria-labelledby="staff-codes-title"
      >
        <div className="space-y-1 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Tag size={20} className="text-gold shrink-0" aria-hidden="true" />
            <h1
              id="staff-codes-title"
              className="text-lg font-semibold tracking-tight text-foreground"
            >
              Códigos
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Consulta de códigos de beneficio, vigencias y utilizaciones.
          </p>
        </div>
        {error && (
          <p role="alert" className="v2-alert">
            {error}
          </p>
        )}
        {loading && <p role="status">Cargando códigos…</p>}
        {!loading && !rows.length && !error && <Empty>No hay códigos de descuento.</Empty>}
        <div className="v2-code-grid">
          {rows.map((row) => (
            <StaffCodeCard key={row.id} row={row} />
          ))}
        </div>
      </section>
    </main>
  );
}
