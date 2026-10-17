import { BarChart3, CalendarDays, Clock3 } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";

const items = [
  { to: "/admin" as const, label: "Turnos", icon: CalendarDays },
  { to: "/admin/horarios" as const, label: "Horarios", icon: Clock3 },
  { to: "/admin/estadisticas" as const, label: "Estadísticas", icon: BarChart3 },
];

export function AdminSectionNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="admin-section-nav-wrapper">
      <nav className="admin-section-nav" aria-label="Secciones administrativas">
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
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
