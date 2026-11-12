import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/lib/kani-head';
import { LiquidExperience } from '@/components/kani/liquid/liquid-experience';

export const Route = createFileRoute('/reservar-turno-liquid')({
  head: () =>
    pageHead(
      'KANI Barber Studio · Experiencia Liquid Glass',
      'Tu estilo. Tu momento. Experiencia de reserva Liquid Glass de KANI Barber Studio.',
      'Kani Barber Studio - Reservar turno (Liquid Glass)',
    ),
  component: LiquidExperience,
});
