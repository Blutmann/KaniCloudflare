import { createFileRoute } from '@tanstack/react-router';
import { V2Layout } from '@/components/kani/v2/layout';

export const Route = createFileRoute('/admin-liquid')({
  component: () => <V2Layout basePath="/admin-liquid" liquidGlass />,
  head: () => ({
    meta: [
      { title: 'Kani — Administración · Liquid Glass' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});
