import { createFileRoute } from '@tanstack/react-router';
import { PaywayBookingV5 } from '@/components/kani/experimental/payway-booking-v5';
import { pageHead } from '@/lib/kani-head';
import '@/components/kani/experimental/reserva-v2.css';
import '@/components/kani/experimental/reserva-v3.css';
import '@/components/kani/experimental/reserva-v4.css';
import '@/components/kani/experimental/reserva-v5.css';

export const Route = createFileRoute('/reserva-v5')({
  head: () => pageHead('Reservá tu turno · Reserva V5', 'Reserva con claridad visual y Payway en Kani Barber Studio.', 'Kani Barber Studio - Solicitar turno'),
  component: PaywayBookingV5,
});
