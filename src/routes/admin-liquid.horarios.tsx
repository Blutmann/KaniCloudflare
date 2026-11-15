import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/admin-liquid/horarios')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/panel-administracion/horarios',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/panel-administracion/horarios" replace />,
});
