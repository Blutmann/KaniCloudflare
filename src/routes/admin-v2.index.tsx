import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/admin-v2/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin-v2/inicio" });
  },
});
