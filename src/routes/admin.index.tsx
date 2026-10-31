import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/')({
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/panel-administracion', search });
  },
  component: () => <Navigate to="/panel-administracion" />,
});
