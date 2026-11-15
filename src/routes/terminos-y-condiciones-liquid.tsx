import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/terminos-y-condiciones-liquid')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/terminos-y-condiciones',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/terminos-y-condiciones" replace />,
});
