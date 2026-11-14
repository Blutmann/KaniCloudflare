import { createFileRoute } from '@tanstack/react-router';
import { PanelV2Payments } from '@/components/kani/v2-experimental/PanelV2Payments';

export const Route = createFileRoute('/admin-v2-liquid/negocio/pagos')({
  component: PanelV2Payments,
});
