import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/lib/kani-head';
import { TerminosYCondicionesPage } from '@/routes/terminos-y-condiciones';

export const Route = createFileRoute('/terminos-y-condiciones-old')({
  head: () => ({
    ...pageHead(
      'Términos y Condiciones · Clásico',
      'Términos y Condiciones generales de contratación de servicios y reservas en Kani Barber Studio.',
      'Términos y Condiciones · Kani Barber Studio',
    ),
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: () => (
    <TerminosYCondicionesPage
      backTo="/reservar-turno-old"
      privacyTo="/politica-de-privacidad-old"
    />
  ),
});
