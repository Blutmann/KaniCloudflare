import { createFileRoute } from '@tanstack/react-router';
import { V2Layout } from '@/components/kani/v2/layout';
import { V2MembershipsAndDiscounts } from '@/components/kani/v2/memberships-discounts';

export const Route = createFileRoute('/panel-descuentos')({
  component: () => (
    <V2Layout basePath="/panel-administracion" liquidGlass forcedSectionSlug="descuentos">
      <V2MembershipsAndDiscounts initialTab="DESCUENTOS" standaloneTab="DESCUENTOS" />
    </V2Layout>
  ),
  head: () => ({
    meta: [
      { title: 'Kani — Descuentos' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});
