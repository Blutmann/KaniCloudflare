import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/lib/kani-head';
import { ContactoContent } from '@/routes/contacto';

export const Route = createFileRoute('/contacto-old')({
  head: () => ({
    ...pageHead(
      'Contacto · Clásico',
      'Contacto de Kani Barber Studio, ubicación y horarios de atención.',
      'Kani Barber Studio - Contacto',
    ),
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: () => <ContactoContent bookingPath="/reservar-turno-old" />,
});
