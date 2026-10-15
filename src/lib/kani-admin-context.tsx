import { createContext, useContext, type ReactNode } from 'react';
import type { AuthenticatedStaff } from './kani-auth';

const AdminStaffContext = createContext<AuthenticatedStaff | null>(null);

export function AdminStaffProvider({ staff, children }: { staff: AuthenticatedStaff; children: ReactNode }) {
  return <AdminStaffContext.Provider value={staff}>{children}</AdminStaffContext.Provider>;
}

export function useAdminStaff() {
  const staff = useContext(AdminStaffContext);
  if (!staff) throw new Error('Admin staff context is missing');
  return staff;
}
