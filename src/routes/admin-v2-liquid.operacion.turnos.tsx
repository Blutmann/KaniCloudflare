import { createFileRoute } from '@tanstack/react-router';
import { V2Appointments } from '@/components/kani/v2/agenda';

export const Route = createFileRoute('/admin-v2-liquid/operacion/turnos')({
  component: () => <V2Appointments paymentsTo="/admin-v2-liquid/negocio/pagos" />,
});
