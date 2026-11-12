import { createFileRoute } from "@tanstack/react-router";
import { PanelV2Layout } from "@/components/kani/v2-experimental/PanelV2Layout";

export const Route = createFileRoute("/panel-v2")({
  component: PanelV2Layout,
  head: () => ({
    meta: [
      { title: "Kani — Panel V2" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
