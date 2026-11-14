import { createFileRoute } from '@tanstack/react-router';
import { V2Insights } from '@/components/kani/v2/insights';

export const Route = createFileRoute('/admin-liquid/datos')({
  component: V2Insights,
});
