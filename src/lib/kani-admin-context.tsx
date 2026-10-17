import { createContext, useContext, useState, type ReactNode } from 'react';
import type { AuthenticatedStaff } from './kani-auth';

type AdminStaffContextValue = AuthenticatedStaff & {
  staff: AuthenticatedStaff;
  refreshCount: number;
  triggerRefresh: () => void;
  isRefreshing: boolean;
  setIsRefreshing: (val: boolean) => void;
};

const AdminStaffContext = createContext<AdminStaffContextValue | null>(null);

export function AdminStaffProvider({ staff, children }: { staff: AuthenticatedStaff; children: ReactNode }) {
  const [refreshCount, setRefreshCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const triggerRefresh = () => setRefreshCount((c) => c + 1);

  const value: AdminStaffContextValue = {
    ...staff,
    staff,
    refreshCount,
    triggerRefresh,
    isRefreshing,
    setIsRefreshing,
  };

  return <AdminStaffContext.Provider value={value}>{children}</AdminStaffContext.Provider>;
}

export function useAdminStaff() {
  const ctx = useContext(AdminStaffContext);
  if (!ctx) throw new Error('Admin staff context is missing');
  return ctx;
}

