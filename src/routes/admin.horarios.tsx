import { createFileRoute } from '@tanstack/react-router';
import { AdminScheduleManager } from '@/components/kani/admin-schedule-manager';
import { pageHead } from '@/lib/kani-head';

export const Route = createFileRoute('/admin/horarios')({
  head: () => pageHead('Gestiona tus horarios', 'Gestioná la disponibilidad de tu agenda en Kani Barber Studio.', 'Kani Barber Studio - Gestiona tus horarios'),
  component: AdminScheduleManager,
});
