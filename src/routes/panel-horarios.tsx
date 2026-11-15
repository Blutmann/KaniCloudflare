import { createFileRoute } from '@tanstack/react-router';
import { V2Layout } from '@/components/kani/v2/layout';
import { AdminScheduleManager } from '@/components/kani/admin-schedule-manager';

export const Route = createFileRoute('/panel-horarios')({
  component: () => (
    <V2Layout basePath="/panel-administracion" liquidGlass forcedSectionSlug="horarios">
      <main className="v2-page v2-schedule">
        <AdminScheduleManager />
      </main>
    </V2Layout>
  ),
  head: () => ({
    meta: [
      { title: 'Kani — Horarios' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});
