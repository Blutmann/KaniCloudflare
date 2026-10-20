import { createFileRoute } from '@tanstack/react-router';
import { AdminStatistics } from '@/components/kani/admin-statistics';
import { pageHead } from '@/lib/kani-head';

export const Route = createFileRoute('/admin/estadisticas')({
  head: () =>
    pageHead(
      'Datos y Métricas',
      'Análisis de demanda, horarios pico, servicios y directorio de clientes de Kani Barber Studio.',
      'Kani Barber Studio - Datos',
    ),
  component: AdminStatistics,
});
