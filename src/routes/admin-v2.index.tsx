import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin-v2/")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/panel-administracion/inicio", search });
  },
});
