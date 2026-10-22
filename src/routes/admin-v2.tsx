import { createFileRoute } from "@tanstack/react-router";
import { V2Layout } from "@/components/kani/v2/layout";
export const Route = createFileRoute("/admin-v2")({
  component: V2Layout,
  head: () => ({
    meta: [{ title: "Kani — Administración V2" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});
