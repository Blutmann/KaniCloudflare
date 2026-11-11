import { createFileRoute } from "@tanstack/react-router";
import { PanelV2Payments } from "@/components/kani/v2-experimental/PanelV2Payments";

export const Route = createFileRoute("/panel-v2/negocio/pagos")({
  validateSearch: (search: Record<string, unknown>): { turno?: string } =>
    typeof search["turno"] === "string" ? { turno: search["turno"] } : {},
  component: PanelV2Payments,
});
