import { describe, expect, it } from 'vitest';
import { permittedBarberNames } from './kani-role-scope';

const rows = [
  { id: 'lautaro-id', name: 'Lautaro', active: true, created_at: '' },
  { id: 'gonzalo-id', name: 'Gonzalo', active: true, created_at: '' },
  { id: 'valentin-id', name: 'Valentín', active: true, created_at: '' },
];

describe('KANI admin role scope', () => {
  it('BARBER only receives the barber matching staff_profiles.barber_id', () => {
    expect(permittedBarberNames({ role: 'BARBER', barber_id: 'lautaro-id' }, rows)).toEqual(['Lautaro']);
    expect(permittedBarberNames({ role: 'BARBER', barber_id: 'gonzalo-id' }, rows)).toEqual(['Gonzalo']);
  });

  it('BARBER with a different or missing barber_id receives no agenda', () => {
    expect(permittedBarberNames({ role: 'BARBER', barber_id: 'other-id' }, rows)).toEqual([]);
    expect(permittedBarberNames({ role: 'BARBER', barber_id: null }, rows)).toEqual([]);
  });

  it('ADMIN receives all active barbers returned by the protected query', () => {
    expect(permittedBarberNames({ role: 'ADMIN', barber_id: null }, rows)).toEqual(['Lautaro', 'Gonzalo', 'Valentín']);
  });
});
