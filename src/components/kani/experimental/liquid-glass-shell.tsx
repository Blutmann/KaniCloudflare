import { useEffect, type ReactNode } from 'react';
import '@/components/kani/experimental/liquid-glass.css';
import '@/components/kani/experimental/liquid-glass-routes.css';

export type LiquidGlassSection = 'booking' | 'contact' | 'admin' | 'legal';

const LIQUID_GLASS_PREFIXES = [
  '/reservar-turno-liquid',
  '/contacto-liquid',
  '/admin-liquid',
  '/admin-v2-liquid',
  '/politica-de-privacidad-liquid',
  '/terminos-y-condiciones-liquid',
] as const;

export function isLiquidGlassPath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return LIQUID_GLASS_PREFIXES.some(
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
