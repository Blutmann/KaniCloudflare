import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useAdminStaff } from '@/lib/kani-admin-context';

export const Route = createFileRoute('/panel-administracion-old/')({
  component: StaffLandingOld,
});

function StaffLandingOld() {
  const { profile } = useAdminStaff();
  return (
    <Navigate
      to={profile.role === 'ADMIN' ? '/panel-administracion-old/inicio' : '/panel-administracion-old/turnos'}
    />
  );
}
