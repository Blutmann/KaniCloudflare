import { createFileRoute } from '@tanstack/react-router';
import { V2Appointments } from '@/components/kani/v2/agenda';

export const Route = createFileRoute('/panel-administracion-old/turnos')({
  component: () => <V2Appointments paymentsTo="/panel-administracion-old/pagos" />,
});
