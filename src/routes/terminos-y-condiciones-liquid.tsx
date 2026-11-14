import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/lib/kani-head';
import { TerminosYCondicionesPage } from '@/routes/terminos-y-condiciones';
import { LiquidGlassShell } from '@/components/kani/experimental/liquid-glass-shell';

export const Route = createFileRoute('/terminos-y-condiciones-liquid')({
  head: () => ({
    ...pageHead(
      'Términos y Condiciones · Liquid Glass',
      'Términos y Condiciones generales de contratación de servicios y reservas en Kani Barber Studio.',
      'Términos y Condiciones · Kani Barber Studio',
    ),
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: TerminosYCondicionesLiquidPage,
});

function TerminosYCondicionesLiquidPage() {
  return (
    <LiquidGlassShell section="legal">
      <TerminosYCondicionesPage backTo="/reservar-turno-liquid" />
    </LiquidGlassShell>
  );
}
