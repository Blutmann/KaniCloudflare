import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/admin-liquid/datos')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/panel-administracion/datos',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/panel-administracion/datos" replace />,
});
