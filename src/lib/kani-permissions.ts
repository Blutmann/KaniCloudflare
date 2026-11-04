/** UI scope only. Database policies and RPCs independently enforce these permissions. */
export type KaniStaffRole = 'ADMIN' | 'MANAGER' | 'BARBER';
export type StaffScope = { role: string; barber_id: string | null; active?: boolean };

export function isStaffOperator(role: string): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}

export function validStaffScope(profile: StaffScope): boolean {
  if (profile.active === false) return false;
  return profile.role === 'BARBER'
    ? Boolean(profile.barber_id)
    : isStaffOperator(profile.role) && profile.barber_id === null;
}

export function mayManageBarber(profile: StaffScope, barberId: string): boolean {
  return validStaffScope(profile) && (isStaffOperator(profile.role) || profile.barber_id === barberId);
}

export function mayAccessStaffSection(profile: StaffScope, section: string): boolean {
  if (!validStaffScope(profile)) return false;
  if (section === 'mantenimiento' || section === 'roles') return profile.role === 'ADMIN';
  if (section === 'descuentos') return isStaffOperator(profile.role);
  return ['inicio','turnos','horarios','clientes','pagos','datos'].includes(section);
}

export function mayDeleteOperationalRecord(profile: StaffScope): boolean {
  return validStaffScope(profile) && isStaffOperator(profile.role);
}
