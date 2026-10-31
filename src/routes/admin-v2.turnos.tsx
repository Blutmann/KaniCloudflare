import { createFileRoute, redirect, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin-v2/turnos")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/panel-administracion/turnos", search });
  },
  component: () => <Navigate to="/panel-administracion/turnos" />,
});
