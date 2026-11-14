import { createFileRoute } from '@tanstack/react-router';
import { AdminScheduleManager } from '@/components/kani/admin-schedule-manager';

export const Route = createFileRoute('/admin-v2-liquid/operacion/horarios')({
  component: () => (
    <main className="v2-page v2-schedule">
      <AdminScheduleManager />
    </main>
  ),
});
