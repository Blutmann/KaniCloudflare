import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/estadisticas')({
  beforeLoad: () => {
    throw redirect({
      to: '/admin/datos',
      statusCode: 301,
    });
  },
  component: () => <Navigate to="/admin/datos" replace />,
});
