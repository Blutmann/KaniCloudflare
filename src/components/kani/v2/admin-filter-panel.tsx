import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface AdminFilterLabelProps {
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function AdminFilterLabel({
  htmlFor,
  children,
  className,
}: AdminFilterLabelProps) {
  return (
    <label htmlFor={htmlFor} className={cn("v2-admin-filter-label", className)}>
      {children}
    </label>
  );
}

export interface AdminFilterControlProps {
  children: ReactNode;
  className?: string;
}

export function AdminFilterControl({
  children,
  className,
}: AdminFilterControlProps) {
  return (
    <div className={cn("v2-admin-filter-control", className)}>
      {children}
    </div>
  );
}

export interface AdminFilterCellProps {
  label?: string;
  htmlFor?: string;
  children?: ReactNode;
  className?: string;
  empty?: boolean;
}

export function AdminFilterCell({
  label,
  htmlFor,
  children,
  className,
  empty,
}: AdminFilterCellProps) {
  if (empty || (!label && !children)) {
    return (
      <div
        className={cn("v2-admin-filter-cell v2-admin-filter-cell-empty", className)}
        aria-hidden="true"
      />
    );
  }

  return (
    <div className={cn("v2-admin-filter-cell", className)}>
      {label && (
        <AdminFilterLabel htmlFor={htmlFor}>
          {label}
        </AdminFilterLabel>
      )}
      <AdminFilterControl>
        {children}
      </AdminFilterControl>
    </div>
  );
}

export interface AdminFilterPanelProps {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}

export function AdminFilterPanel({
  ariaLabel,
  children,
  className,
  footer,
}: AdminFilterPanelProps) {
  return (
    <section
      className={cn("v2-admin-filter-panel", className)}
      aria-label={ariaLabel}
    >
      <div className="v2-admin-filter-grid">
        {children}
      </div>
      {footer}
    </section>
  );
}
