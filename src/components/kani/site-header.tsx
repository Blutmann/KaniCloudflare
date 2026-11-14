import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Bell, Building2, CalendarClock, CalendarDays, ChartNoAxesCombined, Clock3, CreditCard, Instagram, LayoutGrid, LogIn, LogOut, MapPin, Menu, Moon, Scale, ShieldCheck, Sun, Tag, Users, Wrench, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import kaniLogoLight from '@/assets/kani-logo-light.webp';
import kaniLogoDark from '@/assets/kani-logo-dark.webp';
import { getAuthenticatedStaff, signOut, type AuthenticatedStaff } from '@/lib/kani-auth';
import { supabase } from '@/integrations/supabase/client';
import { useKani } from '@/components/kani/store';
import { KANI_PUBLIC_WHATSAPP_URL } from '@/lib/kani-constants';
import { isLiquidGlassPath } from '@/components/kani/experimental/liquid-glass-shell';

const AdminActivityPopover = lazy(() =>
  import('@/components/kani/admin-activity-popover').then(m => ({ default: m.AdminActivityPopover }))
);

export function Wordmark() {
  return (
    <>
      <img
        src={kaniLogoLight}
        alt="Kani Barber Studio"
        width={1024}
        height={492}
        className="wordmark-img wordmark-light"
      />
      <img
        src={kaniLogoDark}
        alt="Kani Barber Studio"
        width={1024}
        height={492}
        className="wordmark-img wordmark-dark"
      />
    </>
  );
}

export function MobileMenuAction({ inline = false }: { inline?: boolean } = {}) {
  const path = useRouterState({ select: s => s.location.pathname });
  const navigate = useNavigate();
  const { setMobileMenuOpen } = useKani();
  const returnToBooking = () => {
    setMobileMenuOpen(false);
    const target = isLiquidGlassPath(path)
      ? '/reservar-turno-liquid'
      : path.includes('mercadopago')
        ? '/reservar-turno-mercadopago'
        : '/reservar-turno';
    if (path !== target) void navigate({ to: target });
  };
  if (inline) {
    return (
      <div className="mobile-menu-cta--inline">
        <Button className="action-positive booking-menu-return h-12" onClick={returnToBooking}>
          Volver a la reserva <ArrowUpRight />
        </Button>
      </div>
    );
  }
  return <div className="booking-cta mobile-menu-cta"><div className="booking-cta-inner flex items-center"><Button className="action-positive booking-menu-return h-12" onClick={returnToBooking}>Volver a la reserva <ArrowUpRight /></Button></div></div>;
}


