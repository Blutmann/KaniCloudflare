import { createFileRoute } from "@tanstack/react-router";
import { V2Discounts } from "@/components/kani/v2/discounts";
export const Route = createFileRoute("/panel-administracion/descuentos")({
  component: V2Discounts,
});
