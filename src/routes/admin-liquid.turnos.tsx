import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/admin-liquid/turnos')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/panel-administracion/turnos',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/panel-administracion/turnos" replace />,
});
