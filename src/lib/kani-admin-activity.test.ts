import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      getUser: () => mockGetUser(),
    },
  },
}));

import {
  deleteAllAdminActivityNotificationsGlobal,
  dismissAllAdminActivityNotificationsPersonal,
} from './kani-admin-activity';

describe('kani-admin-activity bulk notifications management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('deleteAllAdminActivityNotificationsGlobal', () => {
    it('uses delete_all_staff_activity_notifications_global RPC when available', async () => {
      mockRpc.mockResolvedValue({
        data: 5,
        error: null,
      });

      const count = await deleteAllAdminActivityNotificationsGlobal();
      expect(mockRpc).toHaveBeenCalledWith('delete_all_staff_activity_notifications_global');
      expect(count).toBe(5);
    });

    it('falls back to direct table delete when RPC fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'function does not exist' },
      });

      const mockDelete = vi.fn().mockReturnValue({
        neq: vi.fn().mockResolvedValue({ error: null }),
      });
      mockFrom.mockReturnValue({
        delete: mockDelete,
      });

      const count = await deleteAllAdminActivityNotificationsGlobal();
      expect(mockRpc).toHaveBeenCalledWith('delete_all_staff_activity_notifications_global');
      expect(mockFrom).toHaveBeenCalledWith('admin_activity_notifications');
      expect(mockDelete).toHaveBeenCalled();
      expect(count).toBe(0);
    });

    it('throws error when both RPC and fallback fail', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failure' },
      });

      mockFrom.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          neq: vi.fn().mockResolvedValue({ error: new Error('RLS check failed') }),
        }),
      });

      await expect(deleteAllAdminActivityNotificationsGlobal()).rejects.toThrow('RLS check failed');
    });
  });

  describe('dismissAllAdminActivityNotificationsPersonal', () => {
    it('uses dismiss_all_staff_activity_notifications_personal RPC when available', async () => {
      mockRpc.mockResolvedValue({
        data: 3,
        error: null,
      });

      const count = await dismissAllAdminActivityNotificationsPersonal(['id-1', 'id-2']);
      expect(mockRpc).toHaveBeenCalledWith('dismiss_all_staff_activity_notifications_personal');
      expect(count).toBe(3);
    });

    it('falls back to admin_activity_user_state upsert when RPC fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failure' },
      });

      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-barber-uuid' } },
        error: null,
      });

      const mockUpsert = vi.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({
        upsert: mockUpsert,
      });

      const count = await dismissAllAdminActivityNotificationsPersonal(['id-1', 'id-2']);
      expect(mockFrom).toHaveBeenCalledWith('admin_activity_user_state');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ notification_id: 'id-1', user_id: 'user-barber-uuid' }),
          expect.objectContaining({ notification_id: 'id-2', user_id: 'user-barber-uuid' }),
        ])
      );
      expect(count).toBe(2);
    });
  });
});
