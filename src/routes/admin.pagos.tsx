import { createFileRoute } from '@tanstack/react-router';
import { AdminPayments } from '@/components/kani/admin-payments';
import { pageHead } from '@/lib/kani-head';

export const Route = createFileRoute('/admin/pagos')({
  head: () =>
    pageHead(
      'Registro de Pagos y Servicios',
      'Control de cobros y servicios de barbería en Kani Barber Studio.',
      'Kani Barber Studio - Pagos',
    ),
  component: AdminPayments,
});
