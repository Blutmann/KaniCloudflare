import { createFileRoute } from '@tanstack/react-router';
import { Booking } from '@/components/kani/booking';
import { pageHead } from '@/lib/kani-head';
export const Route = createFileRoute('/reservar')({ head: () => pageHead('Reservá tu turno', 'Elegí tu servicio, barbero y horario en Kani Barber Studio. Reservá sin crear una cuenta.', 'Kani Barber Studio - Solicitar turno'), component: Booking });
