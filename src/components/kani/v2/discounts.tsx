import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { isStaffOperator } from "@/lib/kani-permissions";
import { Empty } from "./shared";

type Usage = {
  appointmentId: string;
  requestNumber?: number;
  clientName?: string;
  bookingDate?: string;
  appointmentStatus?: string;
};
type Code = {
  id: string;
  code: string;
  type: string;
  status: string;
  created_at: string;
  valid_from?: string;
  valid_until?: string;
  times_used?: number;
  internal_note?: string;
  usages: Usage[];
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

export function V2Discounts() {
  const { profile } = useAdminStaff();
  const [rows, setRows] = useState<Code[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    if (!isStaffOperator(profile.role)) {
      setLoading(false);
      return;
    }
    void (async () => {
      const { data, error } = await (supabase.rpc as any)("staff_list_benefit_codes");
      if (cancelled) return;
      if (error) setError(error.message);
      else setRows(data ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.role]);
  if (!isStaffOperator(profile.role))
    return <p role="alert">No tenés permisos para consultar descuentos.</p>;
  return (
    <main className="v2-page">
      <h1>Descuentos</h1>
      <p>Consulta de códigos y sus utilizaciones.</p>
      {error && (
        <p role="alert" className="v2-alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Cargando descuentos…</p>}
      {!loading && !rows.length && !error && <Empty>No hay códigos de descuento.</Empty>}
      <div className="v2-client-grid">
        {rows.map((row) => {
          const meta = metadata(row);
          const value =
            row.type === "PERCENT_10"
              ? "10%"
              : row.type === "PERCENT_50"
                ? "50%"
                : row.type === "FREE_SERVICE"
                  ? "100% del servicio"
                  : "Sin seña";
          return (
            <article key={row.id} className="v2-panel">
              <h2>{row.code}</h2>
              <dl>
                <dt>Tipo y valor</dt>
                <dd>{value}</dd>
                <dt>Estado</dt>
                <dd>{meta["deletedAt"] ? "Eliminado" : row.status}</dd>
                <dt>Creado</dt>
                <dd>{new Date(row.created_at).toLocaleDateString("es-AR")}</dd>
                <dt>Inicio de vigencia</dt>
                <dd>
                  {String(row.valid_from ?? meta["validFrom"] ?? row.created_at).slice(0, 10)}
                </dd>
                <dt>Vencimiento</dt>
                <dd>
                  {String(row.valid_until ?? meta["validUntil"] ?? "Sin vencimiento").slice(0, 20)}
                </dd>
                <dt>Utilizaciones</dt>
                <dd>{row.times_used ?? Number(meta["timesUsed"] ?? row.usages.length)}</dd>
              </dl>
              {row.usages.length > 0 && (
                <details>
                  <summary>Clientes y turnos asociados</summary>
                  <ul>
                    {row.usages.map((usage) => (
                      <li key={usage.appointmentId}>
                        {usage.clientName ?? "Cliente"} · Turno #{usage.requestNumber ?? "—"} ·{" "}
                        {usage.bookingDate} · {usage.appointmentStatus}
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
