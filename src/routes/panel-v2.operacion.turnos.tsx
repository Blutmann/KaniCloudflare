import { createFileRoute } from "@tanstack/react-router";
import { V2Appointments } from "@/components/kani/v2/agenda";

export const Route = createFileRoute("/panel-v2/operacion/turnos")({
  component: () => <V2Appointments paymentsTo="/panel-v2/negocio/pagos" />,
});
