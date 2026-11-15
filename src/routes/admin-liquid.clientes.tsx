import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/admin-liquid/clientes')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/panel-administracion/clientes',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/panel-administracion/clientes" replace />,
});
