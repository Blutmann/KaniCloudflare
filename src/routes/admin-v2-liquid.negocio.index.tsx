import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/admin-v2-liquid/negocio/')({
  component: () => <Navigate to="/admin-v2-liquid/negocio/pagos" replace />,
});
