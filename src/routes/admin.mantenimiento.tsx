import { createFileRoute } from '@tanstack/react-router';
import { AdminMaintenance } from '@/components/kani/admin-maintenance';
import { pageHead } from '@/lib/kani-head';

export const Route = createFileRoute('/admin/mantenimiento')({
  head: () => pageHead('Mantenimiento', 'Limpieza segura de registros de prueba en Kani Barber Studio.', 'Kani Barber Studio - Panel de control'),
  component: AdminMaintenance,
});
