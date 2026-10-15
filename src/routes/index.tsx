import { createFileRoute } from '@tanstack/react-router';
import { Booking } from '@/components/kani/booking';
import { pageHead } from '@/lib/kani-head';

export const Route = createFileRoute('/')({
  head: () => pageHead('Elegí tu servicio', 'Reservá en Kani Barber Studio: elegí servicio, barbero, fecha y horario sin crear una cuenta.', 'Kani Barber Studio - Solicitar turno'),
  component: Booking,
});
