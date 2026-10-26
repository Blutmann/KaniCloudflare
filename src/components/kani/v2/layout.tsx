import { useEffect, useState } from "react";
import { Link, Outlet } from "@tanstack/react-router";
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
import { AdminStaffProvider } from "@/lib/kani-admin-context";
import { getAuthenticatedStaff, type AuthenticatedStaff } from "@/lib/kani-auth";
import { supabase } from "@/integrations/supabase/client";
import { isV2Preview } from "@/lib/kani-v2";
import { V2DataProvider, useV2 } from "./data";
import "./v2.css";

const sections = [
  { to: "/admin-v2/inicio", title: "Inicio", icon: Home },
  { to: "/admin-v2/turnos", title: "Turnos", icon: CalendarDays },
  { to: "/admin-v2/horarios", title: "Horarios", icon: Clock3 },
  { to: "/admin-v2/pagos", title: "Pagos", icon: CreditCard },
  { to: "/admin-v2/clientes", title: "Clientes", icon: Users },
  { to: "/admin-v2/datos", title: "Datos", icon: ChartNoAxesCombined },
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
    const preview = isV2Preview(supabaseUrl, window.location.hostname);
    setAllowed(preview);
    if (!preview) {
      setState({
        loading: false,
        staff: null,
        error: "Este panel no está disponible en este entorno.",
      });
      return;
    }
    let cancelled = false;
    async function refresh() {
      try {
        const staff = await getAuthenticatedStaff({ bypassCache: true });
        if (!cancelled) setState({ loading: false, staff, error: "" });
      } catch {
        if (!cancelled)
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
        <a href="/admin">Volver al panel actual</a>
      </main>
    );
  if (!allowed || !state.staff)
    return <AdminAccess onAuthenticated={() => window.location.reload()} />;
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
  return (
    <div className="site-container v2-shell">
      <header className="v2-navigation">
        <nav className="admin-section-nav v2-nav" aria-label="Administración">
          <div className="admin-section-nav-items">
            {sections.map(({ to, title, icon: Icon }) => (
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
        <Outlet />
      </div>
    </div>
  );
}
