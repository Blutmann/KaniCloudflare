import { createFileRoute } from "@tanstack/react-router";
import { V2Insights } from "@/components/kani/v2/insights";
export const Route = createFileRoute("/admin-v2/datos")({ component: V2Insights });
