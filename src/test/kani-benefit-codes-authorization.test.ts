import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/kani-notifications.server', () => ({
  getRequestAuthToken: vi.fn(),
  createRequestSupabaseClient: vi.fn().mockImplementation(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

vi.mock('@/lib/kani-payment-db.server', () => ({
  createPaymentSupabaseClient: vi.fn().mockImplementation(async () => ({
    rpc: mockRpc,
  })),
}));

import {
  assertAdminSession,
  adminListBenefitCodes,
  adminCreateBenefitCode,
  adminDisableBenefitCode,
} from '@/lib/kani-benefit-codes.server';

describe('Benefit Codes Server Authorization Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assertAdminSession', () => {
    it('throws AUTH_REQUIRED when no session token is provided or found in headers', async () => {
      await expect(assertAdminSession(undefined)).rejects.toThrow('AUTH_REQUIRED');
      await expect(assertAdminSession('')).rejects.toThrow('AUTH_REQUIRED');
    });

    it('throws SESSION_INVALID when token fails Supabase verification', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'invalid token', status: 401 },
      });

      await expect(assertAdminSession('invalid-jwt-token')).rejects.toThrow('SESSION_EXPIRED');
    });

    it('throws UNAUTHORIZED_ADMIN_ONLY when authenticated user has role BARBER', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'user-barber-uuid', email: 'barbero@kanibarber.com' } },
        error: null,
      });

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'BARBER', display_name: 'Barbero Kani', active: true },
              error: null,
            }),
          }),
        }),
      });

      await expect(assertAdminSession('barber-jwt-token')).rejects.toThrow('UNAUTHORIZED_ADMIN_ONLY');
    });

    it('throws UNAUTHORIZED_ADMIN_ONLY when profile is inactive even if role is ADMIN', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'user-inactive-uuid', email: 'inactivo@kanibarber.com' } },
        error: null,
      });

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'ADMIN', display_name: 'Admin Inactivo', active: false },
              error: null,
            }),
          }),
        }),
      });

      await expect(assertAdminSession('inactive-admin-token')).rejects.toThrow('UNAUTHORIZED_ADMIN_ONLY');
    });

    it('succeeds and returns session context when user has active ADMIN profile', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'user-admin-uuid', email: 'admin@kanibarber.com' } },
        error: null,
      });

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'ADMIN', display_name: 'Lautaro Admin', active: true },
              error: null,
            }),
          }),
        }),
      });

      const session = await assertAdminSession('valid-admin-jwt');
      expect(session.userId).toBe('user-admin-uuid');
      expect(session.profile.role).toBe('ADMIN');
      expect(session.token).toBe('valid-admin-jwt');
    });
  });

  describe('Admin Operations strictly enforce ADMIN authorization', () => {
    it('adminListBenefitCodes rejects unauthenticated or BARBER calls and allows ADMIN', async () => {
      // 1. Unauthenticated -> fails
      await expect(adminListBenefitCodes('')).rejects.toThrow('AUTH_REQUIRED');

      // 2. Barber -> fails
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'barber-id' } },
        error: null,
      });
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'BARBER', active: true },
              error: null,
            }),
          }),
        }),
      });
      await expect(adminListBenefitCodes('barber-token')).rejects.toThrow('UNAUTHORIZED_ADMIN_ONLY');

      // 3. Admin -> succeeds
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'admin-id' } },
        error: null,
      });
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'ADMIN', active: true },
              error: null,
            }),
          }),
        }),
      });
      mockRpc.mockResolvedValueOnce({
        data: [{ id: 'code-1', code: 'KANI-TEST-0001', status: 'ACTIVE' }],
        error: null,
      });

      const list = await adminListBenefitCodes('admin-token');
      expect(list).toHaveLength(1);
      expect(list[0].code).toBe('KANI-TEST-0001');
      expect(mockRpc).toHaveBeenCalledWith('admin_list_benefit_codes');
    });

    it('adminCreateBenefitCode enforces ADMIN session and executes RPC', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'admin-id' } },
        error: null,
      });
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'ADMIN', active: true },
              error: null,
            }),
          }),
        }),
      });
      mockRpc.mockResolvedValueOnce({
        data: { id: 'new-id', code: 'KANI-NOVA-1234', type: 'PERCENT_50', status: 'ACTIVE' },
        error: null,
      });

      const created = await adminCreateBenefitCode({
        type: 'PERCENT_50',
        internalNote: 'Cliente especial',
        code: 'KANI-NOVA-1234',
        token: 'admin-token',
      });

      expect(created.code).toBe('KANI-NOVA-1234');
      expect(mockRpc).toHaveBeenCalledWith('admin_create_benefit_code', expect.objectContaining({
        p_type: 'PERCENT_50',
        p_internal_note: 'Cliente especial',
        p_code: 'KANI-NOVA-1234',
      }));
    });

    it('adminDisableBenefitCode enforces ADMIN session and executes RPC', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'admin-id' } },
        error: null,
      });
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'ADMIN', active: true },
              error: null,
            }),
          }),
        }),
      });
      mockRpc.mockResolvedValueOnce({
        data: true,
        error: null,
      });

      const disabled = await adminDisableBenefitCode('code-id-123', 'admin-token');
      expect(disabled).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith('admin_disable_benefit_code', {
        p_code_id: 'code-id-123',
      });
    });
  });
});
