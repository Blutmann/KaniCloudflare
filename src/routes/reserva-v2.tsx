import { createFileRoute } from '@tanstack/react-router';
import { Booking } from '@/components/kani/booking';
import { pageHead } from '@/lib/kani-head';
import '@/components/kani/experimental/reserva-v2.css';

function ExperimentalBooking() {
  return <Booking combinedDateTime />;
}

export const Route = createFileRoute('/reserva-v2')({
  head: () => {
    const baseHead = pageHead(
      'Reservá tu turno · Experimento',
      'Elegí tu servicio, barbero, fecha y horario en Kani Barber Studio.',
      'Kani Barber Studio - Reservar turno',
    );
    return {
      ...baseHead,
      meta: [...baseHead.meta, { name: 'robots', content: 'noindex, nofollow' }],
    };
  },
  component: ExperimentalBooking,
});
