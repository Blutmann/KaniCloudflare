import { createFileRoute } from '@tanstack/react-router';
import { AdminMobileAppointments } from '@/components/kani/admin-mobile-appointments';
import { pageHead } from '@/lib/kani-head';

export const Route = createFileRoute('/admin/turnos')({
  head: () => pageHead('Turnos', 'Gestión de turnos de Kani Barber Studio.', 'Kani Barber Studio - Turnos'),
  component: AdminMobileAppointments,
});
