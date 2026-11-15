import { createFileRoute } from '@tanstack/react-router';
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';
import { pageHead } from '@/lib/kani-head';
import '@/components/kani/experimental/reserva-v2.css';
import '@/components/kani/experimental/reserva-v3.css';
import '@/components/kani/experimental/reserva-v4.css';

export const Route = createFileRoute('/reservar-turno-old')({
  head: () => ({
    ...pageHead(
      'Reservá tu turno · Clásico',
      'Reservá tu turno en Kani Barber Studio.',
      'Kani Barber Studio - Reservar turno',
    ),
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: () => <PaywayBooking homeUrl="/reservar-turno-old" />,
});
