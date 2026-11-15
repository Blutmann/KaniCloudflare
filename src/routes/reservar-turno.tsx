import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/reservar-turno')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/reservar',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/reservar" replace />,
});
