import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { staffListBenefitCodesReadOnlyFn } from "@/lib/kani-benefit-codes.functions";
import { isStaffOperator } from "@/lib/kani-permissions";
import { formatCountEs } from "@/lib/kani-statistics";
import { Empty } from "./shared";

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

export function V2Discounts({ hideHeading = false }: { hideHeading?: boolean } = {}) {
  const { profile } = useAdminStaff();
  const [rows, setRows] = useState<Code[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const canViewDiscounts = isStaffOperator(profile.role) || profile.role === "BARBER";

  useEffect(() => {
    let cancelled = false;
    if (!canViewDiscounts) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        try {
          const serverRows = await staffListBenefitCodesReadOnlyFn({ data: { token } });
          if (!cancelled && Array.isArray(serverRows)) {
            setRows(serverRows as Code[]);
            setLoading(false);
            return;
          }
        } catch {
          // Fallback to direct RPC when server function is unavailable (e.g. unit test mocks)
        }
        const { data, error: rpcError } = await (supabase.rpc as any)("staff_list_benefit_codes");
        if (cancelled) return;
        if (rpcError) setError(rpcError.message);
        else setRows(data ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Error al consultar descuentos.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canViewDiscounts]);

  if (!canViewDiscounts) {
    return <p role="alert">No tenés permisos para consultar descuentos.</p>;
  }

  const visibleRows = rows.filter((row) => {
    const meta = metadata(row);
    return !row.deletedAt && !meta["deletedAt"] && row.status !== "DELETED";
  });

  return (
    <main className="v2-page">
      {!hideHeading && (
        <>
          <h1>Descuentos</h1>
          <p>Consulta de códigos y sus utilizaciones.</p>
        </>
      )}
      {error && (
        <p role="alert" className="v2-alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Cargando descuentos…</p>}
      {!loading && !visibleRows.length && !error && <Empty>No hay códigos de descuento.</Empty>}
      <div className="v2-client-grid">
        {visibleRows.map((row) => {
          const meta = metadata(row);
          const { label: typeLabel, benefit } = describeBenefitType(row.type);
          const isActive = row.status === "ACTIVE";
          const effectiveUsages = getEffectiveUsages(row.usages);
          const totalUsages =
            effectiveUsages.length > 0
              ? effectiveUsages.length
              : (row.timesUsed ?? row.times_used ?? Number(meta["timesUsed"] ?? 0));
          const uniqueClients = countUniqueClients(effectiveUsages);
          const validity = formatValidity(row, meta);

          return (
            <article key={row.id} className="v2-panel">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 style={{ margin: 0 }}>{row.code}</h2>
                <span
                  className={`kani-mcard-badge ${isActive ? "is-active" : "is-neutral"}`}
                  style={{
                    padding: "4px 10px",
                    fontSize: "0.75rem",
                    border: "1px solid currentColor",
                  }}
                >
                  {isActive ? "Activo" : "Inactivo"}
                </span>
              </div>
              <dl>
                <dt>Tipo de descuento</dt>
                <dd>{typeLabel}</dd>
                <dt>Beneficio</dt>
                <dd>{benefit}</dd>
                {validity && (
                  <>
                    <dt>Vigencia</dt>
                    <dd>{validity}</dd>
                  </>
                )}
                <dt>Utilizaciones totales</dt>
                <dd>{formatCountEs(totalUsages, "utilización", "utilizaciones")}</dd>
                <dt>Clientes únicos</dt>
                <dd>
                  {effectiveUsages.length > 0
                    ? formatCountEs(uniqueClients, "cliente", "clientes")
                    : totalUsages === 0
                      ? "0 clientes"
                      : "Sin detalle disponible"}
                </dd>
              </dl>
              {effectiveUsages.length > 0 && (
                <details>
                  <summary>
                    Historial de utilizaciones ({effectiveUsages.length})
                  </summary>
                  <ul>
                    {effectiveUsages.map((usage) => (
                      <li key={usage.appointmentId}>
                        <strong>{usage.clientName ?? "Cliente"}</strong> · {formatUsageDate(usage)}
                        {usage.barberName ? ` · Barbero: ${usage.barberName}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
