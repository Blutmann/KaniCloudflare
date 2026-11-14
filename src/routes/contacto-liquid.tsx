import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/lib/kani-head';
import { ContactoContent } from '@/routes/contacto';
import { LiquidGlassShell } from '@/components/kani/experimental/liquid-glass-shell';

export const Route = createFileRoute('/contacto-liquid')({
  head: () => ({
    ...pageHead(
      'Contacto · Liquid Glass',
      'Contacto de Kani Barber Studio, ubicación y horarios de atención.',
      'Kani Barber Studio - Contacto',
    ),
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: ContactoLiquidPage,
});

function ContactoLiquidPage() {
  return (
    <LiquidGlassShell section="contact">
      <ContactoContent bookingPath="/reservar-turno-liquid" />
    </LiquidGlassShell>
  );
}
