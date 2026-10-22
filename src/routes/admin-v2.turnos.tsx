import { createFileRoute } from "@tanstack/react-router";
import { V2Appointments } from "@/components/kani/v2/agenda";
export const Route = createFileRoute("/admin-v2/turnos")({ component: V2Appointments });
