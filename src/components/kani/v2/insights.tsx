import { useState, useMemo } from "react";
import { Lightbulb, TrendingUp } from "lucide-react";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { scopeV2, paymentSummary, changePercent } from "@/lib/kani-v2";
import { businessDateToday, addCalendarDays } from "@/lib/kani-mobile-appointments";
import { money } from "@/lib/kani-model";
import { BarberFilter, Empty, Metric, statusLabels } from "./shared";
import { useV2 } from "./data";

export type InsightsPeriodKey =
  | "HOY"
  | "AYER"
  | "ESTA_SEMANA"
  | "ESTE_MES"
  | "ESTE_ANIO"
  | "ULTIMOS_7"
  | "ULTIMOS_14"
  | "ULTIMOS_30"
  | "MES_ANTERIOR"
  | "ANIO_ANTERIOR"
  | "CUSTOM";

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const MONTH_SHORT = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

export function V2Insights() {
  const data = useV2();
  const staff = useAdminStaff();
  const today = businessDateToday(); // "YYYY-MM-DD" in America/Argentina/Buenos_Aires
  const [period, setPeriod] = useState<InsightsPeriodKey>("ULTIMOS_7");
  const [customStartDate, setCustomStartDate] = useState(today);
  const [customEndDate, setCustomEndDate] = useState(today);

  const isInvalidRange = period === "CUSTOM" && customStartDate > customEndDate;

  const [currentYear, currentMonth, currentDay] = useMemo(
    () => today.split("-").map(Number),
    [today],
  );

  // Compute exact period definitions and labels in strict order
  const periodConfig = useMemo(() => {
    // 1. Hoy
    const hoyStart = today;
    const hoyEnd = today;
    const hoyPrevStart = addCalendarDays(today, -1);
    const hoyPrevEnd = hoyPrevStart;

    // 2. Ayer
    const ayerStart = addCalendarDays(today, -1);
    const ayerEnd = ayerStart;
    const ayerPrevStart = addCalendarDays(today, -2);
    const ayerPrevEnd = ayerPrevStart;

    // 3. Esta semana (Lunes a Domingo en ISO)
    const todayDateObj = new Date(currentYear, currentMonth - 1, currentDay);
    const dayOfWeek = (todayDateObj.getDay() + 6) % 7; // Lunes = 0, Domingo = 6
    const semanaMonday = addCalendarDays(today, -dayOfWeek);
    const semanaSunday = addCalendarDays(semanaMonday, 6);
    const semanaStart = semanaMonday;
    const semanaEnd = semanaSunday;
    const semanaPrevStart = addCalendarDays(semanaMonday, -7);
    const semanaPrevEnd = addCalendarDays(semanaMonday, -1);

    // 4. Este mes (dinámico con nombre del mes y año)
    const monthName = MONTH_NAMES[currentMonth - 1];
    const esteMesStart = `${currentYear}-${String(currentMonth).padStart(2, "0")}-01`;
    const lastDayCurrentMonth = new Date(currentYear, currentMonth, 0).getDate();
    const esteMesEnd = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(lastDayCurrentMonth).padStart(2, "0")}`;

    const prevMonthNum = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const lastDayPrevMonth = new Date(prevMonthYear, prevMonthNum, 0).getDate();
    const esteMesPrevStart = `${prevMonthYear}-${String(prevMonthNum).padStart(2, "0")}-01`;
    const esteMesPrevEnd = `${prevMonthYear}-${String(prevMonthNum).padStart(2, "0")}-${String(lastDayPrevMonth).padStart(2, "0")}`;

    // 5. Este año (dinámico con año)
    const esteAnioStart = `${currentYear}-01-01`;
    const esteAnioEnd = `${currentYear}-12-31`;
    const esteAnioPrevStart = `${currentYear - 1}-01-01`;
    const esteAnioPrevEnd = `${currentYear - 1}-12-31`;

    // 6. Últimos 7 días
    const u7Start = addCalendarDays(today, -6);
    const u7End = today;
    const u7PrevStart = addCalendarDays(today, -13);
    const u7PrevEnd = addCalendarDays(today, -7);

    // 7. Últimos 14 días
    const u14Start = addCalendarDays(today, -13);
    const u14End = today;
    const u14PrevStart = addCalendarDays(today, -27);
    const u14PrevEnd = addCalendarDays(today, -14);

    // 8. Últimos 30 días
    const u30Start = addCalendarDays(today, -29);
    const u30End = today;
    const u30PrevStart = addCalendarDays(today, -59);
    const u30PrevEnd = addCalendarDays(today, -30);

    // 9. Mes anterior (dinámico)
    const prevMonthName = MONTH_NAMES[prevMonthNum - 1];
    const mesAnteriorStart = esteMesPrevStart;
    const mesAnteriorEnd = esteMesPrevEnd;

    const prev2MonthNum = prevMonthNum === 1 ? 12 : prevMonthNum - 1;
    const prev2MonthYear = prevMonthNum === 1 ? prevMonthYear - 1 : prevMonthYear;
    const lastDayPrev2Month = new Date(prev2MonthYear, prev2MonthNum, 0).getDate();
    const mesAnteriorPrevStart = `${prev2MonthYear}-${String(prev2MonthNum).padStart(2, "0")}-01`;
    const mesAnteriorPrevEnd = `${prev2MonthYear}-${String(prev2MonthNum).padStart(2, "0")}-${String(lastDayPrev2Month).padStart(2, "0")}`;

    // 10. Año anterior (dinámico)
    const anioAnteriorYear = currentYear - 1;
    const anioAnteriorStart = `${anioAnteriorYear}-01-01`;
    const anioAnteriorEnd = `${anioAnteriorYear}-12-31`;
    const anioAnteriorPrevStart = `${anioAnteriorYear - 1}-01-01`;
    const anioAnteriorPrevEnd = `${anioAnteriorYear - 1}-12-31`;

    // 11. Fecha específica (personalizada)
    const customStart = customStartDate || today;
    const customEnd = customEndDate || today;
    const customStartDateObj = new Date(customStart);
    const customEndDateObj = new Date(customEnd);
    const customDiffDays = Math.max(
      1,
      Math.round((customEndDateObj.getTime() - customStartDateObj.getTime()) / (1000 * 60 * 60 * 24)) + 1,
    );
    const customPrevEnd = addCalendarDays(customStart, -1);
    const customPrevStart = addCalendarDays(customPrevEnd, -(customDiffDays - 1));

    return {
      HOY: {
        label: "Hoy",
        start: hoyStart,
        end: hoyEnd,
        prevStart: hoyPrevStart,
        prevEnd: hoyPrevEnd,
        prevLabel: "ayer",
        isYearly: false,
      },
      AYER: {
        label: "Ayer",
        start: ayerStart,
        end: ayerEnd,
        prevStart: ayerPrevStart,
        prevEnd: ayerPrevEnd,
        prevLabel: "anteayer",
        isYearly: false,
      },
      ESTA_SEMANA: {
        label: "Esta semana",
        start: semanaStart,
        end: semanaEnd,
        prevStart: semanaPrevStart,
        prevEnd: semanaPrevEnd,
        prevLabel: "la semana anterior",
        isYearly: false,
      },
      ESTE_MES: {
        label: `Este mes (${monthName} ${currentYear})`,
        start: esteMesStart,
        end: esteMesEnd,
        prevStart: esteMesPrevStart,
        prevEnd: esteMesPrevEnd,
        prevLabel: "el mes anterior",
        isYearly: false,
      },
      ESTE_ANIO: {
        label: `Este año (${currentYear})`,
        start: esteAnioStart,
        end: esteAnioEnd,
        prevStart: esteAnioPrevStart,
        prevEnd: esteAnioPrevEnd,
        prevLabel: "el año anterior",
        isYearly: true,
        year: currentYear,
      },
      ULTIMOS_7: {
        label: "Últimos 7 días",
        start: u7Start,
        end: u7End,
        prevStart: u7PrevStart,
        prevEnd: u7PrevEnd,
        prevLabel: "los 7 días anteriores",
        isYearly: false,
      },
      ULTIMOS_14: {
        label: "Últimos 14 días",
        start: u14Start,
        end: u14End,
        prevStart: u14PrevStart,
        prevEnd: u14PrevEnd,
        prevLabel: "los 14 días anteriores",
        isYearly: false,
      },
      ULTIMOS_30: {
        label: "Últimos 30 días",
        start: u30Start,
        end: u30End,
        prevStart: u30PrevStart,
        prevEnd: u30PrevEnd,
        prevLabel: "los 30 días anteriores",
        isYearly: false,
      },
      MES_ANTERIOR: {
        label: `Mes anterior (${prevMonthName} ${prevMonthYear})`,
        start: mesAnteriorStart,
        end: mesAnteriorEnd,
        prevStart: mesAnteriorPrevStart,
        prevEnd: mesAnteriorPrevEnd,
        prevLabel: "el mes previo",
        isYearly: false,
      },
      ANIO_ANTERIOR: {
        label: `Año anterior (${anioAnteriorYear})`,
        start: anioAnteriorStart,
        end: anioAnteriorEnd,
        prevStart: anioAnteriorPrevStart,
        prevEnd: anioAnteriorPrevEnd,
        prevLabel: "el año anterior a ese",
        isYearly: true,
        year: anioAnteriorYear,
      },
      CUSTOM: {
        label: "Fecha específica",
        start: customStart,
        end: customEnd,
        prevStart: customPrevStart,
        prevEnd: customPrevEnd,
        prevLabel: "el período anterior",
        isYearly: false,
      },
    };
  }, [today, currentYear, currentMonth, currentDay, customStartDate, customEndDate]);

  const activeRange = periodConfig[period];
  const start = activeRange.start;
  const end = activeRange.end;
  const previousStart = activeRange.prevStart;
  const previousEnd = activeRange.prevEnd;

  // Filter payments and appointments consistently across all metrics
  const allPayments = scopeV2(data.payments, staff.profile.role, staff.profile.barber_id, data.barberId);
  const payments = isInvalidRange ? [] : allPayments.filter((p) => p.paymentDate >= start && p.paymentDate <= end);
  const previous = isInvalidRange ? [] : allPayments.filter((p) => p.paymentDate >= previousStart && p.paymentDate <= previousEnd);

  const appointments = isInvalidRange
    ? []
    : scopeV2(
        data.appointments,
        staff.profile.role,
        staff.profile.barber_id,
        data.barberId,
      ).filter((a) => a.date >= start && a.date <= end);

  const summary = paymentSummary(payments);
  const comparison = changePercent(summary.count, previous.length);

  // Generate chart points (daily for ranges up to 31 days; monthly for yearly views)
  const points = useMemo(() => {
    if (isInvalidRange) return [];
    if (activeRange.isYearly && activeRange.year) {
      const targetY = activeRange.year;
      return Array.from({ length: 12 }, (_, m) => {
        const ym = `${targetY}-${String(m + 1).padStart(2, "0")}`;
        const count = payments.filter((p) => p.paymentDate.startsWith(ym)).length;
        return { date: ym, label: MONTH_SHORT[m], count };
      });
    }

    // Daily breakdown between start and end (inclusive)
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const diffDays = Math.min(31, Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1);

    return Array.from({ length: diffDays }, (_, i) => {
      const d = addCalendarDays(start, i);
      return {
        date: d,
        label: d === today ? "Hoy" : d.slice(8),
        count: payments.filter((p) => p.paymentDate === d).length,
      };
    });
  }, [activeRange, start, end, payments, today, isInvalidRange]);

  const maxCount = Math.max(1, ...points.map((p) => p.count));

  const byService = useMemo(() => {
    return [...new Set(payments.map((p) => p.serviceName))]
      .map((name) => ({ name, count: payments.filter((p) => p.serviceName === name).length }))
      .sort((a, b) => b.count - a.count);
  }, [payments]);

  const byMethod = useMemo(() => {
    return ["Efectivo", "Transferencia"].map((name) => ({
      name,
      amount: payments
        .filter((p) => p.paymentMethod === name)
        .reduce((sum, p) => sum + p.collectedAmountArs, 0),
    }));
  }, [payments]);

  return (
    <main className="v2-page">
      <div className="v2-filters">
        <label className="v2-field">
          Período
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as InsightsPeriodKey)}
          >
            <option value="HOY">{periodConfig.HOY.label}</option>
            <option value="AYER">{periodConfig.AYER.label}</option>
            <option value="ESTA_SEMANA">{periodConfig.ESTA_SEMANA.label}</option>
            <option value="ESTE_MES">{periodConfig.ESTE_MES.label}</option>
            <option value="ESTE_ANIO">{periodConfig.ESTE_ANIO.label}</option>
            <option value="ULTIMOS_7">{periodConfig.ULTIMOS_7.label}</option>
            <option value="ULTIMOS_14">{periodConfig.ULTIMOS_14.label}</option>
            <option value="ULTIMOS_30">{periodConfig.ULTIMOS_30.label}</option>
            <option value="MES_ANTERIOR">{periodConfig.MES_ANTERIOR.label}</option>
            <option value="ANIO_ANTERIOR">{periodConfig.ANIO_ANTERIOR.label}</option>
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
        <p className="v2-notice" style={{ color: "var(--destructive, #ef4444)", margin: "8px 0" }}>
          Rango no válido: Fecha desde debe ser menor o igual a Fecha hasta.
        </p>
      )}

      <p className="v2-footnote">
        {start} al {end} · Métricas consolidadas en tiempo real (zona horaria America/Argentina/Buenos_Aires).
      </p>

      <div className="v2-metrics v2-metrics-four">
        <Metric
          label="Servicios registrados"
          value={summary.count}
          note={
            comparison === null
              ? "Sin base anterior para comparar"
              : `${comparison > 0 ? "+" : ""}${comparison}% frente a ${activeRange.prevLabel}`
          }
        />
        <Metric
          label="Cobrado en el local"
          value={money(summary.collected)}
          note="Cobros presenciales efectivos"
        />
        <Metric
          label="Valor de servicios"
          value={money(summary.value)}
          note="Valor nominal de los servicios"
        />
        <Metric
          label="Cancelaciones"
          value={appointments.filter((a) => a.statusCode === "CANCELLED").length}
          note={`${appointments.length} turnos registrados`}
        />
      </div>

      <div className="v2-chart-grid">
        <section className="v2-panel">
          <div className="v2-section-title">
            <h2>Ritmo de servicios</h2>
            <TrendingUp size={20} />
          </div>
          <p className="v2-muted">Cobros registrados en el período</p>
          {!payments.length ? (
            <Empty>No hay servicios registrados en este período.</Empty>
          ) : (
            <div
              className="v2-bar-chart"
              role="img"
              aria-label={`Servicios por día: ${points.map((p) => `${p.date}: ${p.count}`).join(", ")}`}
            >
              {points.map((p) => (
                <div key={p.date} title={`${p.date}: ${p.count} servicios`}>
                  <span>{p.count || ""}</span>
                  <i style={{ height: `${(p.count / maxCount) * 140 + 2}px` }} />
                  <small>{p.label}</small>
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
                  {s.count} · {summary.count > 0 ? Math.round((s.count / summary.count) * 100) : 0}%
                </strong>
              </div>
              <div className="v2-track">
                <i
                  style={{
                    width: `${summary.count > 0 ? (s.count / summary.count) * 100 : 0}%`,
                  }}
                />
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
                ? `Registraste ${summary.count} servicios frente a ${previous.length} en ${activeRange.prevLabel}.`
                : "Un registro continuo te permite anticipar demanda y organizar turnos."}
            </p>
          </article>
          <article>
            <span>02 / OPORTUNIDAD</span>
            <h3>Buscá tus próximos espacios</h3>
            <p>
              Consultá Horarios para planificar franjas adicionales o promociones en momentos de menor afluencia.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
