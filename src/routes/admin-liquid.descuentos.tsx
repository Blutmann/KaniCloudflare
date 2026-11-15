import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/admin-liquid/descuentos')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/panel-administracion/descuentos',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/panel-administracion/descuentos" replace />,
});
