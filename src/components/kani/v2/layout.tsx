import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import {
  CalendarDays,
  Clock3,
  CreditCard,
  Home,
  IdCard,
  Tag,
  Users,
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
  { slug: "membresias", title: "Miembros", icon: IdCard },
  { slug: "descuentos", title: "Códigos", icon: Tag },
] as const;

const barberSectionDefs = [
  { slug: "turnos", title: "Turnos", icon: CalendarDays },
  { slug: "horarios", title: "Horarios", icon: Clock3 },
  { slug: "pagos", title: "Pagos", icon: CreditCard },
  { slug: "clientes", title: "Clientes", icon: Users },
] as const;

export function V2Layout({
  basePath = "/panel-administracion",
  liquidGlass = !basePath.includes("-old"),
  forcedSectionSlug,
  children,
}: {
  basePath?: string;
  liquidGlass?: boolean;
  forcedSectionSlug?: string;
  children?: ReactNode;
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

  // Evita que la restauración nativa o de router tras reload/carga asíncrona deje el scroll clavado ocultando el stepper bajo el header
  useEffect(() => {
    if (!liquidGlass || typeof window === "undefined" || typeof document === "undefined") return;

    const historyObj = window.history;
    const prevRestoration =
      "scrollRestoration" in historyObj ? historyObj.scrollRestoration : undefined;
    const navEntries =
      typeof window.performance?.getEntriesByType === "function"
        ? (window.performance.getEntriesByType("navigation") as PerformanceNavigationTiming[])
        : [];
    const isReload = navEntries[0]?.type === "reload";

    const resetTop = () => {
      if (typeof window.scrollTo === "function") {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      }
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    };

    if (isReload && !window.location.hash) {
      if ("scrollRestoration" in historyObj) {
        try {
          historyObj.scrollRestoration = "manual";
        } catch {
          // ignorar si el navegador restringe history.scrollRestoration
        }
      }
      resetTop();
      const rafId =
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame(resetTop)
          : 0;
      return () => {
        if (rafId && typeof window.cancelAnimationFrame === "function") {
          window.cancelAnimationFrame(rafId);
        }
        if ("scrollRestoration" in historyObj && prevRestoration) {
          try {
            historyObj.scrollRestoration = prevRestoration;
          } catch {
            // ignorar
          }
        }
      };
    }
    return undefined;
  }, [liquidGlass]);

  useEffect(() => {
    if (!liquidGlass || state.loading || typeof window === "undefined" || window.location.hash) return;
    const navEntries =
      typeof window.performance?.getEntriesByType === "function"
        ? (window.performance.getEntriesByType("navigation") as PerformanceNavigationTiming[])
        : [];
    if (navEntries[0]?.type !== "reload") return;

    const resetAfterAsyncHydration = () => {
      if (typeof window.scrollTo === "function") {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      }
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    };
    resetAfterAsyncHydration();
    const rafId =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(resetAfterAsyncHydration)
        : 0;
    return () => {
      if (rafId && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [liquidGlass, state.loading]);
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
    async function refresh(options?: { bypassCache?: boolean }) {
      const revision = ++refreshRevision;
      try {
        const staff = await getAuthenticatedStaff(
          options?.bypassCache ? { bypassCache: true } : undefined,
        );
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
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION") return;
      if (event === "SIGNED_OUT") {
        clearStaffCache();
        if (!cancelled) setState({ loading: false, staff: null, error: "" });
        return;
      }
      if (event === "TOKEN_REFRESHED") {
        void refresh({ bypassCache: true });
        return;
      }
      clearStaffCache();
      // Hide stale data immediately, including during account switching.
      if (!cancelled) setState({ loading: true, staff: null, error: "" });
      window.setTimeout(() => {
        if (!cancelled) void refresh({ bypassCache: true });
      }, 0);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);
  const shouldReduceMotion = useReducedMotion();

  if (state.loading)
    return wrap(
      <main className="v2-access v2-access-loading" role="status" aria-live="polite">
        <div className="v2-kani-loader">
          <div className="v2-kani-loader-emblem" aria-hidden="true">
            <motion.span
              className="v2-kani-loader-ring"
              animate={
                shouldReduceMotion
                  ? undefined
                  : {
                      scale: [1, 1.14, 1],
                      opacity: [0.55, 0.2, 0.55],
                    }
              }
              transition={
                shouldReduceMotion
                  ? undefined
                  : {
                      duration: 2.2,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }
              }
            />
            <motion.span
              className="v2-kani-loader-kanji"
              animate={
                shouldReduceMotion
                  ? undefined
                  : {
                      opacity: [0.82, 1, 0.82],
                      scale: [0.98, 1.02, 0.98],
                    }
              }
              transition={
                shouldReduceMotion
                  ? undefined
                  : {
                      duration: 2.2,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }
              }
            >
              蟹
            </motion.span>
          </div>
          <p className="v2-kani-loader-label">Verificando acceso…</p>
        </div>
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
  if (!allowed || !state.staff) {
    const pathname = typeof window !== "undefined" ? (window.location?.pathname ?? "") : "";
    const search = typeof window !== "undefined" ? (window.location?.search ?? "") : "";
    const returnTo =
      pathname.startsWith("/panel-") || pathname.startsWith("/admin")
        ? `${pathname}${search}`
        : basePath;
    return wrap(
      <AdminAccess
        onAuthenticated={() => {
          window.location.assign(returnTo);
        }}
      />
    );
  }
  return wrap(
    <AdminStaffProvider key={state.staff.user.id} staff={state.staff}>
      <V2DataProvider>
        <V2Shell
          basePath={basePath}
          liquidGlass={liquidGlass}
          forcedSectionSlug={forcedSectionSlug}
        >
          {children}
        </V2Shell>
      </V2DataProvider>
    </AdminStaffProvider>
  );
}

function V2Shell({
  basePath,
  liquidGlass = false,
  forcedSectionSlug,
  children,
}: {
  basePath: string;
  liquidGlass?: boolean;
  forcedSectionSlug?: string;
  children?: ReactNode;
}) {
  const { loading, error, refresh } = useV2();
  const { profile } = useAdminStaff();
  const pathname = useLocation({ select: (location) => location.pathname });
  const cleanBase = basePath.replace(/\/+$/, "");
  const cleanPath = pathname.replace(/\/+$/, "");
  const rootSlug = cleanBase.split("/").filter(Boolean).at(-1) ?? "panel-administracion";
  const rawSlug = cleanPath.split("/").filter(Boolean).at(-1) ?? "inicio";
  const standaloneSlug =
    rawSlug.startsWith("panel-") &&
    rawSlug !== "panel-administracion" &&
    rawSlug !== "panel-administracion-old"
      ? rawSlug.replace(/^panel-/, "")
      : rawSlug;
  const section = forcedSectionSlug || standaloneSlug;
  const isRootOfBase = !forcedSectionSlug && (cleanPath === cleanBase || section === rootSlug);
  const allowedSection = forcedSectionSlug
    ? mayAccessStaffSection(profile, forcedSectionSlug)
    : isRootOfBase || mayAccessStaffSection(profile, section);
  const activeSlug = isRootOfBase
    ? profile.role === "ADMIN"
      ? "inicio"
      : "turnos"
    : section;

  const navScrollRef = useRef<HTMLElement>(null);
  const navItemsRef = useRef<HTMLDivElement>(null);
  const [navCue, setNavCue] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  useEffect(() => {
    if (!liquidGlass || typeof window === "undefined") return;
    const navEl = navItemsRef.current ?? navScrollRef.current;
    if (!navEl) return;

    const updateCue = () => {
      const maxScroll = Math.max(0, navEl.scrollWidth - navEl.clientWidth);
      setNavCue({
        left: navEl.scrollLeft > 4,
        right: maxScroll > 4 && navEl.scrollLeft < maxScroll - 4,
      });
    };

    const activeEl = navEl.querySelector<HTMLElement>(`[data-nav-slug="${activeSlug}"]`);
    if (activeEl && navEl.scrollWidth > navEl.clientWidth + 2) {
      const maxScroll = navEl.scrollWidth - navEl.clientWidth;
      const desiredLeft = activeEl.offsetLeft - (navEl.clientWidth - activeEl.offsetWidth) / 2;
      const targetLeft = Math.max(0, Math.min(maxScroll, desiredLeft));
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      if (typeof navEl.scrollTo === "function") {
        navEl.scrollTo({ left: targetLeft, behavior: reduced ? "auto" : "smooth" });
      } else if (typeof activeEl.scrollIntoView === "function") {
        activeEl.scrollIntoView({
          inline: "center",
          block: "nearest",
          behavior: reduced ? "auto" : "smooth",
        });
      } else {
        navEl.scrollLeft = targetLeft;
      }
    }

    updateCue();
    navEl.addEventListener("scroll", updateCue, { passive: true });
    window.addEventListener("resize", updateCue);
    return () => {
      navEl.removeEventListener("scroll", updateCue);
      window.removeEventListener("resize", updateCue);
    };
  }, [liquidGlass, activeSlug]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.dataset.adminInternal = 'true';
      return () => {
        delete document.body.dataset.adminInternal;
      };
    }
  }, []);

  const isBarber = profile.role === "BARBER";

  const visibleMainSections = (isBarber ? barberSectionDefs : sectionDefs)
    .filter(
      ({ slug }) =>
        mayAccessStaffSection(profile, slug) && (profile.role === "ADMIN" || slug !== "inicio"),
    )
    .map((item) => {
      const to =
        item.slug === "membresias"
          ? cleanBase.includes("-old")
            ? `${cleanBase}/membresias`
            : "/panel-membresias"
          : item.slug === "descuentos"
            ? cleanBase.includes("-old")
              ? `${cleanBase}/descuentos`
              : "/panel-descuentos"
            : `${cleanBase}/${item.slug}`;
      return { ...item, to };
    });

  const navContent = (
    <nav
      className="admin-section-nav v2-nav"
      data-nav-count={visibleMainSections.length}
      data-nav-scrollable={visibleMainSections.length >= 6 ? "true" : "false"}
      ref={navScrollRef}
      aria-label="Administración"
    >
      <div className="admin-section-nav-items" ref={navItemsRef}>
        {visibleMainSections.map(({ slug, to, title, icon: Icon }) => {
          const isActive = activeSlug === slug;
          return (
            <Link
              key={slug}
              to={to}
              activeOptions={{ exact: true }}
              data-nav-slug={slug}
              className={`admin-section-nav-link ${isActive ? "is-active" : ""}`.trim()}
              aria-current={isActive ? "page" : undefined}
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
    children ?? <Outlet />
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
      <header
        className="v2-navigation"
        data-scroll-left={liquidGlass && navCue.left ? "true" : undefined}
        data-scroll-right={liquidGlass && navCue.right ? "true" : undefined}
      >
        {liquidGlass ? <MotionConfig reducedMotion="user">{navContent}</MotionConfig> : navContent}
      </header>
      <div className="v2-workspace">
        {error && (
          <div role="alert" className="v2-alert">
            {error} <button onClick={() => void refresh({ bypassCache: true })}>Reintentar</button>
          </div>
        )}
        {loading && (
          <p className="v2-loading" role="status" aria-live="polite">
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
