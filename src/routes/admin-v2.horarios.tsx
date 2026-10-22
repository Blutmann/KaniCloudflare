import { createFileRoute } from "@tanstack/react-router";
import { AdminScheduleManager } from "@/components/kani/admin-schedule-manager";
import { PageTitle } from "@/components/kani/v2/shared";
export const Route = createFileRoute("/admin-v2/horarios")({ component: V2Schedule });
function V2Schedule() {
  return (
    <div className="v2-page v2-schedule">
      <PageTitle
        eyebrow="ESPACIO PARA ATENDER"
        title="Tu jornada, a tu medida"
        description="Habilitá espacios, reconocé reservas y agregá horarios dentro o fuera de la jornada habitual."
      />
      <AdminScheduleManager />
      <p className="v2-footnote">
        Se reutiliza la gestión autorizada de disponibilidad. Los horarios agregados pueden
        inhabilitarse; la eliminación física de horarios manuales requiere primero identificar su
        origen en el modelo.
      </p>
    </div>
  );
}
