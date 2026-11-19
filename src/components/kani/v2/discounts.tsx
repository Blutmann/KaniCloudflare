import { useEffect, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { staffListBenefitCodesReadOnlyFn } from "@/lib/kani-benefit-codes.functions";
import { isStaffOperator } from "@/lib/kani-permissions";
import { formatCountEs } from "@/lib/kani-statistics";
import { Empty } from "./shared";
import "./discount-card.css";

type Usage = {
  appointmentId: string;
  requestNumber?: number | null;
  clientId?: string | null;
  clientName?: string | null;
  barberName?: string | null;
  bookingDate?: string | null;
  usedAt?: string | null;
  appointmentStatus?: string | null;
  isAppointmentCancelled?: boolean;
};

type Code = {
  id: string;
  code: string;
  type: string;
  status: string;
  created_at?: string;
  createdAt?: string;
  valid_from?: string | null;
  validFrom?: string | null;
  valid_until?: string | null;
  validUntil?: string | null;
  times_used?: number;
  timesUsed?: number;
  deletedAt?: string | null;
  internal_note?: string | null;
  usages?: Usage[];
};

function metadata(row: Code): Record<string, unknown> {
  const note = row.internal_note ?? "";
  const match = note.match(/\[\[KANI_META:([\s\S]+)\]\]$/);
  try {
    return match?.[1] ? JSON.parse(match[1]) : {};
  } catch {
    return {};
  }
}

function describeBenefitType(type: string): { label: string; benefit: string } {
  switch (type) {
    case "PERCENT_10":
      return { label: "Descuento porcentual", benefit: "10% de descuento" };
    case "PERCENT_50":
      return { label: "Descuento porcentual", benefit: "50% de descuento" };
    case "FREE_SERVICE":
      return { label: "Servicio bonificado", benefit: "100% del servicio" };
    default:
      return { label: "Exención de seña", benefit: "Sin seña" };
  }
}

function formatUsageDate(usage: Usage): string {
  const raw = usage.bookingDate || usage.usedAt;
  if (!raw) return "Fecha no disponible";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-");
    return `${d}/${m}/${y}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString("es-AR");
}

function formatValidityDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const trimmed = raw.trim();
  const ymd = trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [y, m, d] = ymd.split("-");
    return `${d}/${m}/${y}`;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toLocaleDateString("es-AR");
}

function formatValidity(row: Code, meta: Record<string, unknown>): string | null {
  const from = formatValidityDate(row.validFrom ?? row.valid_from ?? meta["validFrom"]);
  const until = formatValidityDate(row.validUntil ?? row.valid_until ?? meta["validUntil"]);
  if (from && until) return `${from} al ${until}`;
  if (until) return `Hasta ${until}`;
  if (from) return `Desde ${from}`;
  return null;
}

function getEffectiveUsages(usages: Usage[] | undefined): Usage[] {
  if (!Array.isArray(usages)) return [];
  return usages.filter(
    (u) => !u.isAppointmentCancelled && u.appointmentStatus !== "CANCELLED",
  );
}

function countUniqueClients(usages: Usage[]): number {
  const seen = new Set<string>();
  for (const u of usages) {
    const key = u.clientId
      ? `id:${u.clientId}`
      : u.clientName
        ? `name:${u.clientName.trim().toLowerCase()}`
        : `appt:${u.appointmentId}`;
    seen.add(key);
  }
  return seen.size;
}

function formatDiscountsError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/AUTH_REQUIRED|SESSION_EXPIRED/i.test(raw)) {
    return "Tu sesión expiró. Iniciá sesión nuevamente para ver los descuentos.";
  }
  if (/UNAUTHORIZED_/i.test(raw)) {
    return "No tenés permisos para consultar los códigos de descuento.";
  }
  return "No pudimos cargar los códigos de descuento en este momento. Intentá nuevamente.";
}

export function V2Discounts({ hideHeading = false }: { hideHeading?: boolean } = {}) {
  const { profile } = useAdminStaff();
  const [rows, setRows] = useState<Code[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const canViewDiscounts = isStaffOperator(profile.role) || profile.role === "BARBER";

  async function handleCopy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Fallback visual/accesible si el portapapeles no está disponible en el entorno
    }
    setCopiedCode(code);
    setTimeout(() => {
      setCopiedCode((prev) => (prev === code ? null : prev));
    }, 2500);
  }

  useEffect(() => {
    let cancelled = false;
    if (!canViewDiscounts) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        const serverRows = await staffListBenefitCodesReadOnlyFn({ data: { token } });
        if (!cancelled) {
          setRows(Array.isArray(serverRows) ? (serverRows as Code[]) : []);
        }
      } catch (err) {
        console.error("[V2Discounts] Error al consultar códigos de descuento:", err);
        if (!cancelled) {
          setError(formatDiscountsError(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canViewDiscounts, reloadTick]);

  if (!canViewDiscounts) {
    return <p role="alert">No tenés permisos para consultar descuentos.</p>;
  }

  const visibleRows = rows.filter((row) => {
    const meta = metadata(row);
    return !row.deletedAt && !meta["deletedAt"] && row.status !== "DELETED";
  });

  return (
    <div className={hideHeading ? "kani-dreadonly-wrap" : "v2-page kani-dreadonly-wrap"}>
      {!hideHeading && (
        <>
          <h1>Descuentos</h1>
          <p>Consulta de códigos y sus utilizaciones.</p>
        </>
      )}
      {error && (
        <div role="alert" className="v2-alert flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          <button
            type="button"
            className="v2-btn v2-btn-secondary"
            onClick={() => setReloadTick((n) => n + 1)}
          >
            Reintentar
          </button>
        </div>
      )}
      {loading && <p role="status">Cargando descuentos…</p>}
      {!loading && !visibleRows.length && !error && (
        <Empty className="kani-dcard-empty">No hay códigos de descuento.</Empty>
      )}
      {visibleRows.length > 0 && (
        <>
          <span className="sr-only" role="status" aria-live="polite">
            {copiedCode ? `Código copiado: ${copiedCode}` : ""}
          </span>
          <div className={`kani-dgrid${visibleRows.length === 1 ? " is-single" : ""}`}>
            {visibleRows.map((row) => {
              const meta = metadata(row);
              const { label: typeLabel, benefit } = describeBenefitType(row.type);
              const isActive = row.status === "ACTIVE";
              const isCopied = copiedCode === row.code;
              const effectiveUsages = getEffectiveUsages(row.usages);
              const totalUsages =
                effectiveUsages.length > 0
                  ? effectiveUsages.length
                  : (row.timesUsed ?? row.times_used ?? Number(meta["timesUsed"] ?? 0));
              const uniqueClients = countUniqueClients(effectiveUsages);
              const validity = formatValidity(row, meta);

              return (
                <article
                  key={row.id}
                  className="kani-dcard kani-dcard--readonly"
                  data-status={row.status}
                >
                  <div className="kani-dcard-body">
                    <header className="kani-dcard-header kani-dcard-header--readonly">
                      <h2 className="kani-dcard-benefit kani-dcard-benefit--readonly">{benefit}</h2>
                      <span className={`kani-dcard-badge ${isActive ? "is-active" : "is-inactive"}`}>
                        {isActive ? "Activo" : "Inactivo"}
                      </span>
                    </header>

                    <div className="kani-dcard-code-group kani-dcard-code-group--readonly">
                      <span className="kani-dcard-code select-all">{row.code}</span>
                      <div className="kani-dcard-copy-wrap">
                        {isCopied && (
                          <span className="kani-dcard-copied-tag">Código copiado</span>
                        )}
                        <button
                          type="button"
                          className={`v2-secondary kani-dcard-btn-copy${isCopied ? " is-copied" : ""}`}
                          aria-label={isCopied ? `Código copiado: ${row.code}` : `Copiar código ${row.code}`}
                          title={isCopied ? "Código copiado" : "Copiar código"}
                          onClick={() => void handleCopy(row.code)}
                        >
                          {isCopied ? (
                            <Check size={14} aria-hidden="true" />
                          ) : (
                            <Copy size={14} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </div>

                    <dl className="kani-dcard-metrics-grid">
                      <div className="kani-dcard-metric">
                        <dt>Beneficio</dt>
                        <dd>{typeLabel}</dd>
                      </div>
                      <div className="kani-dcard-metric">
                        <dt>Vigencia</dt>
                        <dd>{validity ?? "Sin vencimiento"}</dd>
                      </div>
                      <div className="kani-dcard-metric">
                        <dt>Utilizaciones</dt>
                        <dd>{formatCountEs(totalUsages, "utilización", "utilizaciones")}</dd>
                      </div>
                      <div className="kani-dcard-metric">
                        <dt>Clientes únicos</dt>
                        <dd>
                          {effectiveUsages.length > 0
                            ? formatCountEs(uniqueClients, "cliente", "clientes")
                            : totalUsages === 0
                              ? "0 clientes"
                              : "Sin detalle disponible"}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {effectiveUsages.length > 0 ? (
                    <details className="kani-dcard-history">
                      <summary className="kani-dcard-history-summary">
                        <span>Historial de utilizaciones ({effectiveUsages.length})</span>
                        <ChevronDown size={15} className="kani-dcard-history-chevron" aria-hidden="true" />
                      </summary>
                      <ul className="kani-dcard-history-list">
                        {effectiveUsages.map((usage) => (
                          <li key={usage.appointmentId} className="kani-dcard-history-item">
                            <strong className="kani-dcard-history-client">
                              {usage.clientName ?? "Cliente"}
                            </strong>
                            <span className="kani-dcard-history-meta">
                              {formatUsageDate(usage)}
                              {usage.barberName ? ` · Barbero: ${usage.barberName}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <p className="kani-dcard-history-empty">Sin utilizaciones registradas.</p>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
