import { createFileRoute, redirect, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin-v2/inicio")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/panel-administracion/inicio", search });
  },
  component: () => <Navigate to="/panel-administracion/inicio" />,
});
