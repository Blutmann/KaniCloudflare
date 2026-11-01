import { createFileRoute, redirect, Navigate } from '@tanstack/react-router';
import { pageHead } from '@/lib/kani-head';

export const Route = createFileRoute('/admin/mantenimiento')({
  head: () => pageHead('Mantenimiento', 'Limpieza segura de registros de prueba en Kani Barber Studio.', 'Kani Barber Studio - Panel de control'),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/panel-administracion/mantenimiento', search });
  },
  component: () => <Navigate to="/panel-administracion/mantenimiento" />,
});
