import { createFileRoute } from '@tanstack/react-router';
import { V2Payments } from '@/components/kani/v2/payments';

export const Route = createFileRoute('/admin-liquid/pagos')({
  component: V2Payments,
});
