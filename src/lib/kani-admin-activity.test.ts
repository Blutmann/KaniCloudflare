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
  deleteAdminActivityNotificationGlobal,
  dismissAllAdminActivityNotificationsPersonal,
  dismissAdminActivityNotificationPersonal,
  extractErrorMessage,
  markAllAdminActivityNotificationsRead,
  markAllAdminActivityNotificationsUnread,
  readAdminActivityNotifications,
  setAdminActivityNotificationRead,
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

  describe('markAllAdminActivityNotificationsUnread', () => {
    it('uses mark_all_staff_activity_notifications_unread RPC when available', async () => {
      mockRpc.mockResolvedValue({
        data: 4,
        error: null,
      });

      await markAllAdminActivityNotificationsUnread();
      expect(mockRpc).toHaveBeenCalledWith('mark_all_staff_activity_notifications_unread');
    });

    it('falls back to admin_activity_user_state update when RPC fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC not found' },
      });

      mockGetUser.mockResolvedValue({
        data: { user: { id: 'test-user-id' } },
        error: null,
      });

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
        neq: vi.fn().mockResolvedValue({ error: null }),
      });
      mockFrom.mockReturnValue({
        update: mockUpdate,
      });

      await markAllAdminActivityNotificationsUnread();
      expect(mockFrom).toHaveBeenCalledWith('admin_activity_user_state');
    });
  });

  describe('deleteAdminActivityNotificationGlobal', () => {
    it('uses delete_staff_activity_notification_global RPC when available', async () => {
      mockRpc.mockResolvedValue({
        data: true,
        error: null,
      });

      await deleteAdminActivityNotificationGlobal('notif-123');
      expect(mockRpc).toHaveBeenCalledWith('delete_staff_activity_notification_global', {
        p_notification_id: 'notif-123',
      });
    });

    it('falls back to direct table delete when RPC fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failure' },
      });

      const mockDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      mockFrom.mockReturnValue({
        delete: mockDelete,
      });

      await deleteAdminActivityNotificationGlobal('notif-123');
      expect(mockFrom).toHaveBeenCalledWith('admin_activity_notifications');
      expect(mockDelete).toHaveBeenCalled();
    });

    it('falls back to personal dismissal in user_state if table delete fails with RLS/permissions', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failure' },
      });

      mockFrom.mockImplementation((tableName: string) => {
        if (tableName === 'admin_activity_notifications') {
          return {
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: { message: 'permission denied', code: '42501' } }),
            }),
          };
        }
        if (tableName === 'admin_activity_user_state') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-uuid' } },
        error: null,
      });

      // Should succeed via secondary fallback
      await expect(deleteAdminActivityNotificationGlobal('notif-123')).resolves.not.toThrow();
    });
  });

  describe('setAdminActivityNotificationRead', () => {
    it('uses set_staff_activity_notification_read RPC when available', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: null,
      });

      await setAdminActivityNotificationRead('notif-1', '2026-10-18T12:00:00Z');
      expect(mockRpc).toHaveBeenCalledWith('set_staff_activity_notification_read', {
        p_notification_id: 'notif-1',
        p_read_at: '2026-10-18T12:00:00Z',
      });
    });

    it('falls back to direct table update and user_state upsert when RPC fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC not found' },
      });

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      mockFrom.mockReturnValue({
        update: mockUpdate,
      });

      await setAdminActivityNotificationRead('notif-1', '2026-10-18T12:00:00Z');
      expect(mockFrom).toHaveBeenCalledWith('admin_activity_notifications');
      expect(mockUpdate).toHaveBeenCalledWith({ read_at: '2026-10-18T12:00:00Z' });
    });
  });

  describe('markAllAdminActivityNotificationsRead', () => {
    it('uses mark_all_staff_activity_notifications_read RPC when available', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: null,
      });

      await markAllAdminActivityNotificationsRead();
      expect(mockRpc).toHaveBeenCalledWith('mark_all_staff_activity_notifications_read');
    });

    it('falls back to bulk table update when RPC fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC not found' },
      });

      const mockUpdate = vi.fn().mockReturnValue({
        is: vi.fn().mockResolvedValue({ error: null }),
      });
      mockFrom.mockReturnValue({
        update: mockUpdate,
      });

      await markAllAdminActivityNotificationsRead();
      expect(mockFrom).toHaveBeenCalledWith('admin_activity_notifications');
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ read_at: expect.any(String) }));
    });
  });

  describe('extractErrorMessage', () => {
    it('extracts error from Error object', () => {
      expect(extractErrorMessage(new Error('Test error message'))).toBe('Test error message');
    });

    it('extracts message from PostgREST-like error object', () => {
      expect(extractErrorMessage({ message: 'permission denied for table', code: '42501' })).toBe('permission denied for table');
    });

    it('extracts details or hint when available', () => {
      expect(extractErrorMessage({ details: 'Key (id)=(1) not found' })).toBe('Key (id)=(1) not found');
    });

    it('returns string input directly', () => {
      expect(extractErrorMessage('Direct string error')).toBe('Direct string error');
    });

    it('returns fallback for unknown or empty input', () => {
      expect(extractErrorMessage(null, 'Fallback error')).toBe('Fallback error');
      expect(extractErrorMessage({}, 'Fallback error')).toBe('Fallback error');
    });
  });

  describe('Persistent storage error handling and fallback resilience', () => {
    it('successfully persists deletion via admin_activity_user_state when direct table delete fails with 42501', async () => {
      // Mock RPC missing
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'function does not exist', code: 'PGRST202' },
      });

      // Mock table delete returning 42501
      mockFrom.mockImplementation((table: string) => {
        if (table === 'admin_activity_notifications') {
          return {
            delete: () => ({
              eq: () => Promise.resolve({
                error: { message: 'permission denied for table admin_activity_notifications', code: '42501' },
              }),
            }),
            select: () => ({
              order: () => ({
                limit: () => Promise.resolve({
                  data: [
                    { id: 'notif-perm-1', event_type: 'APPOINTMENT_REQUESTED', created_at: new Date().toISOString(), read_at: null },
                    { id: 'notif-perm-2', event_type: 'APPOINTMENT_CONFIRMED', created_at: new Date().toISOString(), read_at: null },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'admin_activity_user_state') {
          return {
            select: () => ({
              eq: () => Promise.resolve({
                data: [{ notification_id: 'notif-perm-1', dismissed_at: new Date().toISOString(), read_at: null }],
                error: null,
              }),
            }),
            upsert: () => Promise.resolve({
              error: null,
            }),
          };
        }
        return {};
      });

      mockGetUser.mockResolvedValue({
        data: { user: { id: 'admin-user-uuid' } },
        error: null,
      });

      // Delete notif-perm-1
      await expect(deleteAdminActivityNotificationGlobal('notif-perm-1')).resolves.not.toThrow();

      // Read notifications should filter out notif-perm-1 based on user_state dismissal in DB
      const result = await readAdminActivityNotifications();
      expect(result.some(n => n.id === 'notif-perm-1')).toBe(false);
      expect(result.some(n => n.id === 'notif-perm-2')).toBe(true);
    });

    it('rejects and does not falsely confirm deletion when DB storage fails to update completely', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'function does not exist', code: 'PGRST202' },
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'admin_activity_notifications') {
          return {
            delete: () => ({
              eq: () => Promise.resolve({
                error: { message: 'permission denied for table admin_activity_notifications', code: '42501' },
              }),
              in: () => Promise.resolve({
                error: { message: 'permission denied for table admin_activity_notifications', code: '42501' },
              }),
              neq: () => Promise.resolve({
                error: { message: 'permission denied for table admin_activity_notifications', code: '42501' },
              }),
            }),
          };
        }
        if (table === 'admin_activity_user_state') {
          return {
            upsert: () => Promise.resolve({
              error: { message: "Could not find table 'public.admin_activity_user_state'", code: 'PGRST205' },
            }),
          };
        }
        return {};
      });

      mockGetUser.mockResolvedValue({
        data: { user: { id: 'admin-user-uuid' } },
        error: null,
      });

      // Individual deletion must reject if backend storage could not be updated
      await expect(deleteAdminActivityNotificationGlobal('notif-failed')).rejects.toThrow(
        /permission denied|Could not find table|No se pudo eliminar/
      );

      // Bulk deletion must reject if backend storage could not be updated
      await expect(deleteAllAdminActivityNotificationsGlobal(['notif-failed'])).rejects.toThrow(
        /permission denied|Could not find table|No se pudieron eliminar/
      );
    });

    it('persists deletion across page reload and re-login even when local storage is wiped', async () => {
      // Setup: DB has notification 1 and 2, and RPC delete works
      mockRpc.mockImplementation((rpcName: string) => {
        if (rpcName === 'delete_staff_activity_notification_global') {
          return Promise.resolve({ error: null });
        }
        if (rpcName === 'read_staff_activity_notifications') {
          // DB only returns notif-2 because notif-1 was deleted in database
          return Promise.resolve({
            data: [
              { id: 'notif-2', event_type: 'APPOINTMENT_REQUESTED', created_at: new Date().toISOString(), read_at: null },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      mockGetUser.mockResolvedValue({
        data: { user: { id: 'admin-user-uuid' } },
        error: null,
      });

      // 1. Delete notification
      await deleteAdminActivityNotificationGlobal('notif-1');

      // 2. Simulate complete browser restart, cache clear, or re-login
      const { _resetNotificationStorageForTesting } = await import('./kani-admin-activity');
      _resetNotificationStorageForTesting();

      // 3. Read notifications after reload/re-login: notif-1 does not reappear because DB persisted the deletion
      const notificationsAfterReload = await readAdminActivityNotifications();
      expect(notificationsAfterReload.some(n => n.id === 'notif-1')).toBe(false);
      expect(notificationsAfterReload.some(n => n.id === 'notif-2')).toBe(true);
    });

    it('personal barber dismissal applies only to user_state and never modifies operational tables', async () => {
      const touchedTables: string[] = [];

      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC not found', code: 'PGRST202' },
      });

      mockFrom.mockImplementation((table: string) => {
        touchedTables.push(table);
        if (table === 'admin_activity_user_state') {
          return {
            upsert: () => Promise.resolve({ error: null }),
          };
        }
        return {};
      });

      mockGetUser.mockResolvedValue({
        data: { user: { id: 'barber-user-uuid' } },
        error: null,
      });

      await dismissAdminActivityNotificationPersonal('notif-barber-1');

      // Must only touch admin_activity_user_state, never appointments or clients
      expect(touchedTables).toContain('admin_activity_user_state');
      expect(touchedTables).not.toContain('appointments');
      expect(touchedTables).not.toContain('clients');
      expect(touchedTables).not.toContain('availability_slots');
    });
  });
});

