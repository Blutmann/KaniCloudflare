import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/admin-liquid/pagos')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/panel-administracion/pagos',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/panel-administracion/pagos" replace />,
});
