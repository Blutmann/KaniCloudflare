import { createFileRoute } from '@tanstack/react-router';
import { AdminScheduleManager } from '@/components/kani/admin-schedule-manager';

export const Route = createFileRoute('/panel-administracion-old/horarios')({
  component: V2ScheduleOld,
});

function V2ScheduleOld() {
  return (
    <main className="v2-page v2-schedule">
      <AdminScheduleManager />
    </main>
  );
}
