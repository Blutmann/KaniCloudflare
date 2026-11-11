import { createFileRoute } from "@tanstack/react-router";
import { V2MembershipsAndDiscounts } from "@/components/kani/v2/memberships-discounts";

export const Route = createFileRoute("/panel-v2/negocio/membresias")({
  component: () => (
    <V2MembershipsAndDiscounts initialTab="MEMBRESIAS" standaloneTab="MEMBRESIAS" />
  ),
});
