import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/lib/kani-head';
import { PoliticaDePrivacidadPage } from '@/routes/politica-de-privacidad';

export const Route = createFileRoute('/politica-de-privacidad-old')({
  head: () => ({
    ...pageHead(
      'Política de Privacidad · Clásico',
      'Política de Privacidad de Kani Barber Studio. Tratamiento, resguardo de datos personales y derechos del usuario conforme a la Ley 25.326.',
      'Política de Privacidad · Kani Barber Studio',
    ),
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: () => (
    <PoliticaDePrivacidadPage
      backTo="/reservar-turno-old"
      termsTo="/terminos-y-condiciones-old"
    />
  ),
});
