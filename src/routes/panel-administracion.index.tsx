import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/panel-administracion/")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/panel-administracion/inicio", search });
  },
});
