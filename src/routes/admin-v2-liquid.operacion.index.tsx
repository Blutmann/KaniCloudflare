import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/admin-v2-liquid/operacion/')({
  component: () => <Navigate to="/admin-v2-liquid/operacion/turnos" replace />,
});
