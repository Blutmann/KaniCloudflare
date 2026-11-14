import { Link } from "@tanstack/react-router";
import { ArrowRight, Briefcase, CalendarDays, ChartNoAxesCombined } from "lucide-react";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { mayAccessStaffSection } from "@/lib/kani-permissions";

/**
 * Pantalla de entrada /panel-v2: selector directo para Operación y Negocio
 * con diseño limpio y acceso discreto a Estadísticas.
 */
export function PanelV2Home({ basePath = "/panel-v2" }: { basePath?: string } = {}) {
  const cleanBase = basePath.replace(/\/+$/, "");
  const { profile } = useAdminStaff();
  const canViewDiscounts = mayAccessStaffSection(profile, "descuentos");
  const canViewStats = mayAccessStaffSection(profile, "datos");

  return (
    <main className="kani-panel-v2-home">
      <div className="kani-panel-v2-home-header">
        <h1 className="kani-panel-v2-home-title">Panel de administración</h1>
        <p className="kani-panel-v2-home-copy">Elegí qué querés gestionar.</p>
      </div>

      <div className="kani-panel-v2-home-grid">
        <Link to={`${cleanBase}/operacion/turnos`} className="kani-panel-v2-space-card">
          <div className="kani-panel-v2-space-card-body">
            <span className="kani-panel-v2-space-icon" aria-hidden="true">
              <CalendarDays size={22} strokeWidth={1.85} />
            </span>
            <div className="kani-panel-v2-space-text">
              <h2>Operación</h2>
              <p className="kani-panel-v2-space-desc">Gestión diaria del salón</p>
              <p className="kani-panel-v2-space-modules">Turnos · Horarios · Clientes</p>
            </div>
          </div>
          <span className="kani-panel-v2-space-cta">
            <span>Ingresar a Operación</span>
            <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
          </span>
        </Link>

        <Link to={`${cleanBase}/negocio/pagos`} className="kani-panel-v2-space-card">
          <div className="kani-panel-v2-space-card-body">
            <span className="kani-panel-v2-space-icon" aria-hidden="true">
              <Briefcase size={22} strokeWidth={1.85} />
            </span>
            <div className="kani-panel-v2-space-text">
              <h2>Negocio</h2>
              <p className="kani-panel-v2-space-desc">Administración del negocio</p>
              <p className="kani-panel-v2-space-modules">
                {canViewDiscounts
                  ? "Pagos · Membresías · Descuentos"
                  : "Pagos · Membresías"}
              </p>
            </div>
          </div>
          <span className="kani-panel-v2-space-cta">
            <span>Ingresar a Negocio</span>
            <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
          </span>
        </Link>
      </div>

      {canViewStats && (
        <div className="kani-panel-v2-home-footer">
          <Link to={`${cleanBase}/estadisticas`} className="kani-panel-v2-home-stats-link">
            <ChartNoAxesCombined size={15} strokeWidth={1.85} aria-hidden="true" />
            <span>Estadísticas</span>
          </Link>
        </div>
      )}
    </main>
  );
}
