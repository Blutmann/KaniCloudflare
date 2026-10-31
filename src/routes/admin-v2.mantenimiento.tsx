import { createFileRoute, redirect, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin-v2/mantenimiento")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/panel-administracion/mantenimiento", search });
  },
  component: () => <Navigate to="/panel-administracion/mantenimiento" />,
});
