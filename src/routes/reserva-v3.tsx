import { createFileRoute } from '@tanstack/react-router';
import { Booking } from '@/components/kani/booking';
import { pageHead } from '@/lib/kani-head';
import '@/components/kani/experimental/reserva-v2.css';
import '@/components/kani/experimental/reserva-v3.css';

function ReservaV3Booking() {
  return <Booking variant="v3" />;
}

export const Route = createFileRoute('/reserva-v3')({
  head: () => pageHead('Reservá tu turno · Reserva V3', 'Elegí tu servicio, barbero, fecha, horario y completá tus datos en Kani Barber Studio.', 'Kani Barber Studio - Solicitar turno'),
  component: ReservaV3Booking,
});
