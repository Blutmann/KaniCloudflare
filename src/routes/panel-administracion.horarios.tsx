import { createFileRoute } from "@tanstack/react-router";
import { AdminScheduleManager } from "@/components/kani/admin-schedule-manager";

export const Route = createFileRoute("/panel-administracion/horarios")({
  component: V2Schedule,
});

function V2Schedule() {
  return (
    <main className="v2-page v2-schedule">
      <AdminScheduleManager />
    </main>
  );
}
