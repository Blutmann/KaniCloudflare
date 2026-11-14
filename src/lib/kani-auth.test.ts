import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSession = vi.fn();
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { clearStaffCache, getAuthenticatedStaff } from './kani-auth';

describe('kani-auth — dedup, parallel validation & reactive broadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStaffCache();
  });

  it('ejecuta getUser, staff_profiles y barbers en paralelo, deduplica llamadas concurrentes y emite evento reactivo', async () => {
    const mockUser = { id: 'user-admin-1', email: 'admin@kani.test' };
    const mockProfile = {
      user_id: 'user-admin-1',
      role: 'ADMIN',
      barber_id: null,
      display_name: 'KANI Admin',
      active: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const mockBarbers = [
      { id: 'b2', name: 'Gonzalo', active: true, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'b1', name: 'Lautaro', active: true, created_at: '2026-01-01T00:00:00.000Z' },
    ];

    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'jwt-123',
          expires_in: 3600,
          user: mockUser,
        },
      },
    });
    mockGetUser.mockResolvedValue({
      data: { user: mockUser },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'staff_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockProfile, error: null }),
            }),
          }),
        };
      }
      if (table === 'barbers') {
        return {
          select: () => ({
            eq: async () => ({ data: mockBarbers, error: null }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const events: unknown[] = [];
    const listener = (e: Event) => {
      events.push((e as CustomEvent).detail?.staff);
    };
    window.addEventListener('kani:staff-auth-changed', listener);

    const [a, b] = await Promise.all([getAuthenticatedStaff(), getAuthenticatedStaff()]);

    window.removeEventListener('kani:staff-auth-changed', listener);

    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(a?.barbers.map((barber) => barber.name)).toEqual(['Lautaro', 'Gonzalo']);
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockGetUser).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect((events[0] as any)?.user?.id).toBe('user-admin-1');
  });

  it('no cachea null cuando no hay sesión activa para no bloquear un login inmediato', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    const first = await getAuthenticatedStaff();
    expect(first).toBeNull();

    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'jwt-456',
          expires_in: 3600,
          user: { id: 'user-2', email: 'barber@kani.test' },
        },
      },
    });
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-2', email: 'barber@kani.test' } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'staff_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  user_id: 'user-2',
                  role: 'BARBER',
                  barber_id: 'b1',
                  display_name: 'Lautaro',
                  active: true,
                  created_at: '2026-01-01T00:00:00.000Z',
                  updated_at: '2026-01-01T00:00:00.000Z',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'barbers') {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                { id: 'b1', name: 'Lautaro', active: true, created_at: '2026-01-01T00:00:00.000Z' },
                { id: 'b2', name: 'Gonzalo', active: true, created_at: '2026-01-01T00:00:00.000Z' },
              ],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const second = await getAuthenticatedStaff();
    expect(second?.profile.role).toBe('BARBER');
    expect(second?.barbers).toHaveLength(1);
    expect(second?.barbers[0]?.id).toBe('b1');
  });
});
