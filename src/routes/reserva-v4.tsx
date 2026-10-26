import { createFileRoute } from '@tanstack/react-router';
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';
import { pageHead } from '@/lib/kani-head';
import '@/components/kani/experimental/reserva-v2.css';
import '@/components/kani/experimental/reserva-v4.css';

export const Route = createFileRoute('/reserva-v4')({
  head: () => pageHead('Reservá tu turno · Payway', 'Reserva experimental con Payway en Kani Barber Studio.', 'Kani Barber Studio - Solicitar turno'),
  component: PaywayBooking,
});
