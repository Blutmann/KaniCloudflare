import { createFileRoute } from '@tanstack/react-router';
import { AdminMobileAppointments } from '@/components/kani/admin-mobile-appointments';
import { pageHead } from '@/lib/kani-head';

export const Route = createFileRoute('/admin/movil')({
  head: () => pageHead('Turnos', 'Gestión de turnos para Kani Barber Studio.', 'Kani Barber Studio - Turnos'),
  component: AdminMobileAppointments,
});
