import { createFileRoute } from "@tanstack/react-router";
import { V2Payments } from "@/components/kani/v2/payments";
export const Route = createFileRoute("/admin-v2/pagos")({
  validateSearch: (search: Record<string, unknown>): { turno?: string } =>
    typeof search["turno"] === "string" ? { turno: search["turno"] } : {},
  component: V2Payments,
});
