import { useEffect, type ReactNode } from 'react';
import '@fontsource-variable/inter';
import '@/components/kani/experimental/liquid-glass.css';
import '@/components/kani/experimental/liquid-glass-routes.css';
import '@/components/kani/experimental/liquid-glass-typography.css';

export type LiquidGlassSection = 'booking' | 'contact' | 'admin' | 'legal' | 'cancellation';

const LIQUID_GLASS_PREFIXES = [
  '/',
  '/reservar',
  '/contacto',
  '/cancelar-turno',
  '/panel-administracion',
  '/panel-membresias',
  '/panel-descuentos',
  '/panel-turnos',
  '/panel-horarios',
  '/pago',
  '/politica-de-privacidad',
  '/terminos-y-condiciones',
] as const;

export function isClassicLegacyPath(_pathname: string): boolean {
  return false;
}

const LIQUID_GLASS_ADMIN_PREFIXES = [
  '/panel-administracion',
  '/panel-membresias',
  '/panel-descuentos',
  '/panel-turnos',
  '/panel-horarios',
] as const;

export function isLiquidGlassPath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return LIQUID_GLASS_PREFIXES.some((prefix) =>
    prefix === '/' ? clean === '/' : clean === prefix || clean.startsWith(`${prefix}/`),
  );
}

export function isLiquidGlassAdminPath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return LIQUID_GLASS_ADMIN_PREFIXES.some(
    (prefix) => clean === prefix || clean.startsWith(`${prefix}/`),
  );
}

/**
 * Shell visual compartido de Liquid Glass para secciones paralelas
 * (Contacto, Administración, Panel V2, Legales).
 * Activa body.liquid-glass-active y provee la atmósfera óptica Light/Dark
 * sin alterar la lógica de negocio ni las rutas tradicionales.
 */
export function LiquidGlassShell({
  section,
  children,
}: {
  section: LiquidGlassSection;
  children: ReactNode;
}) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.add('liquid-glass-active');
    return () => {
      document.body.classList.remove('liquid-glass-active');
    };
  }, []);

  return (
    <div className="liquid-glass-reservation liquid-glass-page" data-lg-section={section}>
      <div className="liquid-glass-atmosphere" aria-hidden="true">
        <span className="liquid-orb liquid-orb-1" />
        <span className="liquid-orb liquid-orb-2" />
        <span className="liquid-orb liquid-orb-3" />
        <span className="liquid-orb liquid-orb-4" />
        <span className="liquid-grain" />
      </div>
      <div className="liquid-glass-page-content">{children}</div>
    </div>
  );
}
