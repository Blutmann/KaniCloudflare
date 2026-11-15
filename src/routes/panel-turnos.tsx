import { createFileRoute } from '@tanstack/react-router';
import { V2Layout } from '@/components/kani/v2/layout';
import { V2Appointments } from '@/components/kani/v2/agenda';

export const Route = createFileRoute('/panel-turnos')({
  component: () => (
    <V2Layout basePath="/panel-administracion" liquidGlass forcedSectionSlug="turnos">
      <V2Appointments paymentsTo="/panel-administracion/pagos" />
    </V2Layout>
  ),
  head: () => ({
    meta: [
      { title: 'Kani — Turnos' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});
