import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/contacto-liquid')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/contacto',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/contacto" replace />,
});
