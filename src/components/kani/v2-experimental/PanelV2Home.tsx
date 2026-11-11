import { Link } from "@tanstack/react-router";
import { ArrowRight, Briefcase, CalendarDays, ChartNoAxesCombined } from "lucide-react";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { mayAccessStaffSection } from "@/lib/kani-permissions";

/**
 * Pantalla de entrada /panel-v2: presenta de manera directa los dos espacios
 * (Operación y Negocio) sin duplicar el dashboard histórico de V1/original.
 */
export function PanelV2Home() {
  const { profile } = useAdminStaff();
  const canViewDiscounts = mayAccessStaffSection(profile, "descuentos");
  const canViewStats = mayAccessStaffSection(profile, "datos");

  return (
    <main className="kani-panel-v2-home">
      <div className="kani-panel-v2-home-header">
        <p className="kani-panel-v2-home-kicker">Panel V2 · Arquitectura 3 + 3</p>
        <h1 className="kani-panel-v2-home-title">Elegí el espacio de trabajo</h1>
      </div>

      <div className="kani-panel-v2-home-grid">
        <Link to="/panel-v2/operacion/turnos" className="kani-panel-v2-space-card">
          <div>
            <div className="kani-panel-v2-space-card-top">
              <span className="kani-panel-v2-space-icon" aria-hidden="true">
                <CalendarDays size={20} />
              </span>
              <span className="kani-panel-v2-space-cta">
                Entrar <ArrowRight size={15} aria-hidden="true" />
              </span>
            </div>
            <h2>Operación</h2>
            <p>Gestión diaria del salón.</p>
          </div>
          <div className="kani-panel-v2-space-pills" aria-label="Módulos de Operación">
            <span>Turnos</span>
            <span>Horarios</span>
            <span>Clientes</span>
          </div>
        </Link>

        <Link to="/panel-v2/negocio/pagos" className="kani-panel-v2-space-card">
          <div>
            <div className="kani-panel-v2-space-card-top">
              <span className="kani-panel-v2-space-icon" aria-hidden="true">
                <Briefcase size={20} />
              </span>
              <span className="kani-panel-v2-space-cta">
                Entrar <ArrowRight size={15} aria-hidden="true" />
              </span>
            </div>
            <h2>Negocio</h2>
            <p>Cobros, membresías y promociones.</p>
          </div>
          <div className="kani-panel-v2-space-pills" aria-label="Módulos de Negocio">
            <span>Pagos</span>
            <span>Membresías</span>
            {canViewDiscounts && <span>Descuentos</span>}
          </div>
        </Link>
      </div>

      {canViewStats && (
        <div className="kani-panel-v2-home-tools">
          <div className="kani-panel-v2-home-tools-copy">
            <ChartNoAxesCombined size={18} aria-hidden="true" />
            <div>
              <strong>Estadísticas</strong> — Métricas históricas y comparativas independientes.
            </div>
          </div>
          <Link to="/panel-v2/estadisticas" className="v2-secondary" style={{ textDecoration: "none" }}>
            Abrir estadísticas
          </Link>
        </div>
      )}
    </main>
  );
}
