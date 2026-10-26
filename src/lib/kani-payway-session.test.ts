import { describe, expect, it, vi } from 'vitest';
vi.mock('@tanstack/react-start/server',()=>({getCookie:vi.fn(),setCookie:vi.fn()}));
import { openPaywaySession, sealPaywaySession } from './kani-payway-session.server';

const secret='synthetic-checkout-secret-for-tests-only';
const session={appointmentId:'123e4567-e89b-42d3-a456-426614174000',accessToken:'x'.repeat(64),expiresAt:Date.now()+60000};
describe('encrypted checkout ownership',()=>{
  it('roundtrips without exposing the capability or appointment in the cookie',async()=>{
    const cookie=await sealPaywaySession(session,secret);
    expect(cookie).not.toContain(session.accessToken);expect(cookie).not.toContain(session.appointmentId);
    expect(await openPaywaySession(cookie,secret)).toEqual(session);
    expect(await sealPaywaySession(session,secret)).not.toBe(cookie);
  });
  it('rejects tampering, another secret, expiry and malformed cookies',async()=>{
    const cookie=await sealPaywaySession(session,secret);
    expect(await openPaywaySession(cookie.slice(0,-8)+'AAAAAAAA',secret)).toBeNull();
    expect(await openPaywaySession(cookie,secret+'different')).toBeNull();
    expect(await openPaywaySession(await sealPaywaySession({...session,expiresAt:1},secret),secret)).toBeNull();
    expect(await openPaywaySession('invalid',secret)).toBeNull();
    expect(await openPaywaySession(undefined,secret)).toBeNull();
  });
  it('refuses a missing/weak configuration',async()=>{
    await expect(sealPaywaySession(session,'short')).rejects.toThrow('CONFIGURATION_MISSING');
  });
});
