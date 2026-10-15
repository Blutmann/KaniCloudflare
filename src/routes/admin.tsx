import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AdminAccess } from '@/components/kani/admin-access';
import { getAuthenticatedStaff, signOut, type AuthenticatedStaff } from '@/lib/kani-auth';
import { AdminStaffProvider } from '@/lib/kani-admin-context';
import { supabase } from '@/integrations/supabase/client';
import { AdminSectionNav } from '@/components/kani/admin-section-nav';

export const Route = createFileRoute('/admin')({
  component: AdminLayout,
});

type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'unauthorized' }
  | { status: 'authorized'; staff: AuthenticatedStaff };

function AdminLayout() {
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });

  async function refreshAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setAuthState({ status: 'signed-out' });
      return;
    }

    const staff = await getAuthenticatedStaff();
    setAuthState(staff ? { status: 'authorized', staff } : { status: 'unauthorized' });
  }

  useEffect(() => {
    void refreshAuth();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      // Evita ejecutar una segunda operación Supabase dentro del callback de Auth.
      window.setTimeout(() => void refreshAuth(), 0);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (authState.status === 'loading') {
    return <main className="site-container admin-page"><div className="py-12 text-center text-muted-foreground">Verificando sesión…</div></main>;
  }

  if (authState.status === 'signed-out') {
    return <AdminAccess onAuthenticated={() => void refreshAuth()} />;
  }

  if (authState.status === 'unauthorized') {
    return (
      <main className="site-container admin-page">
        <div className="mx-auto max-w-sm py-12 text-center">
          <h1 className="eyebrow">ACCESO NO AUTORIZADO</h1>
          <p className="mt-4 text-sm text-muted-foreground">Esta cuenta no tiene un perfil interno activo en Kani Barber Studio.</p>
          <Button className="mt-7" onClick={() => void signOut()}>Cerrar sesión</Button>
        </div>
      </main>
    );
  }

  return (
    <AdminStaffProvider staff={authState.staff}>
      <div className="admin-shell">
        <AdminSectionNav />
        <Outlet />
      </div>
    </AdminStaffProvider>
  );
}
