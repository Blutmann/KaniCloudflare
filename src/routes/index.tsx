import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/reservar-turno',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/reservar-turno" />,
});
