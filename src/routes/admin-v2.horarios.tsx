import { createFileRoute, redirect, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin-v2/horarios")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/panel-administracion/horarios", search });
  },
  component: () => <Navigate to="/panel-administracion/horarios" />,
});
