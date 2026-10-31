import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/reservar')({
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/reservar-turno', search });
  },
  component: () => <Navigate to="/reservar-turno" />,
});
