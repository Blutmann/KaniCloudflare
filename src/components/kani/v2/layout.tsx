import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { MotionConfig, motion } from "motion/react";
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
import "@/components/kani/experimental/liquid-glass-admin.css";
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

  useEffect(() => {
    if (!liquidGlass || typeof document === "undefined") return;
    document.body.dataset.lgAdmin = "true";
    return () => {
      delete document.body.dataset.lgAdmin;
    };
  }, [liquidGlass]);
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
        <V2Shell basePath={basePath} liquidGlass={liquidGlass} />
      </V2DataProvider>
    </AdminStaffProvider>
  );
}

function V2Shell({ basePath, liquidGlass = false }: { basePath: string; liquidGlass?: boolean }) {
  const { loading, error, refresh } = useV2();
  const { profile } = useAdminStaff();
  const pathname = useLocation({ select: (location) => location.pathname });
  const cleanBase = basePath.replace(/\/+$/, "");
  const cleanPath = pathname.replace(/\/+$/, "");
  const rootSlug = cleanBase.split("/").filter(Boolean).at(-1) ?? "panel-administracion";
  const section = cleanPath.split("/").filter(Boolean).at(-1) ?? "inicio";
  const allowedSection = cleanPath === cleanBase || section === rootSlug || mayAccessStaffSection(profile, section);
  const activeSlug =
    cleanPath === cleanBase || section === rootSlug
      ? profile.role === "ADMIN"
        ? "inicio"
        : "turnos"
      : section;

  const navItemsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!liquidGlass || typeof window === "undefined") return;
    const container = navItemsRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>(`[data-nav-slug="${activeSlug}"]`);
    if (!activeEl || typeof activeEl.scrollIntoView !== "function") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    activeEl.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [liquidGlass, activeSlug]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.dataset.adminInternal = 'true';
      return () => {
        delete document.body.dataset.adminInternal;
      };
    }
  }, []);

  const navContent = (
    <nav className="admin-section-nav v2-nav" aria-label="Administración">
      <div className="admin-section-nav-items" ref={navItemsRef}>
        {sectionDefs
          .filter(({ slug }) => mayAccessStaffSection(profile, slug) && (profile.role === 'ADMIN' || slug !== 'inicio'))
          .map(({ slug, title, icon: Icon }) => {
            const isActive = activeSlug === slug;
            return (
              <Link
                key={slug}
                to={`${cleanBase}/${slug}`}
                data-nav-slug={slug}
                className="admin-section-nav-link"
                activeProps={{ className: "is-active", "aria-current": "page" }}
              >
                {liquidGlass && isActive && (
                  <motion.span
                    layoutId="lg-admin-nav-pill"
                    className="lg-admin-nav-pill"
                    aria-hidden="true"
                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  />
                )}
                <Icon size={16} aria-hidden="true" className="lg-admin-nav-icon" />
                <span className="lg-admin-nav-label">{title}</span>
              </Link>
            );
          })}
      </div>
      {!liquidGlass && (
        <>
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
        </>
      )}
    </nav>
  );

  const outletContent = allowedSection ? (
    <Outlet />
  ) : (
    <p role="alert" className="v2-alert">
      No tenés permisos para acceder a esta sección.
    </p>
  );

  return (
    <div
      className={`site-container v2-shell ${liquidGlass ? "lg-admin-shell" : ""}`.trim()}
      data-lg-admin={liquidGlass ? "true" : undefined}
    >
      <header className="v2-navigation">
        {liquidGlass ? <MotionConfig reducedMotion="user">{navContent}</MotionConfig> : navContent}
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
        {liquidGlass ? (
          <MotionConfig reducedMotion="user">
            <motion.div
              key={activeSlug}
              className="lg-admin-section-stage"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {outletContent}
            </motion.div>
          </MotionConfig>
        ) : (
          outletContent
        )}
      </div>
    </div>
  );
}
