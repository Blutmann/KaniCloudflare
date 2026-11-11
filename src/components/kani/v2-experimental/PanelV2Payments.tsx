import { useState } from "react";
import { BarChart3, List } from "lucide-react";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { isStaffOperator } from "@/lib/kani-permissions";
import { businessDateToday } from "@/lib/kani-mobile-appointments";
import { money } from "@/lib/kani-model";
import {
  calculatePaymentPeriodRange,
  getPaymentPeriodDynamicLabels,
  type PaymentPeriodFilter,
} from "@/lib/kani-payments";
import { deduplicatePaymentMovements, paymentSummary, scopeV2 } from "@/lib/kani-v2";
import { useV2 } from "@/components/kani/v2/data";
import { formatPaymentMethodLabel, V2Payments } from "@/components/kani/v2/payments";
import { BarberFilter, Empty } from "@/components/kani/v2/shared";

type PaymentsViewMode = "movimientos" | "resumen";

/**
 * Vista de Pagos en Panel V2:
 * Conserva exactamente el flujo completo de V2Payments bajo «Movimientos» (predeterminada)
 * e incorpora «Resumen» con métricas reales y desgloses por método y barbero.
 */
export function PanelV2Payments() {
  const [view, setView] = useState<PaymentsViewMode>("movimientos");
  const { payments, barberId } = useV2();
  const staff = useAdminStaff();
  const isOperator = isStaffOperator(staff.profile.role);
  const today = businessDateToday();

  const [period, setPeriod] = useState<PaymentPeriodFilter>("TODAY");
  const [customStartDate, setCustomStartDate] = useState(today);
  const [customEndDate, setCustomEndDate] = useState(today);

  const dynamicLabels = getPaymentPeriodDynamicLabels(today);
  const periodRange = calculatePaymentPeriodRange(period, today, customStartDate, customEndDate);
  const isInvalidRange = period === "CUSTOM" && Boolean(periodRange.isInvalid);

  const scoped = isInvalidRange
    ? []
    : deduplicatePaymentMovements(
        scopeV2(payments, staff.profile.role, staff.profile.barber_id, barberId),
      ).filter((p) => p.paymentDate >= periodRange.start && p.paymentDate <= periodRange.end);

  const summary = paymentSummary(scoped);

  // Desglose por método de cobro usando movimientos activos del período
  const byMethodMap = new Map<string, { count: number; total: number }>();
  for (const p of scoped) {
    if (p.serviceName === "Anulado") continue;
    const label = formatPaymentMethodLabel(p.paymentMethod) || "Otro";
    const prev = byMethodMap.get(label) ?? { count: 0, total: 0 };
    byMethodMap.set(label, {
      count: prev.count + 1,
      total: prev.total + p.collectedAmountArs,
    });
  }
  const byMethod = Array.from(byMethodMap.entries()).sort((a, b) => b[1].total - a[1].total);

  // Desglose por barbero (visible para operadores; BARBER ve solo su propio total)
  const byBarberMap = new Map<string, { name: string; count: number; total: number }>();
  for (const p of scoped) {
    if (p.serviceName === "Anulado") continue;
    const key = p.barberId || "sin-barbero";
    const barberName = staff.barbers.find((b) => b.id === p.barberId)?.name || "Personal";
    const prev = byBarberMap.get(key) ?? { name: barberName, count: 0, total: 0 };
    byBarberMap.set(key, {
      name: barberName,
      count: prev.count + 1,
      total: prev.total + p.collectedAmountArs,
    });
  }
  const byBarber = Array.from(byBarberMap.values()).sort((a, b) => b.total - a.total);

  return (
    <div className="kani-panel-v2-payments-wrap">
      <div className="kani-panel-v2-view-bar">
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--muted-foreground)" }}>
          Vista de pagos
        </span>
        <div className="kani-panel-v2-view-tabs" role="tablist" aria-label="Vistas de Pagos">
          <button
            type="button"
            role="tab"
            aria-selected={view === "movimientos"}
            className={`kani-panel-v2-view-tab${view === "movimientos" ? " is-active" : ""}`}
            onClick={() => setView("movimientos")}
          >
            <List size={15} aria-hidden="true" />
            <span>Movimientos</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "resumen"}
            className={`kani-panel-v2-view-tab${view === "resumen" ? " is-active" : ""}`}
            onClick={() => setView("resumen")}
          >
            <BarChart3 size={15} aria-hidden="true" />
            <span>Resumen</span>
          </button>
        </div>
      </div>

      {view === "movimientos" ? (
        <V2Payments />
      ) : (
        <main className="v2-page">
          <section className="kani-panel-v2-summary-card" aria-label="Resumen de pagos">
            <div className="v2-section-title">
              <h2>Resumen de cobros</h2>
              <span>{summary.count} movimientos válidos</span>
            </div>

            <div className="v2-filters">
              <label className="v2-field">
                Período
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as PaymentPeriodFilter)}
                >
                  <option value="TODAY">Hoy</option>
                  <option value="YESTERDAY">Ayer</option>
                  <option value="THIS_WEEK">Esta semana</option>
                  <option value="THIS_MONTH">{dynamicLabels["THIS_MONTH"]}</option>
                  <option value="THIS_YEAR">{dynamicLabels["THIS_YEAR"]}</option>
                  <option value="LAST_7_DAYS">Últimos 7 días</option>
                  <option value="LAST_14_DAYS">Últimos 14 días</option>
                  <option value="LAST_30_DAYS">Últimos 30 días</option>
                  <option value="PREVIOUS_MONTH">{dynamicLabels["PREVIOUS_MONTH"]}</option>
                  <option value="PREVIOUS_YEAR">{dynamicLabels["PREVIOUS_YEAR"]}</option>
                  <option value="CUSTOM">Fecha específica</option>
                </select>
              </label>
              {period === "CUSTOM" && (
                <>
                  <label className="v2-field">
                    Fecha desde
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value || today)}
                    />
                  </label>
                  <label className="v2-field">
                    Fecha hasta
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value || today)}
                    />
                  </label>
                </>
              )}
              <BarberFilter />
            </div>

            {isInvalidRange && (
              <p className="v2-alert" role="alert">
                Rango no válido: Fecha desde debe ser menor o igual a Fecha hasta.
              </p>
            )}

            <div className="kani-panel-v2-summary-kpis">
              <div className="kani-panel-v2-summary-kpi">
                <span>Total recaudado</span>
                <strong>{money(summary.collected)}</strong>
              </div>
              <div className="kani-panel-v2-summary-kpi">
                <span>Valor de servicios</span>
                <strong>{money(summary.value)}</strong>
              </div>
              <div className="kani-panel-v2-summary-kpi">
                <span>Señas online</span>
                <strong>{money(summary.deposits)}</strong>
              </div>
              <div className="kani-panel-v2-summary-kpi">
                <span>Cobros registrados</span>
                <strong>{summary.count}</strong>
              </div>
            </div>

            {!scoped.length ? (
              <Empty>No hay cobros registrados en este período para resumir.</Empty>
            ) : (
              <div className="kani-panel-v2-summary-splits">
                <div className="kani-panel-v2-summary-box">
                  <h3>Por método de cobro</h3>
                  {byMethod.map(([label, stats]) => (
                    <div key={label} className="kani-panel-v2-summary-row">
                      <span>
                        {label} ({stats.count})
                      </span>
                      <strong>{money(stats.total)}</strong>
                    </div>
                  ))}
                </div>

                {isOperator && (
                  <div className="kani-panel-v2-summary-box">
                    <h3>Por barbero</h3>
                    {byBarber.map((row) => (
                      <div key={row.name} className="kani-panel-v2-summary-row">
                        <span>
                          {row.name} ({row.count})
                        </span>
                        <strong>{money(row.total)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
