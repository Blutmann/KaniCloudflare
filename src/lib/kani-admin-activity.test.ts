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

describe('kani-admin-activity V12.39 per-user DB persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-default-uuid' } },
      error: null,
    });
  });

  describe('readAdminActivityNotifications', () => {
    it('reads directly from read_staff_activity_notifications RPC and deduplicates duplicate IDs', async () => {
      mockRpc.mockResolvedValue({
        data: [
          { id: 'n-1', event_type: 'APPOINTMENT_REQUESTED', created_at: '2026-11-14T10:00:00Z', read_at: null },
          { id: 'n-1', event_type: 'APPOINTMENT_REQUESTED', created_at: '2026-11-14T10:00:00Z', read_at: null },
          { id: 'n-2', event_type: 'APPOINTMENT_CONFIRMED', created_at: '2026-11-14T09:00:00Z', read_at: '2026-11-14T09:05:00Z' },
        ],
        error: null,
      });

      const list = await readAdminActivityNotifications();
      expect(mockRpc).toHaveBeenCalledWith('read_staff_activity_notifications');
      expect(list.map(item => item.id)).toEqual(['n-1', 'n-2']);
    });

    it('falls back to admin_activity_user_state when RPC is missing in schema cache and applies per-user read_at/dismissed_at only', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function public.read_staff_activity_notifications' },
      });

      mockGetUser.mockResolvedValue({
        data: { user: { id: 'lautaro-uuid' } },
        error: null,
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'admin_activity_user_state') {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    { notification_id: 'n-dismissed', dismissed_at: '2026-11-14T12:00:00Z', read_at: null },
                    { notification_id: 'n-read-by-me', dismissed_at: null, read_at: '2026-11-14T11:00:00Z' },
                  ],
                  error: null,
                }),
            }),
          };
        }
        if (table === 'admin_activity_notifications') {
          return {
            select: () => ({
              order: () => ({
                limit: () =>
                  Promise.resolve({
                    data: [
                      // Shared read_at left non-null on legacy table must NOT mark Lautaro's notification as read
                      { id: 'n-dismissed', event_type: 'APPOINTMENT_REQUESTED', created_at: '2026-11-14T10:00:00Z', read_at: null },
                      { id: 'n-unread', event_type: 'APPOINTMENT_REQUESTED', created_at: '2026-11-14T09:30:00Z', read_at: '2026-11-14T09:31:00Z' },
                      { id: 'n-read-by-me', event_type: 'APPOINTMENT_CONFIRMED', created_at: '2026-11-14T09:00:00Z', read_at: null },
                    ],
                    error: null,
                  }),
              }),
            }),
          };
        }
        return {};
      });

      const list = await readAdminActivityNotifications('spoofed-other-user');
      expect(list.map(i => i.id)).toEqual(['n-unread', 'n-read-by-me']);
      expect(list.find(i => i.id === 'n-unread')?.read_at).toBeNull();
      expect(list.find(i => i.id === 'n-read-by-me')?.read_at).toBe('2026-11-14T11:00:00Z');
    });

    it('throws server errors instead of hiding them', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'permission denied' },
      });

      await expect(readAdminActivityNotifications()).rejects.toThrow('permission denied');
    });
  });

  describe('setAdminActivityNotificationRead / bulk read & unread', () => {
    it('uses set_staff_activity_notification_read RPC and never mutates shared admin_activity_notifications', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      await setAdminActivityNotificationRead('notif-1', '2026-11-14T12:00:00Z');
      expect(mockRpc).toHaveBeenCalledWith('set_staff_activity_notification_read', {
        p_notification_id: 'notif-1',
        p_read_at: '2026-11-14T12:00:00Z',
      });
      expect(mockFrom).not.toHaveBeenCalledWith('admin_activity_notifications');
    });

    it('falls back strictly to admin_activity_user_state upsert when set read RPC is missing', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'function does not exist' },
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-uuid' } }, error: null });

      const mockUpsert = vi.fn().mockResolvedValue({ error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'admin_activity_user_state') return { upsert: mockUpsert };
        throw new Error(`Unexpected write to ${table}`);
      });

      await setAdminActivityNotificationRead('notif-1', '2026-11-14T12:00:00Z');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          notification_id: 'notif-1',
          user_id: 'admin-uuid',
          read_at: '2026-11-14T12:00:00Z',
        }),
        { onConflict: 'notification_id,user_id' },
      );
    });

    it('uses mark_all_staff_activity_notifications_read RPC when available', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });
      await markAllAdminActivityNotificationsRead(['n-1']);
      expect(mockRpc).toHaveBeenCalledWith('mark_all_staff_activity_notifications_read');
    });

    it('uses mark_all_staff_activity_notifications_unread RPC and falls back strictly to admin_activity_user_state', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: null });
      await markAllAdminActivityNotificationsUnread(['n-1']);
      expect(mockRpc).toHaveBeenCalledWith('mark_all_staff_activity_notifications_unread');

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'function does not exist' },
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'barber-uuid' } }, error: null });

      const mockIn = vi.fn().mockResolvedValue({ error: null });
      const mockEq = vi.fn().mockReturnValue({ in: mockIn });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'admin_activity_user_state') return { update: mockUpdate };
        throw new Error(`Unexpected write to ${table}`);
      });

      await markAllAdminActivityNotificationsUnread(['n-1', 'n-2']);
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ read_at: null }));
      expect(mockEq).toHaveBeenCalledWith('user_id', 'barber-uuid');
      expect(mockIn).toHaveBeenCalledWith('notification_id', ['n-1', 'n-2']);
    });
  });

  describe('personal dismissal (ADMIN, MANAGER and BARBER isolation)', () => {
    it('dismisses individually via dismiss_staff_activity_notification_personal RPC', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      await dismissAdminActivityNotificationPersonal('notif-123');
      expect(mockRpc).toHaveBeenCalledWith('dismiss_staff_activity_notification_personal', {
        p_notification_id: 'notif-123',
      });
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('dismisses all via dismiss_all_staff_activity_notifications_personal RPC', async () => {
      mockRpc.mockResolvedValue({ data: 3, error: null });

      const count = await dismissAllAdminActivityNotificationsPersonal(['id-1', 'id-2', 'id-3']);
      expect(mockRpc).toHaveBeenCalledWith('dismiss_all_staff_activity_notifications_personal');
      expect(count).toBe(3);
    });

    it('redirects deprecated global delete wrappers to personal dismissal so shared rows are never deleted', async () => {
      mockRpc.mockResolvedValue({ data: 2, error: null });

      await deleteAdminActivityNotificationGlobal('notif-x');
      expect(mockRpc).toHaveBeenCalledWith('dismiss_staff_activity_notification_personal', {
        p_notification_id: 'notif-x',
      });

      await deleteAllAdminActivityNotificationsGlobal(['notif-x', 'notif-y']);
      expect(mockRpc).toHaveBeenCalledWith('dismiss_all_staff_activity_notifications_personal');
    });

    it('throws error (never swallows into localStorage) when DB persistence fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'RLS policy violation' },
      });

      await expect(dismissAdminActivityNotificationPersonal('notif-1')).rejects.toThrow('RLS policy violation');
      await expect(dismissAllAdminActivityNotificationsPersonal(['notif-1'])).rejects.toThrow('RLS policy violation');
    });

    it('falls back strictly to admin_activity_user_state upsert when dismiss RPC is missing', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'function does not exist' },
      });
      mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-uuid' } }, error: null });

      const mockUpsert = vi.fn().mockResolvedValue({ error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'admin_activity_user_state') return { upsert: mockUpsert };
        throw new Error(`Unexpected touch on ${table}`);
      });

      const count = await dismissAllAdminActivityNotificationsPersonal(['id-1', 'id-2']);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ notification_id: 'id-1', user_id: 'admin-uuid', dismissed_at: expect.any(String) }),
          expect.objectContaining({ notification_id: 'id-2', user_id: 'admin-uuid', dismissed_at: expect.any(String) }),
        ]),
        { onConflict: 'notification_id,user_id' },
      );
      expect(count).toBe(2);
    });
  });

  describe('extractErrorMessage', () => {
    it('sanitizes internal schema cache / table errors', () => {
      const msg = extractErrorMessage({
        code: 'PGRST205',
        message: "Could not find the table 'public.admin_activity_user_state' in the schema cache",
      });
      expect(msg).not.toContain('admin_activity_user_state');
      expect(msg).not.toContain('schema cache');
      expect(msg).toContain('No se pudo actualizar el almacenamiento');
    });
  });
});
