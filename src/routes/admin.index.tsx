import { createFileRoute } from '@tanstack/react-router';
import { AdminMobileAppointments } from '@/components/kani/admin-mobile-appointments';
import { pageHead } from '@/lib/kani-head';

export const Route = createFileRoute('/admin/')({
  head: () => pageHead('Panel de control', 'Gestión de turnos de Kani Barber Studio.', 'Kani Barber Studio - Panel de control'),
  component: AdminMobileAppointments,
});
