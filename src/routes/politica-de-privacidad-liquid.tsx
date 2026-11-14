import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/lib/kani-head';
import { PoliticaDePrivacidadPage } from '@/routes/politica-de-privacidad';
import { LiquidGlassShell } from '@/components/kani/experimental/liquid-glass-shell';

export const Route = createFileRoute('/politica-de-privacidad-liquid')({
  head: () => ({
    ...pageHead(
      'Política de Privacidad · Liquid Glass',
      'Política de Privacidad de Kani Barber Studio. Tratamiento, resguardo de datos personales y derechos del usuario conforme a la Ley 25.326.',
      'Política de Privacidad · Kani Barber Studio',
    ),
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: PoliticaDePrivacidadLiquidPage,
});

function PoliticaDePrivacidadLiquidPage() {
  return (
    <LiquidGlassShell section="legal">
      <PoliticaDePrivacidadPage backTo="/reservar-turno-liquid" />
    </LiquidGlassShell>
  );
}
