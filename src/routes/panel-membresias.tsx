import { createFileRoute } from '@tanstack/react-router';
import { V2Layout } from '@/components/kani/v2/layout';
import { V2MembershipsAndDiscounts } from '@/components/kani/v2/memberships-discounts';

export const Route = createFileRoute('/panel-membresias')({
  component: () => (
    <V2Layout basePath="/panel-administracion" liquidGlass forcedSectionSlug="membresias">
      <V2MembershipsAndDiscounts initialTab="MEMBRESIAS" standaloneTab="MEMBRESIAS" />
    </V2Layout>
  ),
  head: () => ({
    meta: [
      { title: 'Kani — Membresías' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});
