import { createFileRoute } from '@tanstack/react-router';
import { PanelV2Layout } from '@/components/kani/v2-experimental/PanelV2Layout';

export const Route = createFileRoute('/admin-v2-liquid')({
  component: () => <PanelV2Layout basePath="/admin-v2-liquid" liquidGlass />,
  head: () => ({
    meta: [
      { title: 'Kani — Panel V2 · Liquid Glass' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});
