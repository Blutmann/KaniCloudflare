import { createFileRoute } from "@tanstack/react-router";
import { AdminMaintenance } from "@/components/kani/admin-maintenance";

export const Route = createFileRoute("/panel-administracion/mantenimiento")({
  component: AdminMaintenance,
});
