import { useEffect } from 'react';
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';
import {
  LiquidGlassMotionProvider,
  liquidGlassMotionAdapter,
} from '@/components/kani/experimental/liquid-glass-motion';

/**
 * LiquidGlassBooking — Experiencia experimental Liquid Glass aislada para /reservar-turno-liquid.
 * Reutiliza íntegramente el flujo de negocio, disponibilidad, exclusión de Franco y pasarela Payway
 * sin duplicar reglas ni alterar las rutas existentes.
 */
export function LiquidGlassBooking() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.add('liquid-glass-active');
    return () => {
      document.body.classList.remove('liquid-glass-active');
    };
  }, []);

  return (
    <LiquidGlassMotionProvider>
      <div className="liquid-glass-reservation" data-services-variant="a">
        <div className="liquid-glass-atmosphere" aria-hidden="true">
          <span className="liquid-orb liquid-orb-1" />
          <span className="liquid-orb liquid-orb-2" />
          <span className="liquid-orb liquid-orb-3" />
          <span className="liquid-orb liquid-orb-4" />
          <span className="liquid-grain" />
        </div>
        <PaywayBooking homeUrl="/reservar-turno-liquid" experimentalMotion={liquidGlassMotionAdapter} />
      </div>
    </LiquidGlassMotionProvider>
  );
}
