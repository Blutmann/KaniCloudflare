import { createFileRoute } from "@tanstack/react-router";
import { V2Clients } from "@/components/kani/v2/clients";
export const Route = createFileRoute("/admin-v2/clientes")({ component: V2Clients });
