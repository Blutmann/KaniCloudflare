import { createFileRoute } from '@tanstack/react-router';
import { V2MembershipsAndDiscounts } from '@/components/kani/v2/memberships-discounts';

export const Route = createFileRoute('/admin-v2-liquid/negocio/membresias')({
  component: () => (
    <V2MembershipsAndDiscounts initialTab="MEMBRESIAS" standaloneTab="MEMBRESIAS" />
  ),
});
