import { describe, expect, it } from 'vitest';
import { mayAccessStaffSection, mayDeleteOperationalRecord, mayManageBarber, validStaffScope } from './kani-permissions';
const barber = { role: 'BARBER', barber_id: 'barber-1' };
const manager = { role: 'MANAGER', barber_id: null };
const admin = { role: 'ADMIN', barber_id: null };

describe('staff authorization scopes', () => {
  it('restricts each barber to their permanent barber ID', () => {
    expect(mayManageBarber(barber,'barber-1')).toBe(true);
    expect(mayManageBarber(barber,'barber-2')).toBe(false);
    expect(mayDeleteOperationalRecord(barber)).toBe(false);
    expect(mayAccessStaffSection(barber,'descuentos')).toBe(false);
    expect(mayAccessStaffSection(barber,'mantenimiento')).toBe(false);
  });
  it('allows manager operations without granting maintenance or role administration', () => {
    expect(mayManageBarber(manager,'barber-2')).toBe(true);
    expect(mayDeleteOperationalRecord(manager)).toBe(true);
    expect(mayAccessStaffSection(manager,'descuentos')).toBe(true);
    expect(mayAccessStaffSection(manager,'mantenimiento')).toBe(false);
    expect(mayAccessStaffSection(manager,'roles')).toBe(false);
  });
  it('retains administrator access', () => {
    for (const section of ['inicio','turnos','horarios','clientes','pagos','datos','descuentos','mantenimiento','roles']) {
      expect(mayAccessStaffSection(admin,section)).toBe(true);
    }
  });
  it('fails closed for inactive, unknown and inconsistent profiles', () => {
    for (const profile of [{role:'OWNER',barber_id:null}, {...barber,barber_id:null}, {...manager,barber_id:'barber-1'}, {...admin,active:false}]) {
      expect(validStaffScope(profile)).toBe(false);
      expect(mayAccessStaffSection(profile,'pagos')).toBe(false);
      expect(mayManageBarber(profile,'barber-1')).toBe(false);
      expect(mayDeleteOperationalRecord(profile)).toBe(false);
    }
    expect(mayAccessStaffSection(admin,'unknown')).toBe(false);
  });
});
