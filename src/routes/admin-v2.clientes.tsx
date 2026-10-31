import { createFileRoute, redirect, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin-v2/clientes")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/panel-administracion/clientes", search });
  },
  component: () => <Navigate to="/panel-administracion/clientes" />,
});
