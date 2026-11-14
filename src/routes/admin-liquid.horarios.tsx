import { createFileRoute } from '@tanstack/react-router';
import { AdminScheduleManager } from '@/components/kani/admin-schedule-manager';

export const Route = createFileRoute('/admin-liquid/horarios')({
  component: () => (
    <main className="v2-page v2-schedule">
      <AdminScheduleManager />
    </main>
  ),
});
