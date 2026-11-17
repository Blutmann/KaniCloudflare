import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockRoleState,
  mockUserRpc,
  mockServiceFrom,
} = vi.hoisted(() => ({
  mockRoleState: {
    role: 'BARBER',
    active: true,
    userId: 'u-barber-1',
    displayName: 'Lautaro',
    barberId: 'lautaro',
  },
  mockUserRpc: vi.fn(),
  mockServiceFrom: vi.fn(),
}));

vi.mock('@/lib/kani-payment-db.server', () => ({
  createPaymentSupabaseClient: vi.fn(async () => ({
    from: mockServiceFrom,
  })),
}));

vi.mock('@/lib/kani-notifications.server', () => ({
  getRequestAuthToken: vi.fn(() => 'tok-header'),
  createRequestSupabaseClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: mockRoleState.userId } },
        error: null,
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: {
              role: mockRoleState.role,
              display_name: mockRoleState.displayName,
              active: mockRoleState.active,
              barber_id: mockRoleState.barberId,
            },
            error: null,
          })),
        })),
      })),
    })),
    rpc: mockUserRpc,
  })),
}));

import {
  staffListBenefitCodesReadOnly,
  adminCreateBenefitCode,
  adminToggleBenefitCodeStatus,
  adminDeleteBenefitCode,
  adminUpdateBenefitCodeValidity,
} from '@/lib/kani-benefit-codes.server';

function makeSelectChain(rows: unknown[], error: unknown = null) {
  const order = vi.fn(async () => ({ data: rows, error }));
  const not = vi.fn(() => ({ order }));
  const or = vi.fn(async () => ({ data: [], error: null }));
  const select = vi.fn(() => ({ order, not, or }));
  return { select };
}

describe('kani-benefit-codes.server — BARBER read-only & ADMIN-only mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoleState.role = 'BARBER';
    mockRoleState.active = true;
    mockUserRpc.mockResolvedValue({ data: null, error: { message: 'OPERATOR_REQUIRED' } });
  });

  it('allows BARBER to list benefit codes and usage history via server query without triggering OPERATOR_REQUIRED', async () => {
    const benefitCodeRows = [
      {
        id: 'bc-1',
        code: 'KANI10',
        type: 'PERCENT_10',
        status: 'ACTIVE',
        usage_mode: 'REUSABLE',
        validity_type: 'FIXED_END',
        valid_from: '2026-11-01T00:00:00Z',
        valid_until: '2026-12-31T23:59:59Z',
        created_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-01T10:00:00Z',
      },
      {
        id: 'bc-2',
        code: 'KANI50',
        type: 'PERCENT_50',
        status: 'DISABLED',
        usage_mode: 'SINGLE_USE',
        validity_type: 'NO_EXPIRATION',
        valid_from: '2026-10-01T00:00:00Z',
        valid_until: null,
        created_at: '2026-10-01T10:00:00Z',
        updated_at: '2026-10-01T10:00:00Z',
      },
      {
        id: 'bc-deleted',
        code: 'KANIDEL',
        type: 'PERCENT_10',
        status: 'DISABLED',
        deleted_at: '2026-11-05T10:00:00Z',
        created_at: '2026-10-01T10:00:00Z',
      },
    ];

    const appointmentRows = [
      {
        id: 'appt-1',
        request_number: 101,
        booking_date: '2026-11-10',
        start_time: '15:00:00',
        status: 'CONFIRMED',
        created_at: '2026-11-09T12:00:00Z',
        benefit_code_id: 'bc-1',
        benefit_code: 'KANI10',
        client_id: 'cli-1',
        clients: { id: 'cli-1', name: 'Marcos Díaz', phone: '+5491112345678', email: null },
        services: { name: 'Corte de pelo' },
        barbers: { name: 'Lautaro' },
      },
      {
        id: 'appt-cancelled',
        request_number: 102,
        booking_date: '2026-11-11',
        start_time: '16:00:00',
        status: 'CANCELLED',
        created_at: '2026-11-09T13:00:00Z',
        benefit_code_id: 'bc-1',
        benefit_code: 'KANI10',
        client_id: 'cli-2',
        clients: { id: 'cli-2', name: 'Cancelado', phone: null, email: null },
        services: { name: 'Corte de pelo' },
        barbers: { name: 'Lautaro' },
      },
    ];

    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'benefit_codes') return makeSelectChain(benefitCodeRows);
      if (table === 'payments') return makeSelectChain([]);
      if (table === 'appointments') return makeSelectChain(appointmentRows);
      return makeSelectChain([]);
    });

    const result = await staffListBenefitCodesReadOnly('tok-barber');

    expect(mockUserRpc).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.code)).toEqual(['KANI10', 'KANI50']);
    expect(result[0].timesUsed).toBe(1);
    expect(result[0].usages).toHaveLength(1);
    expect(result[0].usages[0].clientName).toBe('Marcos Díaz');
    expect(result[0].usages[0].barberName).toBe('Lautaro');
  });

  it('allows MANAGER and ADMIN to read benefit codes via staffListBenefitCodesReadOnly', async () => {
    mockServiceFrom.mockImplementation((table: string) => {
      if (table === 'benefit_codes') {
        return makeSelectChain([{ id: 'bc-1', code: 'MGR10', type: 'PERCENT_10', status: 'ACTIVE' }]);
      }
      return makeSelectChain([]);
    });

    mockRoleState.role = 'MANAGER';
    const mgrRows = await staffListBenefitCodesReadOnly('tok-mgr');
    expect(mgrRows.map((r) => r.code)).toEqual(['MGR10']);

    mockRoleState.role = 'ADMIN';
    const adminRows = await staffListBenefitCodesReadOnly('tok-admin');
    expect(adminRows.map((r) => r.code)).toEqual(['MGR10']);
  });

  it('strictly blocks all benefit code mutations for BARBER and MANAGER', async () => {
    for (const role of ['BARBER', 'MANAGER'] as const) {
      mockRoleState.role = role;

      await expect(
        adminCreateBenefitCode({ type: 'PERCENT_10', internalNote: 'test' }, 'tok'),
      ).rejects.toThrow(/UNAUTHORIZED_ADMIN_ONLY/);

      await expect(
        adminToggleBenefitCodeStatus({ id: 'bc-1', status: 'DISABLED' }, 'tok'),
      ).rejects.toThrow(/UNAUTHORIZED_ADMIN_ONLY/);

      await expect(
        adminDeleteBenefitCode('bc-1', 'tok'),
      ).rejects.toThrow(/UNAUTHORIZED_ADMIN_ONLY/);

      await expect(
        adminUpdateBenefitCodeValidity({ id: 'bc-1', validityType: 'NO_EXPIRATION' }, 'tok'),
      ).rejects.toThrow(/UNAUTHORIZED_ADMIN_ONLY/);
    }
  });
});
