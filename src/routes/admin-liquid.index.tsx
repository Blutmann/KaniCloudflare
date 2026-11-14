import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useAdminStaff } from '@/lib/kani-admin-context';

export const Route = createFileRoute('/admin-liquid/')({
  component: StaffLandingLiquid,
});

function StaffLandingLiquid() {
  const { profile } = useAdminStaff();
  return (
    <Navigate
      to={profile.role === 'ADMIN' ? '/admin-liquid/inicio' : '/admin-liquid/turnos'}
    />
  );
}
