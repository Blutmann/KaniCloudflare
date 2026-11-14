import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import {
  CalendarDays,
  Clock3,
  CreditCard,
  Home,
  Users,
  ChartNoAxesCombined,
  RefreshCw,
} from "lucide-react";
import { AdminAccess } from "@/components/kani/admin-access";
import { AdminStaffProvider, useAdminStaff } from "@/lib/kani-admin-context";
import { mayAccessStaffSection } from "@/lib/kani-permissions";
import { clearStaffCache, getAuthenticatedStaff, type AuthenticatedStaff } from "@/lib/kani-auth";
import { supabase } from "@/integrations/supabase/client";
import { isV2AdminEnvironment } from "@/lib/kani-v2";
import { LiquidGlassShell } from "@/components/kani/experimental/liquid-glass-shell";
import { V2DataProvider, useV2 } from "./data";
import "./v2.css";

const sectionDefs = [
  { slug: "inicio", title: "Inicio", icon: Home },
  { slug: "turnos", title: "Turnos", icon: CalendarDays },
  { slug: "horarios", title: "Horarios", icon: Clock3 },
  { slug: "pagos", title: "Pagos", icon: CreditCard },
  { slug: "clientes", title: "Clientes", icon: Users },
  { slug: "datos", title: "Datos", icon: ChartNoAxesCombined },
] as const;

export function V2Layout({
  basePath = "/panel-administracion",
  liquidGlass = false,
}: {
  basePath?: string;
  liquidGlass?: boolean;
} = {}) {
  const wrap = (node: JSX.Element) =>
    liquidGlass ? <LiquidGlassShell section="admin">{node}</LiquidGlassShell> : node;
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
    return wrap(
      <main className="v2-access" role="status">
        Verificando acceso…
      </main>
    );
  if (state.error)
    return wrap(
      <main className="v2-access">
        <h1>Administración</h1>
        <p role="alert">{state.error}</p>
        <a href={basePath}>Volver al panel actual</a>
      </main>
    );
  if (!allowed || !state.staff)
    return wrap(
      <AdminAccess
        onAuthenticated={() => {
          window.location.assign(basePath);
        }}
      />
    );
  return wrap(
    <AdminStaffProvider key={state.staff.user.id} staff={state.staff}>
      <V2DataProvider>
        <V2Shell basePath={basePath} />
      </V2DataProvider>
    </AdminStaffProvider>
  );
}

function V2Shell({ basePath }: { basePath: string }) {
  const { loading, error, refresh } = useV2();
  const { profile } = useAdminStaff();
  const pathname = useLocation({ select: (location) => location.pathname });
  const cleanBase = basePath.replace(/\/+$/, "");
  const cleanPath = pathname.replace(/\/+$/, "");
  const rootSlug = cleanBase.split("/").filter(Boolean).at(-1) ?? "panel-administracion";
  const section = cleanPath.split("/").filter(Boolean).at(-1) ?? "inicio";
  const allowedSection = cleanPath === cleanBase || section === rootSlug || mayAccessStaffSection(profile, section);

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
          <div className="admin-section-nav-items">
            {sectionDefs
              .filter(({ slug }) => mayAccessStaffSection(profile, slug) && (profile.role === 'ADMIN' || slug !== 'inicio'))
              .map(({ slug, title, icon: Icon }) => (
              <Link
                key={slug}
                to={`${cleanBase}/${slug}`}
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
