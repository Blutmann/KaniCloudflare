import { BarChart3, CalendarDays, Clock3, DollarSign, RefreshCw } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useAdminStaff } from "@/lib/kani-admin-context";

const items = [
  { to: "/admin" as const, label: "Turnos", icon: CalendarDays },
  { to: "/admin/horarios" as const, label: "Horarios", icon: Clock3 },
  { to: "/admin/estadisticas" as const, label: "Datos", icon: BarChart3 },
  { to: "/admin/pagos" as const, label: "Pagos", icon: DollarSign },
];

export function AdminSectionNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { triggerRefresh, isRefreshing } = useAdminStaff();

  return (
    <div className="admin-section-nav-wrapper site-container">
      <nav className="admin-section-nav" aria-label="Secciones administrativas">
        <div className="admin-section-nav-items">
          {items.map(({ to, label, icon: Icon }) => {
            const active =
              to === "/admin"
                ? pathname === "/admin" || pathname === "/admin/" || pathname === "/admin/turnos"
                : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={`admin-section-nav-link ${active ? "is-active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
        <div className="admin-section-nav-divider" aria-hidden="true" />
        <button
          type="button"
          onClick={() => triggerRefresh()}
          disabled={isRefreshing}
          className="admin-section-nav-refresh-btn"
          aria-label="Actualizar datos"
          title="Actualizar datos"
        >
          <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
        </button>
      </nav>
    </div>
  );
}
