import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import {
  CalendarDays,
  Clock3,
  CreditCard,
  Users,
  ChartNoAxesCombined,
  RefreshCw,
  House,
} from "lucide-react";
import { AdminAccess } from "@/components/kani/admin-access";
import { AdminStaffProvider, useAdminStaff } from "@/lib/kani-admin-context";
import { mayAccessStaffSection } from "@/lib/kani-permissions";
import { clearStaffCache, getAuthenticatedStaff, type AuthenticatedStaff } from "@/lib/kani-auth";
import { supabase } from "@/integrations/supabase/client";
import { isV2AdminEnvironment } from "@/lib/kani-v2";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { V2DataProvider, useV2 } from "./data";
import "./v2.css";

const sections = [
  { to: "/panel-administracion/turnos", title: "Turnos", icon: CalendarDays },
  { to: "/panel-administracion/horarios", title: "Horarios", icon: Clock3 },
  { to: "/panel-administracion/pagos", title: "Pagos", icon: CreditCard },
  { to: "/panel-administracion/clientes", title: "Clientes", icon: Users },
  { to: "/panel-administracion/datos", title: "Datos", icon: ChartNoAxesCombined },
] as const;

export function V2Layout() {
  const [state, setState] = useState<{
    loading: boolean;
    staff: AuthenticatedStaff | null;
    error: string;
  }>({ loading: true, staff: null, error: "" });
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const supabaseUrl =
      import.meta.env["VITE_SUPABASE_URL"] ||
      (supabase as any)?.supabaseUrl ||
      "";
    const adminEnvironment = isV2AdminEnvironment(supabaseUrl, window.location.hostname);
    setAllowed(adminEnvironment);
    if (!adminEnvironment) {
      setState({
        loading: false,
        staff: null,
        error: "Este panel no está disponible en este entorno.",
      });
      return;
    }
    let cancelled = false;
    let refreshRevision = 0;
    async function refresh() {
      const revision = ++refreshRevision;
      try {
        const staff = await getAuthenticatedStaff({ bypassCache: true });
        if (!cancelled && revision === refreshRevision) setState({ loading: false, staff, error: "" });
      } catch {
        if (!cancelled && revision === refreshRevision)
          setState({
            loading: false,
            staff: null,
            error: "No pudimos verificar el acceso. Recargá la página.",
          });
      }
    }
    void refresh();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      clearStaffCache();
      // Hide stale data immediately, including during account switching.
      if (!cancelled) setState({ loading: true, staff: null, error: "" });
      window.setTimeout(() => {
        if (!cancelled) void refresh();
      }, 0);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);
  if (state.loading)
    return (
      <main className="v2-access" role="status">
        Verificando acceso…
      </main>
    );
  if (state.error)
    return (
      <main className="v2-access">
        <h1>Administración</h1>
        <p role="alert">{state.error}</p>
        <a href="/panel-administracion">Volver al panel actual</a>
      </main>
    );
  if (!allowed || !state.staff)
    return (
      <AdminAccess
        onAuthenticated={() => {
          window.location.assign("/panel-administracion");
        }}
      />
    );
  return (
    <AdminStaffProvider key={state.staff.user.id} staff={state.staff}>
      <V2DataProvider>
        <V2Shell />
      </V2DataProvider>
    </AdminStaffProvider>
  );
}

function V2Shell() {
  const { loading, error, refresh } = useV2();
  const { profile } = useAdminStaff();
  const pathname = useLocation({ select: (location) => location.pathname });
  const section = pathname.split('/').filter(Boolean).at(-1) ?? 'inicio';
  const allowedSection = section === 'panel-administracion' || mayAccessStaffSection(profile, section);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.dataset.adminInternal = 'true';
      return () => {
        delete document.body.dataset.adminInternal;
      };
    }
  }, []);
  return (
    <div className="site-container v2-shell">
      <header className="v2-navigation">
        <nav className="admin-section-nav v2-nav" aria-label="Administración">
          {mayAccessStaffSection(profile, 'inicio') && (
            <TooltipProvider delayDuration={250}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/panel-administracion/inicio"
                    aria-label="Inicio"
                    className="admin-section-nav-link admin-section-nav-home-btn"
                    activeOptions={{ exact: true }}
                    activeProps={{ className: "is-active", "aria-current": "page" }}
                  >
                    <House size={16} aria-hidden="true" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="bottom">Inicio</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <div className="admin-section-nav-items">
            {sections.filter(({ to }) => mayAccessStaffSection(profile, to.split('/').at(-1)!)).map(({ to, title, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="admin-section-nav-link"
                activeProps={{ className: "is-active", "aria-current": "page" }}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{title}</span>
              </Link>
            ))}
          </div>
          <div className="admin-section-nav-divider" aria-hidden="true" />
          <button
            type="button"
            className="admin-section-nav-refresh-btn"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Actualizar datos"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </nav>
      </header>
      <div className="v2-workspace">
        {error && (
          <div role="alert" className="v2-alert">
            {error} <button onClick={() => void refresh()}>Reintentar</button>
          </div>
        )}
        {loading && (
          <p className="v2-loading" role="status">
            Actualizando información…
          </p>
        )}
        {allowedSection ? <Outlet /> : <p role="alert" className="v2-alert">No tenés permisos para acceder a esta sección.</p>}
      </div>
    </div>
  );
}
