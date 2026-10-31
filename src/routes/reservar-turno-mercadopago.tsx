import { createFileRoute } from '@tanstack/react-router';
import { MercadoPagoBooking } from '@/components/kani/experimental/mercadopago-booking';
import { pageHead } from '@/lib/kani-head';
import '@/components/kani/experimental/reserva-v2.css';
import '@/components/kani/experimental/reserva-v3.css';
import '@/components/kani/experimental/reserva-v4.css';

export const Route = createFileRoute('/reservar-turno-mercadopago')({
  head: () =>
    pageHead(
      'Reservá tu turno · Mercado Pago',
      'Reservá tu turno en Kani Barber Studio con Mercado Pago.',
      'Kani Barber Studio - Solicitar turno',
    ),
  component: MercadoPagoBooking,
});
