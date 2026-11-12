import { createFileRoute } from "@tanstack/react-router";
import { AdminScheduleManager } from "@/components/kani/admin-schedule-manager";

export const Route = createFileRoute("/panel-v2/operacion/horarios")({
  component: PanelV2Schedule,
});

function PanelV2Schedule() {
  return (
    <main className="v2-page v2-schedule">
      <AdminScheduleManager />
    </main>
  );
}
