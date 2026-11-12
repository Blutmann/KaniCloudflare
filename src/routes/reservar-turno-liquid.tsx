import { createFileRoute } from '@tanstack/react-router';
import { LiquidGlassBooking } from '@/components/kani/experimental/liquid-glass-booking';
import { pageHead } from '@/lib/kani-head';
import '@/components/kani/experimental/reserva-v2.css';
import '@/components/kani/experimental/reserva-v3.css';
import '@/components/kani/experimental/reserva-v4.css';
import '@/components/kani/experimental/liquid-glass.css';

export const Route = createFileRoute('/reservar-turno-liquid')({
  head: () =>
    pageHead(
      'Reservá tu turno · Liquid Glass',
      'Reservá tu turno en Kani Barber Studio.',
      'Kani Barber Studio - Reservar turno',
    ),
  component: LiquidGlassBooking,
});
