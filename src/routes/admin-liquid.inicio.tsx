import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/admin-liquid/inicio')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/panel-administracion/inicio',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/panel-administracion/inicio" replace />,
});
