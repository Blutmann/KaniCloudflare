import { createFileRoute } from "@tanstack/react-router";
import { V2Home } from "@/components/kani/v2/agenda";

export const Route = createFileRoute("/panel-administracion/inicio")({
  component: V2Home,
});
