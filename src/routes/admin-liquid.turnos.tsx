import { createFileRoute } from '@tanstack/react-router';
import { V2Appointments } from '@/components/kani/v2/agenda';

export const Route = createFileRoute('/admin-liquid/turnos')({
  component: () => <V2Appointments paymentsTo="/admin-liquid/pagos" />,
});
