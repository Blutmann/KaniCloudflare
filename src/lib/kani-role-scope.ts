import { barbers, type Barber } from './kani-model';
import type { StaffBarber, StaffProfile } from './kani-auth';

function knownBarber(name: string): Barber | null {
  return (barbers as readonly string[]).includes(name) ? name as Barber : null;
}

export function permittedBarberNames(profile: Pick<StaffProfile, 'role' | 'barber_id'>, rows: StaffBarber[]): Barber[] {
  const scopedRows = profile.role === 'BARBER'
    ? rows.filter(row => row.id === profile.barber_id)
    : rows;

  return scopedRows
    .map(row => knownBarber(row.name))
    .filter((name): name is Barber => Boolean(name));
}
