import { createFileRoute } from "@tanstack/react-router";
import { PanelV2Home } from "@/components/kani/v2-experimental/PanelV2Home";

export const Route = createFileRoute("/panel-v2/")({
  component: PanelV2Home,
});
