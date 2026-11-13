import { useEffect, useState } from 'react';
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';
import {
  LiquidGlassMotionProvider,
  liquidGlassMotionAdapter,
} from '@/components/kani/experimental/liquid-glass-motion';

type ServicesLayoutVariant = 'a' | 'b';

function getInitialServicesVariant(): ServicesLayoutVariant {
  if (typeof window === 'undefined') return 'a';
  const param = new URLSearchParams(window.location.search).get('services');
  return param === 'b' ? 'b' : 'a';
}

/**
 * LiquidGlassBooking — Experiencia experimental Liquid Glass aislada para /reservar-turno-liquid.
 * Reutiliza íntegramente el flujo de negocio, disponibilidad, exclusión de Franco y pasarela Payway
 * sin duplicar reglas ni alterar las rutas existentes.
 */
export function LiquidGlassBooking() {
  const [servicesVariant, setServicesVariant] = useState<ServicesLayoutVariant>(getInitialServicesVariant);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.add('liquid-glass-active');
    return () => {
      document.body.classList.remove('liquid-glass-active');
    };
  }, []);

  const handleVariantChange = (variant: ServicesLayoutVariant) => {
    setServicesVariant(variant);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('services', variant);
      window.history.replaceState({}, '', url.toString());
    }
  };

  return (
    <LiquidGlassMotionProvider>
      <div className="liquid-glass-reservation" data-services-variant={servicesVariant}>
        <div className="liquid-glass-atmosphere" aria-hidden="true">
          <span className="liquid-orb liquid-orb-1" />
          <span className="liquid-orb liquid-orb-2" />
          <span className="liquid-orb liquid-orb-3" />
          <span className="liquid-orb liquid-orb-4" />
          <span className="liquid-grain" />
        </div>
        <div className="lg-services-variant-bar">
          <div className="lg-services-variant-switch" role="group" aria-label="Variante de tarjetas de servicios">
            <button
              type="button"
              className={servicesVariant === 'a' ? 'is-active' : undefined}
              aria-pressed={servicesVariant === 'a'}
              onClick={() => handleVariantChange('a')}
            >
              A · Horizontal
            </button>
            <button
              type="button"
              className={servicesVariant === 'b' ? 'is-active' : undefined}
              aria-pressed={servicesVariant === 'b'}
              onClick={() => handleVariantChange('b')}
            >
              B · 2+1
            </button>
          </div>
        </div>
        <PaywayBooking homeUrl="/reservar-turno-liquid" experimentalMotion={liquidGlassMotionAdapter} />
      </div>
    </LiquidGlassMotionProvider>
  );
}
