import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/admin-liquid/mantenimiento')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/panel-administracion/mantenimiento',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/panel-administracion/mantenimiento" replace />,
});
