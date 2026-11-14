import { createFileRoute } from '@tanstack/react-router';
import { PanelV2Home } from '@/components/kani/v2-experimental/PanelV2Home';

export const Route = createFileRoute('/admin-v2-liquid/')({
  component: () => <PanelV2Home basePath="/admin-v2-liquid" />,
});
