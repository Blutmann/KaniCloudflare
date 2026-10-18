import { BarChart3, CalendarDays, Clock3, RefreshCw } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAdminStaff } from "@/lib/kani-admin-context";

const items = [
  { to: "/admin" as const, label: "Turnos", icon: CalendarDays },
  { to: "/admin/horarios" as const, label: "Horarios", icon: Clock3 },
  { to: "/admin/estadisticas" as const, label: "Estadísticas", icon: BarChart3 },
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
                ? pathname === "/admin" || pathname === "/admin/"
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
        <div className="admin-section-nav-divider md:hidden" aria-hidden="true" />
        <button
          type="button"
          onClick={() => triggerRefresh()}
          disabled={isRefreshing}
          className="admin-section-nav-refresh-btn md:hidden"
          aria-label="Actualizar datos"
          title="Actualizar datos"
        >
          <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
        </button>
      </nav>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => triggerRefresh()}
        disabled={isRefreshing}
        className="admin-section-nav-refresh hidden md:inline-flex text-xs h-10 px-3.5 gap-2 shrink-0"
        aria-label="Actualizar datos"
      >
        <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
        <span>Actualizar</span>
      </Button>
    </div>
  );
}

