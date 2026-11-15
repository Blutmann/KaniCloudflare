import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/politica-de-privacidad-liquid')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/politica-de-privacidad',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/politica-de-privacidad" replace />,
});
