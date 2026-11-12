import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  ChartNoAxesCombined,
  Clock3,
  CreditCard,
  LayoutGrid,
  PackageCheck,
  RefreshCw,
  Tag,
  Users,
} from "lucide-react";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { mayAccessStaffSection } from "@/lib/kani-permissions";

export type PanelV2Space = "inicio" | "operacion" | "negocio" | "estadisticas";

const OPERACION_ITEMS = [
  { to: "/panel-v2/operacion/turnos", title: "Turnos", section: "turnos", icon: CalendarDays },
  { to: "/panel-v2/operacion/horarios", title: "Horarios", section: "horarios", icon: Clock3 },
  { to: "/panel-v2/operacion/clientes", title: "Clientes", section: "clientes", icon: Users },
] as const;

const NEGOCIO_ITEMS = [
  { to: "/panel-v2/negocio/pagos", title: "Pagos", section: "pagos", icon: CreditCard },
  { to: "/panel-v2/negocio/membresias", title: "Membresías", section: "membresias", icon: PackageCheck },
  { to: "/panel-v2/negocio/descuentos", title: "Descuentos", section: "descuentos", icon: Tag },
] as const;

export function PanelV2Navigation({
  activeSpace,
  loading,
  onRefresh,
}: {
  activeSpace: PanelV2Space;
  loading: boolean;
  onRefresh: () => void;
}) {
  const { profile } = useAdminStaff();
  if (activeSpace === "inicio") return null;

  const rawItems =
    activeSpace === "negocio"
      ? NEGOCIO_ITEMS
      : activeSpace === "operacion"
        ? OPERACION_ITEMS
        : [];
  const visibleItems = rawItems.filter((item) => mayAccessStaffSection(profile, item.section));
  const canViewStats = mayAccessStaffSection(profile, "datos");
  const spaceTitle =
    activeSpace === "negocio"
      ? "Negocio"
      : activeSpace === "estadisticas"
        ? "Estadísticas"
        : "Operación";

  const navStyle = {
    "--panel-v2-tab-count": Math.max(1, visibleItems.length),
  } as CSSProperties;

  return (
    <header className="v2-navigation kani-panel-v2-header">
      <div className="kani-panel-v2-topbar" aria-label="Espacios de administración">
        <div className="kani-panel-v2-space-heading">
          <Link
            to="/panel-v2"
            className="kani-panel-v2-brand-pill"
            aria-label="Inicio del panel"
            title="Inicio del panel"
          >
            <LayoutGrid size={13} aria-hidden="true" />
            <span>Inicio</span>
          </Link>
          <span className="kani-panel-v2-space-sep" aria-hidden="true">/</span>
          <span className="kani-panel-v2-space-name">{spaceTitle}</span>
        </div>

        <div className="kani-panel-v2-switcher-group">
          <div className="kani-panel-v2-space-switch" role="group" aria-label="Cambiar de espacio">
            <Link
              to="/panel-v2/operacion/turnos"
              className={`kani-panel-v2-space-option${activeSpace === "operacion" ? " is-selected" : ""}`}
              aria-current={activeSpace === "operacion" ? "true" : undefined}
            >
              Operación
            </Link>
            <Link
              to="/panel-v2/negocio/pagos"
              className={`kani-panel-v2-space-option${activeSpace === "negocio" ? " is-selected" : ""}`}
              aria-current={activeSpace === "negocio" ? "true" : undefined}
            >
              Negocio
            </Link>
          </div>

          {canViewStats && (
            <Link
              to="/panel-v2/estadisticas"
              className={`kani-panel-v2-stats-link${activeSpace === "estadisticas" ? " is-selected" : ""}`}
              aria-label="Estadísticas"
              title="Estadísticas"
              aria-current={activeSpace === "estadisticas" ? "page" : undefined}
            >
              <ChartNoAxesCombined size={14} aria-hidden="true" />
              <span>Estadísticas</span>
            </Link>
          )}

          {activeSpace === "estadisticas" && (
            <button
              type="button"
              className="admin-section-nav-refresh-btn kani-panel-v2-compact-refresh"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Actualizar datos"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
          )}
        </div>
      </div>

      {visibleItems.length > 0 && (
        <nav
          className="admin-section-nav v2-nav kani-panel-v2-nav"
          aria-label={`Navegación de ${spaceTitle}`}
          data-panel-space={activeSpace}
          style={navStyle}
        >
          <div className="admin-section-nav-items kani-panel-v2-nav-items">
            {visibleItems.map(({ to, title, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="admin-section-nav-link"
                activeProps={{ className: "is-active", "aria-current": "page" }}
              >
                <Icon size={15} strokeWidth={1.85} aria-hidden="true" />
                <span>{title}</span>
              </Link>
            ))}
          </div>
          <div className="admin-section-nav-divider" aria-hidden="true" />
          <button
            type="button"
            className="admin-section-nav-refresh-btn"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Actualizar datos"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </nav>
      )}
    </header>
  );
}
