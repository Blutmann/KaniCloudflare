import { createFileRoute, redirect, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin-v2/pagos")({
  validateSearch: (search: Record<string, unknown>): { turno?: string } =>
    typeof search["turno"] === "string" ? { turno: search["turno"] } : {},
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/panel-administracion/pagos", search });
  },
  component: () => <Navigate to="/panel-administracion/pagos" />,
});
