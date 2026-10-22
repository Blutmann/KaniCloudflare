import { useState } from "react";
import { Lightbulb, TrendingUp } from "lucide-react";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { scopeV2, paymentSummary, changePercent } from "@/lib/kani-v2";
import { businessDateToday, addCalendarDays } from "@/lib/kani-mobile-appointments";
import { money } from "@/lib/kani-model";
import { BarberFilter, Empty, Metric, PageTitle, statusLabels } from "./shared";
import { useV2 } from "./data";

export function V2Insights() {
  const data = useV2();
  const staff = useAdminStaff();
  const today = businessDateToday();
  const [days, setDays] = useState(7);
  // Full elapsed dates: avoid comparing a partial day/week with a complete one.
  const end = addCalendarDays(today, -1);
  const start = addCalendarDays(end, -(days - 1));
  const previousStart = addCalendarDays(start, -days);
  const all = scopeV2(data.payments, staff.profile.role, staff.profile.barber_id, data.barberId);
  const payments = all.filter((p) => p.paymentDate >= start && p.paymentDate <= end);
  const previous = all.filter((p) => p.paymentDate >= previousStart && p.paymentDate < start);
  const appointments = scopeV2(
    data.appointments,
    staff.profile.role,
    staff.profile.barber_id,
    data.barberId,
  ).filter((a) => a.date >= start && a.date <= end);
  const summary = paymentSummary(payments);
  const comparison = changePercent(summary.count, previous.length);
  const points = Array.from({ length: days }, (_, i) => {
    const date = addCalendarDays(start, i);
    return { date, count: payments.filter((p) => p.paymentDate === date).length };
  });
  const maxCount = Math.max(1, ...points.map((p) => p.count));
  const byService = [...new Set(payments.map((p) => p.serviceName))]
    .map((name) => ({ name, count: payments.filter((p) => p.serviceName === name).length }))
    .sort((a, b) => b.count - a.count);
  const byMethod = ["Efectivo", "Transferencia"].map((name) => ({
    name,
    amount: payments
      .filter((p) => p.paymentMethod === name)
      .reduce((sum, p) => sum + p.collectedAmountArs, 0),
  }));
  return (
    <main className="v2-page">
      <PageTitle
        eyebrow="CLIENTE → APRENDIZAJE"
        title="Entender para crecer"
        description="Señales de tu actividad para decidir qué hacer después."
      />
      <div className="v2-filters">
        <label className="v2-field">
          Período
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Últimos 7 días completos</option>
            <option value={14}>Últimos 14 días completos</option>
            <option value={30}>Últimos 30 días completos</option>
          </select>
        </label>
        <BarberFilter />
      </div>
      <p className="v2-footnote">
        {start} al {end} · Solo registros disponibles. La jornada de hoy queda en Inicio.
      </p>
      <div className="v2-metrics v2-metrics-four">
        <Metric
          label="Servicios registrados"
          value={summary.count}
          note={
            comparison === null
              ? "Sin base anterior para comparar"
              : `${comparison > 0 ? "+" : ""}${comparison}% frente a los ${days} días anteriores`
          }
        />
        <Metric
          label="Cobrado en el local"
          value={money(summary.collected)}
          note="Sin sumar otra vez las señas previas"
        />
        <Metric
          label="Valor de servicios"
          value={money(summary.value)}
          note="Importes históricos de los cobros"
        />
        <Metric
          label="Cancelaciones"
          value={appointments.filter((a) => a.statusCode === "CANCELLED").length}
          note={`${appointments.length} turnos en el período`}
        />
      </div>
      <div className="v2-chart-grid">
        <section className="v2-panel">
          <div className="v2-section-title">
            <h2>Ritmo de servicios</h2>
            <TrendingUp size={20} />
          </div>
          <p className="v2-muted">Cobros registrados por día</p>
          {!payments.length ? (
            <Empty>Cuando registres servicios, vas a ver la evolución acá.</Empty>
          ) : (
            <div
              className="v2-bar-chart"
              role="img"
              aria-label={`Servicios por día: ${points.map((p) => `${p.date}: ${p.count}`).join(", ")}`}
            >
              {points.map((p, i) => (
                <div key={p.date} title={`${p.date}: ${p.count} servicios`}>
                  <span>{p.count || ""}</span>
                  <i style={{ height: `${(p.count / maxCount) * 140 + 2}px` }} />
                  <small>{days <= 14 || i % 5 === 0 ? p.date.slice(8) : ""}</small>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="v2-panel">
          <h2>Qué eligen tus clientes</h2>
          <p className="v2-muted">Distribución de servicios registrados</p>
          {!byService.length && <Empty>Sin servicios registrados en este período.</Empty>}
          {byService.map((s) => (
            <div className="v2-distribution" key={s.name}>
              <div>
                <span>{s.name}</span>
                <strong>
                  {s.count} · {Math.round((s.count / summary.count) * 100)}%
                </strong>
              </div>
              <div className="v2-track">
                <i style={{ width: `${(s.count / summary.count) * 100}%` }} />
              </div>
            </div>
          ))}
        </section>
      </div>
      <div className="v2-chart-grid">
        <section className="v2-panel">
          <h2>La agenda en contexto</h2>
          <div className="v2-status-summary">
            {Object.entries(statusLabels).map(([code, label]) => (
              <div key={code}>
                <span>{label}</span>
                <strong>{appointments.filter((a) => a.statusCode === code).length}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="v2-panel">
          <h2>Cómo cobrás</h2>
          {byMethod.map((m) => (
            <div className="v2-history-row" key={m.name}>
              <span>{m.name}</span>
              <strong>{money(m.amount)}</strong>
            </div>
          ))}
        </section>
      </div>
      <section className="v2-insights">
        <div className="v2-section-title">
          <h2>
            <Lightbulb size={21} />
            Para tu próxima decisión
          </h2>
        </div>
        <div className="v2-insight-grid">
          <article>
            <span>01 / RITMO</span>
            <h3>
              {comparison !== null && comparison > 0
                ? "Tu actividad crece"
                : "Construí una base para comparar"}
            </h3>
            <p>
              {comparison !== null
                ? `Registraste ${summary.count} servicios frente a ${previous.length} en los ${days} días anteriores. Compará también los días trabajados antes de sacar conclusiones.`
                : "Todavía no hay cobros en el período anterior. Un registro constante te va a permitir reconocer tendencias."}
            </p>
          </article>
          <article>
            <span>02 / OPORTUNIDAD</span>
            <h3>Buscá tus próximos espacios</h3>
            <p>
              Consultá Horarios para planificar una promoción o producir contenido. El mapa de
              ocupación se incorporará cuando exista un historial confiable de disponibilidad.
            </p>
          </article>
        </div>
      </section>
      <p className="v2-footnote">
        Ocupación, recurrencia y heatmap quedan pendientes: no se estiman usando disponibilidad
        futura ni cobros sin vínculo a clientes.
      </p>
    </main>
  );
}
