import { createFileRoute } from "@tanstack/react-router";
import { V2Layout } from "@/components/kani/v2/layout";

export const Route = createFileRoute("/panel-administracion")({
  component: () => <V2Layout basePath="/panel-administracion" liquidGlass />,
  head: () => ({
    meta: [
      { title: "Kani — Administración" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
