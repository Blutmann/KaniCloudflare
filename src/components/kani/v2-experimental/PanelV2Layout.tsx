import { useEffect, useState } from "react";
import { Outlet, useLocation } from "@tanstack/react-router";
import { AdminAccess } from "@/components/kani/admin-access";
import { supabase } from "@/integrations/supabase/client";
import { AdminStaffProvider, useAdminStaff } from "@/lib/kani-admin-context";
import { clearStaffCache, getAuthenticatedStaff, type AuthenticatedStaff } from "@/lib/kani-auth";
import { mayAccessStaffSection } from "@/lib/kani-permissions";
import { isV2AdminEnvironment } from "@/lib/kani-v2";
import { V2DataProvider, useV2 } from "@/components/kani/v2/data";
import "@/components/kani/v2/v2.css";
import "./panel-v2.css";
import { PanelV2Navigation, type PanelV2Space } from "./PanelV2Navigation";

const PANEL_V2_ROUTE_SECTION_MAP: Record<string, string> = {
  "": "inicio",
  "operacion": "turnos",
  "operacion/turnos": "turnos",
  "operacion/horarios": "horarios",
  "operacion/clientes": "clientes",
  "negocio": "pagos",
  "negocio/pagos": "pagos",
  "negocio/membresias": "membresias",
  "negocio/descuentos": "descuentos",
  "estadisticas": "datos",
};

export function resolvePanelV2Space(pathname: string): PanelV2Space {
  const clean = pathname.replace(/\/+$/, "");
  if (clean === "/panel-v2") return "inicio";
  if (clean === "/panel-v2/operacion" || clean.startsWith("/panel-v2/operacion/")) {
    return "operacion";
  }
  if (clean === "/panel-v2/negocio" || clean.startsWith("/panel-v2/negocio/")) {
    return "negocio";
  }
  if (clean === "/panel-v2/estadisticas") {
    return "estadisticas";
  }
  return "inicio";
}

export function resolvePanelV2Section(pathname: string): string {
  const clean = pathname.replace(/\/+$/, "");
  if (clean === "/panel-v2") return "inicio";
  const sub = clean.startsWith("/panel-v2/") ? clean.slice("/panel-v2/".length) : "";
  return PANEL_V2_ROUTE_SECTION_MAP[sub] ?? "unknown";
}

/**
 * Shell administrativo experimental de Panel V2 (arquitectura 3 + 3).
 * Reutiliza autenticación, permisos y V2DataProvider sin alterar V2Layout ni /panel-administracion/*.
 */
export function PanelV2Layout() {
  const location = useLocation({ select: (loc) => loc.pathname });
  const pathname = typeof location === "string" ? location : "/panel-v2";
  const returnTo = pathname.startsWith("/panel-v2") ? pathname : "/panel-v2";

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
    async function refreshStaff() {
      const revision = ++refreshRevision;
      try {
        const staff = await getAuthenticatedStaff({ bypassCache: true });
        if (!cancelled && revision === refreshRevision) {
          setState({ loading: false, staff, error: "" });
        }
      } catch {
        if (!cancelled && revision === refreshRevision) {
          setState({
            loading: false,
            staff: null,
            error: "No pudimos verificar el acceso. Recargá la página.",
          });
        }
      }
    }

    void refreshStaff();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      clearStaffCache();
      if (!cancelled) setState({ loading: true, staff: null, error: "" });
      window.setTimeout(() => {
        if (!cancelled) void refreshStaff();
      }, 0);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  if (state.loading) {
    return (
      <main className="v2-access" role="status">
        Verificando acceso…
      </main>
    );
  }
  if (state.error) {
    return (
      <main className="v2-access">
        <h1>Panel V2</h1>
        <p role="alert">{state.error}</p>
        <a href="/panel-administracion">Ir al panel de administración</a>
      </main>
    );
  }
  if (!allowed || !state.staff) {
    return (
      <AdminAccess
        onAuthenticated={() => {
          window.location.assign(returnTo);
        }}
      />
    );
  }

  return (
    <AdminStaffProvider key={state.staff.user.id} staff={state.staff}>
      <V2DataProvider>
        <PanelV2Shell />
      </V2DataProvider>
    </AdminStaffProvider>
  );
}

function PanelV2Shell() {
  const { loading, error, refresh } = useV2();
  const { profile } = useAdminStaff();
  const location = useLocation({ select: (loc) => loc.pathname });
  const pathname = typeof location === "string" ? location : "/panel-v2";

  const activeSpace = resolvePanelV2Space(pathname);
  const resolvedSection = resolvePanelV2Section(pathname);
  const allowedSection =
    resolvedSection === "inicio" || mayAccessStaffSection(profile, resolvedSection);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.body.dataset["adminInternal"] = "true";
      return () => {
        delete document.body.dataset["adminInternal"];
      };
    }
    return undefined;
  }, []);

  return (
    <div className="site-container v2-shell kani-panel-v2">
      <PanelV2Navigation
        activeSpace={activeSpace}
        loading={loading}
        onRefresh={() => void refresh()}
      />

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
        {allowedSection ? (
          <Outlet />
        ) : (
          <p role="alert" className="v2-alert">
            No tenés permisos para acceder a esta sección.
          </p>
        )}
      </div>
    </div>
  );
}
