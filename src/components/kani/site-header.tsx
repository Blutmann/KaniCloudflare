import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Building2, CalendarClock, Instagram, LogIn, LogOut, MapPin, Menu, Moon, Sun, Wrench, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import kaniLogo from '@/assets/kani-logo-transparent.webp';
import kaniLogoRetina from '@/assets/kani-logo-transparent-2x.webp';
import { getAuthenticatedStaff, signOut, type AuthenticatedStaff } from '@/lib/kani-auth';
import { supabase } from '@/integrations/supabase/client';
import { useKani } from '@/components/kani/store';

const AdminActivityPopover = lazy(() =>
  import('@/components/kani/admin-activity-popover').then(m => ({ default: m.AdminActivityPopover }))
);

export function Wordmark() {
  return <img src={kaniLogo} srcSet={`${kaniLogo} 384w, ${kaniLogoRetina} 768w`} sizes="(max-width: 767px) 88px, 126px" alt="Kani Barber Studio" width={384} height={202} className="wordmark-img" />;
}

export function MobileMenuAction() {
  const path = useRouterState({ select: s => s.location.pathname });
  const navigate = useNavigate();
  const { setMobileMenuOpen } = useKani();
  const returnToBooking = () => {
    setMobileMenuOpen(false);
    if (path !== '/reservar' && path !== '/reserva-v2') void navigate({ to: '/reservar' });
  };
  return <div className="booking-cta mobile-menu-cta"><div className="booking-cta-inner flex items-center"><Button className="action-positive booking-menu-return h-12" onClick={returnToBooking}>Volver a la solicitud <ArrowUpRight /></Button></div></div>;
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
        href="https://wa.me/5491128436014?text=Hola%2C%20quer%C3%ADa%20hacer%20una%20consulta%20sobre%20una%20reserva."
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

export function SiteHeader() {
  const path = useRouterState({ select: s => s.location.pathname });
  const admin = path.startsWith('/admin');
  const { mobileMenuOpen: menuOpen, setMobileMenuOpen: onMenuOpenChange } = useKani();
  const [staff, setStaff] = useState<AuthenticatedStaff | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let cancelled = false;
    const refreshStaff = () => {
      void getAuthenticatedStaff().then(next => {
        if (!cancelled) setStaff(next);
      });
    };
    refreshStaff();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        if (!cancelled) setStaff(null);
      } else {
        window.setTimeout(refreshStaff, 0);
      }
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
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
  const continueBooking = (event: MouseEvent<HTMLAnchorElement>) => {
    if (path === '/reservar' || path === '/reserva-v2') {
      event.preventDefault();
      closeMenu();
    }
  };
  const sessionRole = staff?.profile.role === 'ADMIN' ? 'Administrador' : staff?.profile.role === 'BARBER' ? 'Barbero' : '';
  const mobileMenu = menuOpen ? (
    <nav className="mobile-menu" id="kani-main-menu" aria-label="Menú principal">
      {/* 1. Solicitar turno — Todos */}
      <Link to="/reservar" onClick={continueBooking}><ArrowUpRight />Solicitar turno</Link>
      {/* 2. Contacto — Todos */}
      <Link to="/estudio" onClick={closeMenu}><Building2 />Contacto</Link>
      {/* 3. Ubicación — Todos */}
      <a href="https://www.google.com/maps/place/KANI+BARBER+STUDIO/data=!4m2!3m1!1s0x0:0x48bcfe7b2ea7ba60" target="_blank" rel="noreferrer" onClick={closeMenu}><MapPin />Ubicación</a>
      {/* 4. Instagram — Todos */}
      <a href="https://www.instagram.com/kanibarberstudio/" target="_blank" rel="noreferrer" onClick={closeMenu}><Instagram />Instagram</a>
      {/* 5. Panel de administración — ADMIN y Barbero */}
      {staff && (staff.profile.role === 'ADMIN' || staff.profile.role === 'BARBER') && (
        <Link to="/admin" onClick={closeMenu}><CalendarClock />Panel de administración</Link>
      )}
      {/* 6. Panel de mantenimiento — Solo ADMIN */}
      {staff?.profile.role === 'ADMIN' && (
        <Link to="/admin/mantenimiento" onClick={closeMenu}><Wrench />Panel de mantenimiento</Link>
      )}
      {/* 7. Autenticación */}
      {staff ? (
        <div className="mobile-menu-session">
          <div className="mobile-menu-session-identity">
            <strong>{staff.profile.role === 'ADMIN' ? 'KANI Admin' : staff.profile.display_name}</strong>
            <span>{sessionRole}</span>
          </div>
          <button
            type="button"
            className="mobile-menu-signout"
            onClick={() => {
              closeMenu();
              void signOut().then(() => setStaff(null));
            }}
          >
            <LogOut />Cerrar sesión
          </button>
        </div>
      ) : (
        <Link to="/admin" onClick={closeMenu}><LogIn />Iniciar sesión</Link>
      )}
    </nav>
  ) : null;
  return <>
    <div className="site-header-slot"><header className={`site-header ${menuOpen ? 'menu-open' : ''}`}><div className="site-container flex items-center gap-4"><div className="admin-header-left"><Link to="/" aria-label="Kani Barber Studio, inicio" className="w-fit" onClick={closeMenu}><Wordmark /></Link></div><div className="header-controls ml-auto">{staff && <Suspense fallback={null}><AdminActivityPopover role={staff.profile.role} /></Suspense>}<HeaderWhatsApp /><ThemeToggle /><Button variant="outline" size="icon" className={`mobile-menu-trigger header-control-button ${admin ? 'admin-menu-trigger' : ''}`} aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} aria-controls={menuOpen ? "kani-main-menu" : undefined} ref={menuButtonRef} onClick={() => onMenuOpenChange(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</Button></div></div></header></div>
    {typeof document !== 'undefined' && mobileMenu ? createPortal(mobileMenu, document.body) : null}
    {typeof document !== 'undefined' && menuOpen ? createPortal(<MobileMenuAction />, document.body) : null}
  </>;
}

export function SiteFooter() {
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
  return <footer ref={footerRef} className="site-footer border-t text-xs text-muted-foreground"><div className="site-container site-footer-inner"><div className="site-footer-study"><p>San Isidro Labrador 7, Martínez, Provincia de Buenos Aires</p><p>Lunes a sábados de 10:00 a 20:00 hs</p></div><div className="site-footer-links"><div className="site-footer-link-row"><Link to="/estudio" className="inline-flex items-center gap-2 hover:text-foreground"><Building2 size={14} /> Contacto</Link><a href="https://www.google.com/maps/place/KANI+BARBER+STUDIO/data=!4m2!3m1!1s0x0:0x48bcfe7b2ea7ba60" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-foreground"><MapPin size={14} /> Ver ubicación</a><a href="https://www.instagram.com/kanibarberstudio/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-foreground"><Instagram size={14} /> Instagram</a></div><span className="site-footer-copyright">© 2026 Kani Barber Studio</span></div></div></footer>;
}
