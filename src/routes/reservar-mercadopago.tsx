import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/reservar-mercadopago')({
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/reservar-turno-mercadopago',
      search: (search as Record<string, unknown>) || {},
    });
  },
  component: () => <Navigate to="/reservar-turno-mercadopago" />,
});
