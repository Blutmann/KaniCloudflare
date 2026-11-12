import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/panel-v2/operacion/")({
  component: () => <Navigate to="/panel-v2/operacion/turnos" replace />,
});
