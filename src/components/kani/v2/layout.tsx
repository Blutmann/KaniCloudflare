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
  ArrowUpRight,
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
    const preview = isV2Preview(
      import.meta.env["VITE_SUPABASE_URL"] ?? "",
      window.location.hostname,
    );
    setAllowed(preview);
    if (!preview) {
      setState({
        loading: false,
        staff: null,
        error: "El panel V2 está habilitado únicamente en el entorno de pruebas.",
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
        <h1>Administración V2</h1>
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
    <div className="v2-shell">
      <aside className="v2-sidebar">
        <div className="v2-brand">
          <span>KANI</span>
          <small>ESTUDIO / ADMIN V2</small>
        </div>
        <nav aria-label="Administración V2">
          {sections.map(({ to, title, icon: Icon }) => (
            <Link key={to} to={to} activeProps={{ className: "is-active", "aria-current": "page" }}>
              <Icon size={19} />
              <span>{title}</span>
            </Link>
          ))}
        </nav>
        <a className="v2-old" href="/admin">
          Panel actual <ArrowUpRight size={16} />
        </a>
      </aside>
      <div className="v2-workspace">
        <div className="v2-environment">
          <span>
            <i />
            ENTORNO DE PRUEBAS · V2
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Actualizar datos"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
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
