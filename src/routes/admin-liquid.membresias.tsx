import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/admin-liquid/membresias')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/panel-administracion/membresias',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/panel-administracion/membresias" replace />,
});
