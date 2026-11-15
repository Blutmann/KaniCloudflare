import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  dismissAdminActivityNotificationPersonal,
  readAdminActivityNotifications,
  setAdminActivityNotificationRead,
} from '@/lib/kani-admin-activity';

describe('Notifications persistence hotfix (20261116000100 + diagnostic telemetry)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-user-uuid' } },
      error: null,
    });
  });

  it('20261116000100 migration is self-contained, fixes RLS cycle, drops legacy overloads, and reloads schema cache', () => {
    const sql = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'supabase/migrations/20261116000100_kani_notifications_persistence_hotfix.sql',
      ),
      'utf8',
    );

    expect(sql).toContain('create table if not exists public.admin_activity_user_state');
    expect(sql).toContain('add column if not exists read_at timestamptz');
    expect(sql).toContain('add column if not exists dismissed_at timestamptz');

    expect(sql).toContain('create or replace function kani_private.staff_can_access_activity_notification');
    expect(sql).toContain('security definer');
    expect(sql).toContain('grant select, insert, update, delete on table public.admin_activity_user_state to authenticated');
    expect(sql).toContain('revoke insert, update, delete on table public.admin_activity_notifications from authenticated');

    // Old 0-arg overloads must be cleaned before defining optional p_before signatures
    expect(sql).toContain('drop function if exists public.mark_all_staff_activity_notifications_read()');
    expect(sql).toContain('drop function if exists public.dismiss_all_staff_activity_notifications_personal()');

    // Strict auth.uid() enforcement — never trust client-supplied user IDs
    expect(sql).not.toContain('p_user_id');
    expect(sql).toContain('(select auth.uid())');
    expect(sql).toContain('revoke all on function public.read_staff_activity_notifications() from public, anon');
    expect(sql).toContain('grant execute on function public.read_staff_activity_notifications() to authenticated, service_role');
    expect(sql).toContain("notify pgrst, 'reload schema'");
  });

  it('logs structured Supabase diagnostics before throwing sanitized user message when RPC and fallback fail', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.read_staff_activity_notifications without parameters in the schema cache',
        details: null,
        hint: null,
      },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'admin_activity_user_state') {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: null,
                error: {
                  code: '42501',
                  message: 'permission denied for table admin_activity_user_state',
                  details: 'RLS check failed',
                  hint: 'Grant SELECT on admin_activity_user_state',
                },
              }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(readAdminActivityNotifications()).rejects.toThrow(
      'No se pudo actualizar el almacenamiento de notificaciones en el servidor.',
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      '[KaniNotifications]',
      expect.objectContaining({
        operation: 'rpc:read_staff_activity_notifications',
        code: 'PGRST202',
      }),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      '[KaniNotifications]',
      expect.objectContaining({
        operation: 'select:admin_activity_user_state',
        code: '42501',
        message: 'permission denied for table admin_activity_user_state',
      }),
    );

    consoleSpy.mockRestore();
  });

  it('logs structured diagnostics on write failures in setRead and dismissPersonal', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'Notificación fuera de alcance' },
    });
    await expect(setAdminActivityNotificationRead('notif-1', '2026-11-14T12:00:00Z')).rejects.toThrow(
      'Notificación fuera de alcance',
    );

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42P17', message: 'infinite recursion detected in policy for relation admin_activity_user_state' },
    });
    await expect(dismissAdminActivityNotificationPersonal('notif-1')).rejects.toThrow(
      'No se pudo actualizar el almacenamiento de notificaciones en el servidor.',
    );

    expect(consoleSpy).toHaveBeenCalledTimes(2);
    consoleSpy.mockRestore();
  });
});
