import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAdminStaff } from '@/lib/kani-admin-context';

export const Route = createFileRoute("/panel-administracion/")({
  component: StaffLanding,
});

function StaffLanding() {
  const { profile } = useAdminStaff();
  return <Navigate to={profile.role === 'ADMIN' ? '/panel-administracion/inicio' : '/panel-administracion/turnos'} />;
}
