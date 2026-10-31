import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin-v2")({
  component: Outlet,
  head: () => ({
    meta: [
      { title: "Kani — Administración" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
