import { createFileRoute } from '@tanstack/react-router';
import { Booking } from '@/components/kani/booking';
import { pageHead } from '@/lib/kani-head';
import '@/components/kani/experimental/reserva-v2.css';

function ExperimentalBooking() {
  return <Booking combinedDateTime />;
}

export const Route = createFileRoute('/reserva-v2')({
  head: () => pageHead('Reservá tu turno · Experimento', 'Elegí tu servicio, barbero, fecha y horario en Kani Barber Studio.', 'Kani Barber Studio - Solicitar turno'),
  component: ExperimentalBooking,
});
