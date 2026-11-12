import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/panel-v2/negocio/")({
  component: () => <Navigate to="/panel-v2/negocio/pagos" replace />,
});
