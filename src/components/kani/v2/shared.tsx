import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { useV2 } from "./data";
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="v2-page-title">
      <div>
        <p className="v2-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
export function BarberFilter() {
  const staff = useAdminStaff();
  const { barberId, setBarberId } = useV2();
  return (
    <label className="v2-field">
      Barbero
      <select
        value={staff.profile.role === "ADMIN" ? barberId : (staff.profile.barber_id ?? "")}
        onChange={(e) => setBarberId(e.target.value)}
        disabled={staff.profile.role !== "ADMIN"}
      >
        {staff.profile.role === "ADMIN" && <option value="ALL">Todo Kani</option>}
        {staff.barbers.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <article className="v2-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </article>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="v2-empty">{children}</div>;
}
export const statusLabels: Record<string, string> = {
  PENDING: "Pendiente de pago",
  CONFIRMED: "Confirmado",
  COMPLETED: "Realizado",
  CANCELLED: "Cancelado",
  NO_SHOW: "No asistió",
};
export function Status({ code }: { code: string }) {
  return (
    <span className={`v2-badge v2-status-${code.toLowerCase()}`}>{statusLabels[code] ?? code}</span>
  );
}

export function AdminV2FiltersPanel({
  ariaLabel,
  children,
  customRange,
  className,
}: {
  ariaLabel: string;
  children: ReactNode;
  customRange?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`v2-filters v2-admin-filter-card ${className ?? ""}`.trim()} aria-label={ariaLabel}>
      <div className="v2-filters-grid">{children}</div>
      {customRange}
    </section>
  );
}

export function AdminV2FilterField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`v2-field ${className ?? ""}`.trim()}>
      <label htmlFor={htmlFor} className="v2-field-label">
        {label}
      </label>
      {children}
    </div>
  );
}

export function AdminV2SectionToolbar({
  dateLabel,
  actionLabel,
  onAction,
  actionAriaLabel,
  className,
}: {
  dateLabel: string;
  actionLabel: string;
  onAction: () => void;
  actionAriaLabel?: string;
  className?: string;
}) {
  const cleanLabel = actionLabel.replace(/^\+\s*/, "");
  return (
    <div className={`v2-section-toolbar ${className ?? ""}`.trim()}>
      <h2 className="v2-toolbar-date">{dateLabel}</h2>
      <button
        type="button"
        className="v2-primary v2-toolbar-action v2-add-manual-btn"
        onClick={onAction}
        aria-label={actionAriaLabel ?? actionLabel}
      >
        <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
        <span>{cleanLabel}</span>
      </button>
    </div>
  );
}
