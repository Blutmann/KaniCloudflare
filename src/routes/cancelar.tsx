import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/cancelar')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/cancelar-turno',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/cancelar-turno" replace />,
});
