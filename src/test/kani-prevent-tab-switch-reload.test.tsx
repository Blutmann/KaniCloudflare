import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';

type AuthCallback = (event: string, session: { user?: { id: string } } | null) => void;

const {
  authCallbacks,
  mockGetAuthenticatedStaff,
  mockClearStaffCache,
  outletMountCounter,
} = vi.hoisted(() => ({
  authCallbacks: [] as AuthCallback[],
  mockGetAuthenticatedStaff: vi.fn(),
  mockClearStaffCache: vi.fn(),
  outletMountCounter: { mounts: 0, unmounts: 0 },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string }) => (
    <a href={to ?? '#'} {...props}>
      {children}
    </a>
  ),
  Outlet: () => {
    const [tick] = useState(() => Math.random());
    useEffect(() => {
      outletMountCounter.mounts += 1;
      return () => {
        outletMountCounter.unmounts += 1;
      };
    }, []);
    return <div data-testid="outlet-child" data-instance={String(tick)}>Panel activo</div>;
  },
  useLocation: (opts?: { select?: (loc: { pathname: string; search: string }) => unknown }) => {
    const loc = { pathname: '/panel-administracion', search: '' };
    return opts?.select ? opts.select(loc) : loc;
  },
  useRouterState: () => '/panel-administracion',
  useRouter: () => ({ invalidate: vi.fn() }),
}));

vi.mock('motion/react', async () => {
  const React = await import('react');
  const cache = new Map<string, React.ForwardRefExoticComponent<Record<string, unknown>>>();
  const motionProxy = new Proxy(
    {},
    {
      get(_target, prop: string) {
        let comp = cache.get(prop);
        if (!comp) {
          comp = React.forwardRef(
            (
              {
                children,
                animate: _animate,
                transition: _transition,
                initial: _initial,
                exit: _exit,
                layoutId: _layoutId,
                ...rest
              }: Record<string, unknown>,
              ref,
            ) => React.createElement(prop, { ...rest, ref }, children as React.ReactNode),
          );
          cache.set(prop, comp);
        }
        return comp;
      },
    },
  );
  return {
    MotionConfig: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: motionProxy,
    useReducedMotion: () => true,
  };
});

vi.mock('@/components/kani/admin-access', () => ({
  AdminAccess: () => <div data-testid="admin-access-login">Iniciar sesión</div>,
}));

vi.mock('@/components/kani/v2/data', () => ({
  V2DataProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useV2: () => ({
    loading: false,
    error: '',
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/kani-auth', () => ({
  clearStaffCache: () => mockClearStaffCache(),
  getAuthenticatedStaff: (opts?: { bypassCache?: boolean }) => mockGetAuthenticatedStaff(opts),
}));

vi.mock('@/lib/kani-v2', () => ({
  isV2AdminEnvironment: vi.fn(() => true),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    supabaseUrl: 'https://example.supabase.co',
    auth: {
      onAuthStateChange: vi.fn((cb: AuthCallback) => {
        authCallbacks.push(cb);
        return {
          data: { subscription: { unsubscribe: vi.fn() } },
        };
      }),
    },
  },
}));

import { V2Layout } from '@/components/kani/v2/layout';

function makeStaff(userId: string, role: 'ADMIN' | 'MANAGER' | 'BARBER' = 'ADMIN', barberId: string | null = null) {
  return {
    user: { id: userId, email: `${userId}@kanibarber.com` },
    profile: {
      id: `profile-${userId}`,
      user_id: userId,
      display_name: `Staff ${userId}`,
      role,
      barber_id: barberId,
      is_active: true,
    },
    barbers: [],
  };
}

describe('V2Layout: evitar recarga al volver de otra pestaña o app', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authCallbacks.length = 0;
    outletMountCounter.mounts = 0;
    outletMountCounter.unmounts = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it('no muestra loader ni desmonta el Outlet cuando SIGNED_IN o USER_UPDATED llega para el mismo userId', async () => {
    const staffUser1 = makeStaff('user-1');
    mockGetAuthenticatedStaff.mockResolvedValue(staffUser1);

    render(<V2Layout />);

    await waitFor(() => {
      expect(screen.getByTestId('outlet-child')).toBeTruthy();
    });
    expect(document.querySelector('.v2-access-loading')).toBeNull();
    expect(outletMountCounter.mounts).toBe(1);
    expect(outletMountCounter.unmounts).toBe(0);
    const initialInstance = screen.getByTestId('outlet-child').getAttribute('data-instance');

    const cb = authCallbacks[0];
    expect(cb).toBeTypeOf('function');

    await act(async () => {
      cb('SIGNED_IN', { user: { id: 'user-1' } });
    });

    expect(document.querySelector('.v2-access-loading')).toBeNull();
    expect(screen.getByTestId('outlet-child').getAttribute('data-instance')).toBe(initialInstance);
    expect(outletMountCounter.mounts).toBe(1);
    expect(outletMountCounter.unmounts).toBe(0);
    expect(mockClearStaffCache).not.toHaveBeenCalled();

    await act(async () => {
      cb('USER_UPDATED', { user: { id: 'user-1' } });
    });

    expect(document.querySelector('.v2-access-loading')).toBeNull();
    expect(screen.getByTestId('outlet-child').getAttribute('data-instance')).toBe(initialInstance);
    expect(outletMountCounter.mounts).toBe(1);
    expect(outletMountCounter.unmounts).toBe(0);
  });

  it('sí limpia y muestra loader cuando cambia el userId y muestra login cuando SIGNED_OUT', async () => {
    const staffUser1 = makeStaff('user-1');
    const staffUser2 = makeStaff('user-2');
    mockGetAuthenticatedStaff.mockResolvedValueOnce(staffUser1);

    render(<V2Layout />);

    await waitFor(() => {
      expect(screen.getByTestId('outlet-child')).toBeTruthy();
    });

    const cb = authCallbacks[0];
    let resolveUser2!: (val: unknown) => void;
    mockGetAuthenticatedStaff.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUser2 = resolve;
        }),
    );

    await act(async () => {
      cb('SIGNED_IN', { user: { id: 'user-2' } });
    });

    expect(mockClearStaffCache).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.v2-access-loading')).not.toBeNull();
    expect(screen.queryByTestId('outlet-child')).toBeNull();
    expect(outletMountCounter.unmounts).toBe(1);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      resolveUser2(staffUser2);
    });

    await waitFor(() => {
      expect(screen.getByTestId('outlet-child')).toBeTruthy();
    });

    await act(async () => {
      cb('SIGNED_OUT', null);
    });

    expect(mockClearStaffCache).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('admin-access-login')).toBeTruthy();
    expect(screen.queryByTestId('outlet-child')).toBeNull();
  });
});
