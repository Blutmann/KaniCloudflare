import { createFileRoute, redirect, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin-v2/datos")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/panel-administracion/datos", search });
  },
  component: () => <Navigate to="/panel-administracion/datos" />,
});
