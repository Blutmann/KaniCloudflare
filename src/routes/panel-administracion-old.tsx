import { createFileRoute } from '@tanstack/react-router';
import { V2Layout } from '@/components/kani/v2/layout';

export const Route = createFileRoute('/panel-administracion-old')({
  component: () => <V2Layout basePath="/panel-administracion-old" liquidGlass={false} />,
  head: () => ({
    meta: [
      { title: 'Kani — Administración · Clásico' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});
