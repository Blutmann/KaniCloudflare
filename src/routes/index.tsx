import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/reservar',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/reservar" />,
});