export function HeaderWhatsApp() {
  return (
    <Button
      asChild
      variant="outline"
      size="icon"
      className="header-control-button header-whatsapp-button inline-flex"
      aria-label="Consultas por WhatsApp"
      title="Consultas por WhatsApp"
    >
      <a
        href={`${KANI_PUBLIC_WHATSAPP_URL}?text=Hola%2C%20quer%C3%ADa%20hacer%20una%20consulta%20sobre%20una%20reserva.`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg className="h-4 w-4 text-[#25D366]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
        </svg>
      </a>
    </Button>
  );
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useKani();
  const light = theme === 'light';
  const label = light ? 'Activar modo oscuro' : 'Activar modo claro';
  return <Button type="button" variant="outline" size="icon" className="theme-toggle header-control-button" onClick={toggleTheme} aria-label={label} aria-pressed={light} title={label}>{light ? <Moon /> : <Sun />}</Button>;
}

const LIQUID_HEADER_SCROLL_ENTER_PX = 8;
const LIQUID_HEADER_SCROLL_EXIT_PX = 3;

function getVerticalScrollOffset(scrolledContainers: Set<Element>): number {
  let maxScroll = Math.max(
    0,
    window.scrollY || 0,
    window.pageYOffset || 0,
    document.documentElement?.scrollTop || 0,
    document.scrollingElement?.scrollTop || 0,
    document.body?.scrollTop || 0,
  );

  const bodyTop = Number.parseFloat(document.body?.style.top || '0');
  if (Number.isFinite(bodyTop) && bodyTop < 0) {
    maxScroll = Math.max(maxScroll, Math.abs(bodyTop));
  }

  for (const el of Array.from(scrolledContainers)) {
    if (!el.isConnected || el.scrollTop <= 0) {
      scrolledContainers.delete(el);
      continue;
    }
    maxScroll = Math.max(maxScroll, el.scrollTop);
  }

  const bookingScroll = document.querySelector<HTMLElement>(
    '.site-shell .liquid-glass-reservation .booking-scroll-content',
  );
  if (bookingScroll && bookingScroll.scrollTop > 0) {
    scrolledContainers.add(bookingScroll);
    maxScroll = Math.max(maxScroll, bookingScroll.scrollTop);
  }

  return maxScroll;
}

export function SiteHeader() {
  const path = useRouterState({ select: s => s.location.pathname });
  const isLiquidRoute = isLiquidGlassPath(path);
  const admin = path.startsWith('/admin') || path.startsWith('/panel-administracion') || path.startsWith('/panel-v2');
  const { mobileMenuOpen: menuOpen, setMobileMenuOpen: onMenuOpenChange } = useKani();
  const [staff, setStaff] = useState<AuthenticatedStaff | null>(null);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isLiquidRoute || typeof window === 'undefined' || typeof document === 'undefined') {
      setHeaderScrolled(false);
      return;
    }

    const scrolledContainers = new Set<Element>();
    let rafId = 0;

    const evaluate = () => {
      rafId = 0;
      const offset = getVerticalScrollOffset(scrolledContainers);
      setHeaderScrolled((prev) =>
        prev ? offset > LIQUID_HEADER_SCROLL_EXIT_PX : offset >= LIQUID_HEADER_SCROLL_ENTER_PX,
      );
    };

    const scheduleEvaluate = () => {
      if (!rafId) {
        rafId = window.requestAnimationFrame(evaluate);
      }
    };

    const onScrollCapture = (event: Event) => {
      const target = event.target;
      if (target instanceof Element) {
        if (
          target.closest(
            '.mobile-menu, .notification-popover, [role="dialog"], .v2-dialog, [data-radix-popper-content-wrapper]',
          )
        ) {
          return;
        }
        const siteShell = document.querySelector('.site-shell');
        if (
          siteShell &&
          !siteShell.contains(target) &&
          target !== document.documentElement &&
          target !== document.body
        ) {
          return;
        }
        if (target.scrollTop > 0) {
          scrolledContainers.add(target);
        } else {
          scrolledContainers.delete(target);
        }
      }
      scheduleEvaluate();
    };

    setHeaderScrolled(false);
    scheduleEvaluate();

    window.addEventListener('scroll', scheduleEvaluate, { passive: true });
    document.addEventListener('scroll', onScrollCapture, { passive: true, capture: true });
    window.addEventListener('resize', scheduleEvaluate, { passive: true });
    window.addEventListener('orientationchange', scheduleEvaluate, { passive: true });

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener('scroll', scheduleEvaluate);
      document.removeEventListener('scroll', onScrollCapture, true);
      window.removeEventListener('resize', scheduleEvaluate);
      window.removeEventListener('orientationchange', scheduleEvaluate);
    };
  }, [isLiquidRoute, path]);
  useEffect(() => {
    let cancelled = false;
    const refreshStaff = () => {
      void getAuthenticatedStaff().then(next => {
        if (!cancelled) setStaff(next);
      });
    };
    const handleStaffAuthEvent = (event: Event) => {
      if (cancelled) return;
      const custom = event as CustomEvent<{ staff?: AuthenticatedStaff | null }>;
      if (custom.detail && 'staff' in custom.detail) {
        setStaff(custom.detail.staff ?? null);
      }
    };
    window.addEventListener('kani:staff-auth-changed', handleStaffAuthEvent);
    refreshStaff();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        if (!cancelled) setStaff(null);
      } else if (event !== 'INITIAL_SESSION') {
        window.setTimeout(refreshStaff, 0);
      } else if (session?.user) {
        setStaff(current => {
          if (!current) window.setTimeout(refreshStaff, 0);
          return current;
        });
      }
    });
    return () => {
      cancelled = true;
      window.removeEventListener('kani:staff-auth-changed', handleStaffAuthEvent);
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => { onMenuOpenChange(false); }, [path, onMenuOpenChange]);
  useEffect(() => {
    if (!menuOpen) return;
    const menuButton = menuButtonRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMenuOpenChange(false);
      if (e.key === 'Tab') {
        const targets = [...document.querySelectorAll<HTMLElement>('.site-header a, .site-header button, .mobile-menu a, .mobile-menu button, .mobile-menu-cta button')]
          .filter(el => el.tabIndex >= 0 && !el.hasAttribute('disabled') && el.getClientRects().length > 0);
        if (!targets.length) return;
        const current = targets.indexOf(document.activeElement as HTMLElement);
        const next = current < 0 ? (e.shiftKey ? targets.length - 1 : 0) : (current + (e.shiftKey ? -1 : 1) + targets.length) % targets.length;
        e.preventDefault();
        targets[next].focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      menuButton?.focus({ preventScroll: true });
    };
  }, [menuOpen, onMenuOpenChange]);
  const openPathRef = useRef(path);
  useEffect(() => {
    if (!menuOpen) return;
    const body = document.body;
    const previous = { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, width: body.style.width, overflow: body.style.overflow };
    const scrollY = window.scrollY;
    openPathRef.current = window.location.pathname;
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    return () => {
      Object.assign(body.style, previous);
      if (window.location.pathname === openPathRef.current) {
        window.scrollTo({ top: scrollY, behavior: 'instant' });
      }
    };
  }, [menuOpen]);

  const closeMenu = () => onMenuOpenChange(false);
  const bookingTarget = isLiquidRoute
    ? '/reservar-turno-liquid'
    : path.includes('mercadopago')
      ? '/reservar-turno-mercadopago'
      : '/reservar-turno';
  const contactTarget = isLiquidRoute ? '/contacto-liquid' : '/contacto';
  const adminBase = isLiquidRoute ? '/admin-liquid' : '/panel-administracion';
  const panelV2Target = isLiquidRoute ? '/admin-v2-liquid' : '/panel-v2';
  const privacyTarget = isLiquidRoute ? '/politica-de-privacidad-liquid' : '/politica-de-privacidad';
  const termsTarget = isLiquidRoute ? '/terminos-y-condiciones-liquid' : '/terminos-y-condiciones';
  const logoTarget = path.startsWith('/admin-v2-liquid')
    ? '/admin-v2-liquid'
    : isLiquidRoute
      ? '/reservar-turno-liquid'
      : path.startsWith('/panel-v2')
        ? '/panel-v2'
        : '/';

  const continueBooking = (event: MouseEvent<HTMLAnchorElement>) => {
    if (path === '/reservar-turno' || path === '/reservar-turno-liquid' || path === '/reservar-turno-mercadopago' || path === '/reservar' || path === '/reserva-v4' || path === '/reserva-v2') {
      event.preventDefault();
      closeMenu();
    }
  };
  const sessionRole = staff?.profile.role === 'ADMIN' ? 'Administrador' : staff?.profile.role === 'MANAGER' ? 'KANI Jefe' : staff?.profile.role === 'BARBER' ? 'Barbero' : '';
  const menuNavigationGroups = (
    <>
      {/* Grupo usuario */}
      <div className="mobile-menu-group">
        <Link to={bookingTarget} onClick={continueBooking}>
          <ArrowUpRight />Reservar turno
        </Link>
        <Link to={contactTarget} onClick={closeMenu}>
          <Building2 />Contacto
        </Link>
      </div>

      <div className="mobile-menu-divider" role="separator" />

      {/* Grupo barbero */}
      <div className="mobile-menu-group">
        <Link to={adminBase} onClick={closeMenu}>
          <CalendarClock />Panel de administración
        </Link>
        {!isLiquidRoute && (
          <Link to={panelV2Target} onClick={closeMenu}>
            <LayoutGrid />Panel V2
          </Link>
        )}

        {staff?.profile.role === 'BARBER' && (
          <>
            <Link to={`${adminBase}/turnos`} onClick={closeMenu}>
              <CalendarDays />Turnos
            </Link>
            <Link to={`${adminBase}/horarios`} onClick={closeMenu}>
              <Clock3 />Horarios
            </Link>
            <Link to={`${adminBase}/pagos`} onClick={closeMenu}>
              <CreditCard />Pagos
            </Link>
            <Link to={`${adminBase}/clientes`} onClick={closeMenu}>
              <Users />Clientes
            </Link>
            <Link to={`${adminBase}/datos`} onClick={closeMenu}>
              <ChartNoAxesCombined />Datos
            </Link>
          </>
        )}
      </div>

      {staff && ['ADMIN', 'MANAGER', 'BARBER'].includes(staff.profile.role) && (
        <div className="mobile-menu-group">
          <Link to={`${adminBase}/membresias`} onClick={closeMenu}>
            <Tag />Membresías y descuentos
          </Link>
        </div>
      )}

      {/* Grupo admin */}
      {staff?.profile.role === 'ADMIN' && (
        <>
          <div className="mobile-menu-divider" role="separator" />
          <div className="mobile-menu-group">
            <Link to={`${adminBase}/mantenimiento`} onClick={closeMenu}>
              <Wrench />Panel de mantenimiento
            </Link>
          </div>
        </>
      )}

      <div className="mobile-menu-divider" role="separator" />

      {/* Grupo legales */}
      <div className="mobile-menu-group">
        <Link to={privacyTarget} onClick={closeMenu}>
          <ShieldCheck />Política de Privacidad
        </Link>
        <Link to={termsTarget} onClick={closeMenu}>
          <Scale />Términos y Condiciones
        </Link>
      </div>
    </>
  );
  const menuSessionBlock = staff ? (
    <>
      <div className="mobile-menu-divider" role="separator" />
      <div className="mobile-menu-session">
        <div className="mobile-menu-session-identity">
          <strong>{staff.profile.role === 'ADMIN' ? 'KANI Admin' : (staff.profile.display_name || 'Barbero')}</strong>
          <span>{sessionRole}</span>
        </div>
        <button
          type="button"
          className="mobile-menu-signout"
          onClick={() => {
            closeMenu();
            const isMp = path.includes('mercadopago');
            void signOut().then(() => {
              setStaff(null);
              void navigate({ to: isLiquidRoute ? '/reservar-turno-liquid' : isMp ? '/reservar-turno-mercadopago' : '/reservar-turno' });
            });
          }}
        >
          <LogOut />Cerrar sesión
        </button>
      </div>
    </>
  ) : null;
  const mobileMenu = menuOpen ? (
    isLiquidRoute ? (
      <nav className="mobile-menu mobile-menu--liquid" id="kani-main-menu" aria-label="Menú principal">
        <div className="mobile-menu-scroll">
          {menuNavigationGroups}
        </div>
        <div className="mobile-menu-dock">
          {menuSessionBlock}
          <MobileMenuAction inline />
        </div>
      </nav>
    ) : (
      <nav className="mobile-menu" id="kani-main-menu" aria-label="Menú principal">
        {menuNavigationGroups}
        {/* Grupo 4: Sesión iniciada */}
        {menuSessionBlock}
      </nav>
    )
  ) : null;
  const headerClass = [
    'site-header',
    menuOpen ? 'menu-open' : '',
    isLiquidRoute ? 'liquid-glass-header' : '',
    isLiquidRoute && headerScrolled && !menuOpen ? 'liquid-glass-header--scrolled' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return <>
    <div className="site-header-slot"><header className={headerClass} data-scrolled={isLiquidRoute ? String(headerScrolled && !menuOpen) : undefined}><div className="site-container flex items-center gap-4"><div className="admin-header-left"><Link to={logoTarget} aria-label="Kani Barber Studio, inicio" className="w-fit" onClick={closeMenu}><Wordmark /></Link></div><div className="header-controls ml-auto">{staff && <Suspense fallback={<Button type="button" variant="outline" size="icon" className="notification-trigger header-control-button" aria-label="Cargando notificaciones" disabled><Bell /></Button>}><AdminActivityPopover role={staff.profile.role} userId={staff.user.id} isLiquid={isLiquidRoute} /></Suspense>}<HeaderWhatsApp /><ThemeToggle /><Button variant="outline" size="icon" className={`mobile-menu-trigger header-control-button ${admin ? 'admin-menu-trigger' : ''}`} aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} aria-controls={menuOpen ? "kani-main-menu" : undefined} ref={menuButtonRef} onClick={() => onMenuOpenChange(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</Button></div></div></header></div>
    {typeof document !== 'undefined' && mobileMenu ? createPortal(mobileMenu, document.body) : null}
    {typeof document !== 'undefined' && menuOpen && !isLiquidRoute ? createPortal(<MobileMenuAction />, document.body) : null}
  </>;
}

export function SiteFooter() {
  const path = useRouterState({ select: s => s.location.pathname });
  const isLiquidRoute = isLiquidGlassPath(path);
  const footerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    const updateHeight = () => { const h = window.innerWidth < 768 ? 0 : footer.getBoundingClientRect().height; document.documentElement.style.setProperty('--site-footer-height', `${h}px`); };
    updateHeight();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateHeight) : null;
    observer?.observe(footer);
    window.addEventListener('resize', updateHeight);
    return () => { observer?.disconnect(); window.removeEventListener('resize', updateHeight); document.documentElement.style.removeProperty('--site-footer-height'); };
  }, []);
  return <footer ref={footerRef} className="site-footer border-t text-xs text-muted-foreground"><div className="site-container site-footer-inner"><div className="site-footer-study"><p>San Isidro Labrador 7, Martínez, Provincia de Buenos Aires</p><p>Lunes a sábados de 10:00 a 20:00 hs</p></div><div className="site-footer-links"><div className="site-footer-link-row"><Link to={isLiquidRoute ? "/contacto-liquid" : "/contacto"} className="inline-flex items-center gap-2 hover:text-foreground"><Building2 size={14} /> Contacto</Link><a href="https://www.google.com/maps/place/KANI+BARBER+STUDIO/data=!4m2!3m1!1s0x0:0x48bcfe7b2ea7ba60" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-foreground"><MapPin size={14} /> Ver ubicación</a><a href="https://www.instagram.com/kanibarberstudio/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-foreground"><Instagram size={14} /> Instagram</a><Link to={isLiquidRoute ? "/terminos-y-condiciones-liquid" : "/terminos-y-condiciones"} className="hover:text-foreground">Términos y Condiciones</Link><Link to={isLiquidRoute ? "/politica-de-privacidad-liquid" : "/politica-de-privacidad"} className="hover:text-foreground">Política de Privacidad</Link></div><span className="site-footer-copyright">© 2026 Kani Barber Studio</span></div></div></footer>;
}
