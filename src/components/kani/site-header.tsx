import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Building2, CalendarClock, Instagram, LogIn, LogOut, MapPin, Menu, Moon, Sun, Wrench, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import kaniLogo from '@/assets/kani-logo-transparent.webp';
import { getAuthenticatedStaff, signOut, type AuthenticatedStaff } from '@/lib/kani-auth';
import { supabase } from '@/integrations/supabase/client';
import { useKani } from '@/components/kani/store';

const AdminActivityPopover = lazy(() =>
  import('@/components/kani/admin-activity-popover').then(m => ({ default: m.AdminActivityPopover }))
);

export function Wordmark() {
  return <img src={kaniLogo} alt="Kani Barber Studio" width={2048} height={958} className="wordmark-img" />;
}

export function MobileMenuAction() {
  const path = useRouterState({ select: s => s.location.pathname });
  const navigate = useNavigate();
  const { setMobileMenuOpen } = useKani();
  const returnToBooking = () => {
    setMobileMenuOpen(false);
    if (path !== '/reservar') void navigate({ to: '/reservar' });
  };
  return <div className="booking-cta mobile-menu-cta"><div className="booking-cta-inner flex items-center"><Button className="action-positive booking-menu-return h-12" onClick={returnToBooking}>Volver a la solicitud <ArrowUpRight /></Button></div></div>;
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMenuOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen, onMenuOpenChange]);
  const openPathRef = useRef(path);
  useEffect(() => {
    const body = document.body;
    if (menuOpen) {
      openPathRef.current = path;
      const scrollY = window.scrollY;
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
    }
    return () => {
      const top = body.style.top;
      const restoreY = top ? Math.max(0, Number.parseInt(top, 10) * -1) : 0;
      body.style.position = '';
      body.style.top = '';
      body.style.left = '';
      body.style.right = '';
      body.style.width = '';
      body.style.overflow = '';
      if (top && window.location.pathname === openPathRef.current) {
        window.scrollTo(0, restoreY);
      }
    };
  }, [menuOpen, path]);

  useEffect(() => {
    const body = document.body;
    if (!menuOpen && (body.style.position === 'fixed' || body.style.overflow === 'hidden')) {
      body.style.position = '';
      body.style.top = '';
      body.style.left = '';
      body.style.right = '';
      body.style.width = '';
      body.style.overflow = '';
    }
  }, [path, menuOpen]);
  const closeMenu = () => onMenuOpenChange(false);
  const continueBooking = (event: MouseEvent<HTMLAnchorElement>) => {
    if (path === '/reservar') {
      event.preventDefault();
      closeMenu();
    }
  };
  const sessionRole = staff?.profile.role === 'ADMIN' ? 'Administrador' : staff?.profile.role === 'BARBER' ? 'Barbero' : '';
  const mobileMenu = menuOpen ? (
    <nav className="mobile-menu" aria-label="Menú principal" aria-modal="true">
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
    <header className={`site-header ${menuOpen ? 'menu-open' : ''}`}><div className="site-container flex items-center gap-4"><div className="admin-header-left"><Link to="/" aria-label="Kani Barber Studio, inicio" className="w-fit" onClick={closeMenu}><Wordmark /></Link></div><div className="header-controls ml-auto">{staff && <Suspense fallback={null}><AdminActivityPopover role={staff.profile.role} /></Suspense>}<ThemeToggle /><Button variant="outline" size="icon" className={`mobile-menu-trigger header-control-button ${admin ? 'admin-menu-trigger' : ''}`} aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} onClick={() => onMenuOpenChange(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</Button></div></div></header>
    {typeof document !== 'undefined' && mobileMenu ? createPortal(mobileMenu, document.body) : null}
    {typeof document !== 'undefined' && menuOpen && path !== '/reservar' ? createPortal(<MobileMenuAction />, document.body) : null}
  </>;
}

export function SiteFooter() {
  const footerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    const updateHeight = () => document.documentElement.style.setProperty('--site-footer-height', `${footer.getBoundingClientRect().height}px`);
    updateHeight();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateHeight) : null;
    observer?.observe(footer);
    window.addEventListener('resize', updateHeight);
    return () => { observer?.disconnect(); window.removeEventListener('resize', updateHeight); document.documentElement.style.removeProperty('--site-footer-height'); };
  }, []);
  return <footer ref={footerRef} className="site-footer border-t text-xs text-muted-foreground"><div className="site-container site-footer-inner"><div className="site-footer-study"><p>San Isidro Labrador 7, Martínez, Provincia de Buenos Aires</p><p>Lunes a sábados de 10:00 a 20:00 hs</p></div><div className="site-footer-links"><div className="site-footer-link-row"><Link to="/estudio" className="inline-flex items-center gap-2 hover:text-foreground"><Building2 size={14} /> Contacto</Link><a href="https://www.google.com/maps/place/KANI+BARBER+STUDIO/data=!4m2!3m1!1s0x0:0x48bcfe7b2ea7ba60" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-foreground"><MapPin size={14} /> Ver ubicación</a><a href="https://www.instagram.com/kanibarberstudio/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-foreground"><Instagram size={14} /> Instagram</a></div><span className="site-footer-copyright">© 2026 Kani Barber Studio</span></div></div></footer>;
}
