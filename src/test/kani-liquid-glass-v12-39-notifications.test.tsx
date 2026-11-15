// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

type SimUser = { id: string; role: 'ADMIN' | 'MANAGER' | 'BARBER'; barber_id: string | null };

const users: Record<'admin' | 'lautaro', SimUser> = {
  admin: { id: 'uid-admin', role: 'ADMIN', barber_id: null },
  lautaro: { id: 'uid-lautaro', role: 'BARBER', barber_id: 'barber-lautaro' },
};

const simDb = vi.hoisted(() => {
  let activeUser: SimUser = { id: 'uid-admin', role: 'ADMIN', barber_id: null };
  const sharedNotifications = [
    {
      id: 'notif-shared-1',
      event_type: 'APPOINTMENT_REQUESTED',
      actor_user_id: null,
      actor_display_name: 'Carlos',
      barber_id: 'barber-lautaro',
      appointment_id: 'apt-1',
      availability_slot_id: null,
      barber_name: 'Lautaro',
      client_name: 'Carlos',
      event_date: '2026-11-18',
      event_time: '15:00:00',
      created_at: '2026-11-14T16:00:00Z',
      read_at: '2026-11-14T16:01:00Z', // Legacy non-null shared column MUST NOT leak across users!
    },
    {
      id: 'notif-shared-2',
      event_type: 'AVAILABILITY_UNAVAILABLE',
      actor_user_id: 'uid-admin',
      actor_display_name: 'KANI Admin',
      barber_id: 'barber-lautaro',
      appointment_id: null,
      availability_slot_id: 'slot-1',
      barber_name: 'Lautaro',
      client_name: null,
      event_date: '2026-11-19',
      event_time: '10:30:00',
      created_at: '2026-11-14T17:00:00Z',
      read_at: null,
    },
  ];
  const userStates = new Map<string, { read_at: string | null; dismissed_at: string | null }>();
  const keyFor = (notifId: string, uid: string) => `${notifId}::${uid}`;

  return {
    users: {
      admin: { id: 'uid-admin', role: 'ADMIN' as const, barber_id: null },
      lautaro: { id: 'uid-lautaro', role: 'BARBER' as const, barber_id: 'barber-lautaro' },
    },
    setActive(user: SimUser) {
      activeUser = user;
    },
    getActive() {
      return activeUser;
    },
    reset() {
      userStates.clear();
      activeUser = { id: 'uid-admin', role: 'ADMIN', barber_id: null };
      sharedNotifications[0].read_at = '2026-11-14T16:01:00Z';
      sharedNotifications[1].read_at = null;
    },
    readDelayMs: 0,
    forceNextRpcError: null as null | { code: string; message: string },
    rpcCallCount: { dismissAll: 0 },
    async handleRpc(name: string, params?: Record<string, any>) {
      if (this.forceNextRpcError) {
        const err = this.forceNextRpcError;
        this.forceNextRpcError = null;
        return { data: null, error: err };
      }

      const uid = activeUser.id;
      const isOp = activeUser.role === 'ADMIN' || activeUser.role === 'MANAGER';
      const inScope = (n: (typeof sharedNotifications)[number]) => isOp || n.barber_id === activeUser.barber_id;

      if (name === 'read_staff_activity_notifications') {
        if (this.readDelayMs > 0) {
          const delay = this.readDelayMs;
          this.readDelayMs = 0;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        const rows = sharedNotifications
          .filter(n => inScope(n))
          .filter(n => !userStates.get(keyFor(n.id, uid))?.dismissed_at)
          .map(n => ({
            ...n,
            read_at: userStates.get(keyFor(n.id, uid))?.read_at ?? null,
          }));
        return { data: rows, error: null };
      }

      if (name === 'set_staff_activity_notification_read') {
        const k = keyFor(params?.p_notification_id, uid);
        const prev = userStates.get(k) ?? { read_at: null, dismissed_at: null };
        userStates.set(k, { ...prev, read_at: params?.p_read_at ?? null });
        return { data: null, error: null };
      }

      if (name === 'mark_all_staff_activity_notifications_read') {
        const now = '2026-11-14T18:00:00Z';
        for (const n of sharedNotifications) {
          if (!inScope(n)) continue;
          const k = keyFor(n.id, uid);
          const prev = userStates.get(k) ?? { read_at: null, dismissed_at: null };
          if (!prev.dismissed_at) {
            userStates.set(k, { ...prev, read_at: now });
          }
        }
        return { data: null, error: null };
      }

      if (name === 'mark_all_staff_activity_notifications_unread') {
        for (const n of sharedNotifications) {
          if (!inScope(n)) continue;
          const k = keyFor(n.id, uid);
          const prev = userStates.get(k);
          if (prev && !prev.dismissed_at) {
            userStates.set(k, { ...prev, read_at: null });
          }
        }
        return { data: null, error: null };
      }

      if (name === 'dismiss_staff_activity_notification_personal') {
        const k = keyFor(params?.p_notification_id, uid);
        const prev = userStates.get(k) ?? { read_at: null, dismissed_at: null };
        userStates.set(k, { ...prev, dismissed_at: '2026-11-14T18:05:00Z' });
        return { data: null, error: null };
      }

      if (name === 'dismiss_all_staff_activity_notifications_personal') {
        this.rpcCallCount.dismissAll += 1;
        let count = 0;
        for (const n of sharedNotifications) {
          if (!inScope(n)) continue;
          const k = keyFor(n.id, uid);
          const prev = userStates.get(k) ?? { read_at: null, dismissed_at: null };
          if (!prev.dismissed_at) {
            userStates.set(k, { ...prev, dismissed_at: '2026-11-14T18:10:00Z' });
            count += 1;
          }
        }
        return { data: count, error: null };
      }

      return { data: null, error: { code: 'PGRST202', message: `Unknown RPC ${name}` } };
    },
  };
});

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, onClick, activeProps: _ap, ...props }: any) => (
    <a href={typeof to === 'string' ? to : '#'} onClick={onClick} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: any) => select({ location: { pathname: '/admin-liquid' } }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (name: string, params?: Record<string, any>) => simDb.handleRpc(name, params),
    from: vi.fn(),
    auth: {
      getUser: async () => ({ data: { user: { id: simDb.getActive().id } }, error: null }),
    },
  },
}));

import { AdminActivityPopover } from '@/components/kani/admin-activity-popover';

describe('Liquid Glass V12.39 — Confirmation Dialog Layering & Per-User Notification Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    simDb.reset();
    simDb.readDelayMs = 0;
    simDb.forceNextRpcError = null;
    simDb.rpcCallCount.dismissAll = 0;
    window.localStorage.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.body.className = '';
  });

  it('Scenario D — Confirmation dialog renders above notification popover with dimmed overlay, Cancel leaves items intact, and double-click triggers only 1 delete operation', async () => {
    render(<AdminActivityPopover role="ADMIN" userId={users.admin.id} isLiquid={true} />);

    const bell = await screen.findByRole('button', { name: /2 notificaciones sin leer/i });
    fireEvent.click(bell);

    await screen.findByText('Notificaciones');
    const popoverEl = document.querySelector('.liquid-glass-notification-popover');
    expect(popoverEl).toBeTruthy();
    expect(popoverEl?.getAttribute('data-confirm-open')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar notificaciones' }));

    const dialog = await screen.findByRole('dialog', { name: 'Eliminar notificaciones' });
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).toBeTruthy();
    expect(overlay?.className).toContain('z-[190]');
    expect(overlay?.className).toContain('kani-notif-confirm-overlay');
    expect(dialog.className).toContain('z-[200]');
    expect(dialog.className).toContain('kani-notif-confirm-dialog');
    expect(dialog.className).toContain('liquid-glass-confirm-dialog');
    expect(popoverEl?.getAttribute('data-confirm-open')).toBe('true');

    const cancelBtn = within(dialog).getByRole('button', { name: 'Cancelar' });
    const confirmBtn = within(dialog).getByRole('button', { name: 'Eliminar notificaciones' });
    expect(cancelBtn).toBeTruthy();
    expect(confirmBtn.className).toContain('kani-notif-confirm-destructive');

    // Cancel must close confirmation dialog without closing notification popover or deleting anything
    fireEvent.click(cancelBtn);
    await waitFor(() => {
      expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
    });
    expect(popoverEl?.getAttribute('data-confirm-open')).toBe('false');
    expect(screen.getByText('Notificaciones')).toBeTruthy();
    expect(simDb.rpcCallCount.dismissAll).toBe(0);
    expect(screen.getByText('2 sin leer')).toBeTruthy();

    // Open again and rapid double-click confirm: must execute only ONCE
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar notificaciones' }));
    const dialog2 = await screen.findByRole('dialog', { name: 'Eliminar notificaciones' });
    const confirmBtn2 = within(dialog2).getByRole('button', { name: 'Eliminar notificaciones' });
    fireEvent.click(confirmBtn2);
    fireEvent.click(confirmBtn2);

    await waitFor(() => {
      expect(screen.getByText('No hay novedades recientes.')).toBeTruthy();
    });
    expect(simDb.rpcCallCount.dismissAll).toBe(1);
  });

  it('Scenario A & B — Read states and individual deletions persist independently per user across re-login without using localStorage', async () => {
    // 1. Admin logs in, marks notif-shared-1 as read and dismisses notif-shared-2
    simDb.setActive(users.admin);
    const adminView1 = render(<AdminActivityPopover key="admin-1" role="ADMIN" userId={users.admin.id} isLiquid={true} />);

    fireEvent.click(await screen.findByRole('button', { name: /2 notificaciones sin leer/i }));
    await screen.findByText(/Carlos reservó un turno con Lautaro/i);

    // Toggle notif-shared-1 (index 0) as read for Admin
    const markReadBtns = screen.getAllByRole('button', { name: 'Marcar como leída' });
    fireEvent.click(markReadBtns[0]);
    await waitFor(() => {
      expect(screen.getByText('1 sin leer')).toBeTruthy();
    });

    // Delete notif-shared-2 individually as Admin
    const deleteBtns = screen.getAllByRole('button', { name: 'Eliminar notificación' });
    fireEvent.click(deleteBtns[1]);
    await waitFor(() => {
      expect(screen.queryByText(/Kani Admin bloqueó el horario/i)).toBeNull();
    });

    // Clear localStorage completely and unmount (simulate logout + new browser/device)
    window.localStorage.clear();
    adminView1.unmount();

    // 2. Lautaro logs in on fresh mount: MUST see BOTH notifications still UNREAD (independent from Admin!)
    simDb.setActive(users.lautaro);
    const lautaroView = render(<AdminActivityPopover key="lautaro-1" role="BARBER" userId={users.lautaro.id} isLiquid={true} />);
    fireEvent.click(await screen.findByRole('button', { name: /2 notificaciones sin leer/i }));
    expect(await screen.findByText(/Carlos reservó un turno con Lautaro/i)).toBeTruthy();
    expect(screen.getByText(/Kani Admin bloqueó el horario/i)).toBeTruthy();
    expect(screen.getByText('2 sin leer')).toBeTruthy();

    // Lautaro deletes notif-shared-1 individually -> disappears ONLY for Lautaro
    const lautaroDeleteBtns = screen.getAllByRole('button', { name: 'Eliminar notificación' });
    fireEvent.click(lautaroDeleteBtns[0]);
    await waitFor(() => {
      expect(screen.queryByText(/Carlos reservó un turno con Lautaro/i)).toBeNull();
    });
    lautaroView.unmount();

    // Lautaro logs back in: notif-shared-1 stays gone, notif-shared-2 stays visible
    const lautaroView2 = render(<AdminActivityPopover key="lautaro-2" role="BARBER" userId={users.lautaro.id} isLiquid={true} />);
    fireEvent.click(await screen.findByRole('button', { name: /1 notificaciones sin leer/i }));
    expect(screen.queryByText(/Carlos reservó un turno con Lautaro/i)).toBeNull();
    expect(await screen.findByText(/Kani Admin bloqueó el horario/i)).toBeTruthy();
    lautaroView2.unmount();

    // 3. Admin logs back in: MUST still see notif-shared-1 (read, counter 0) and NOT see notif-shared-2
    simDb.setActive(users.admin);
    render(<AdminActivityPopover key="admin-2" role="ADMIN" userId={users.admin.id} isLiquid={true} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Notificaciones$/i }));
    expect(await screen.findByText(/Carlos reservó un turno con Lautaro/i)).toBeTruthy();
    expect(screen.queryByText(/Kani Admin bloqueó el horario/i)).toBeNull();
    expect(screen.getByText('Todas leídas')).toBeTruthy();

    // Nothing was stored in localStorage as source of truth
    expect(window.localStorage.length).toBe(0);
  });

  it('Scenario C — Bulk deletion persists for Lautaro across reloads without touching Admin notifications, and server errors recover cleanly', async () => {
    // 1. Force error on Lautaro bulk deletion -> shows error, recovers list
    simDb.setActive(users.lautaro);
    const lautaroView = render(<AdminActivityPopover key="l-err" role="BARBER" userId={users.lautaro.id} isLiquid={true} />);
    fireEvent.click(await screen.findByRole('button', { name: /2 notificaciones sin leer/i }));

    simDb.forceNextRpcError = { code: '42501', message: 'Error de permiso simulado' };
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar notificaciones' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Eliminar notificaciones' });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Eliminar notificaciones' }));

    expect(await screen.findByText('Error de permiso simulado')).toBeTruthy();
    // Notifications must remain visible because operation failed
    expect(screen.getByText(/Carlos reservó un turno con Lautaro/i)).toBeTruthy();

    // 2. Retry successfully -> clears only Lautaro's notifications
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Eliminar notificaciones' })).getByRole('button', { name: 'Eliminar notificaciones' }));
    await waitFor(() => {
      expect(screen.getByText('No hay novedades recientes.')).toBeTruthy();
    });
    lautaroView.unmount();

    // Reload Lautaro -> stays empty
    const lautaroReload = render(<AdminActivityPopover key="l-reload" role="BARBER" userId={users.lautaro.id} isLiquid={true} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Notificaciones$/i }));
    expect(await screen.findByText('No hay novedades recientes.')).toBeTruthy();
    lautaroReload.unmount();

    // Admin still has both notifications untouched
    simDb.setActive(users.admin);
    render(<AdminActivityPopover key="a-intact" role="ADMIN" userId={users.admin.id} isLiquid={true} />);
    fireEvent.click(await screen.findByRole('button', { name: /2 notificaciones sin leer/i }));
    expect(await screen.findByText(/Carlos reservó un turno con Lautaro/i)).toBeTruthy();
    expect(screen.getByText(/Kani Admin bloqueó el horario/i)).toBeTruthy();
  });

  it('ignores stale delayed read responses after a dismissal so deleted notifications never reappear', async () => {
    simDb.setActive(users.admin);
    simDb.readDelayMs = 60;
    render(<AdminActivityPopover role="ADMIN" userId={users.admin.id} isLiquid={true} />);

    // Trigger rapid delete after first read resolves and while opening popover triggers a second slow read
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /2 notificaciones sin leer/i })).toBeTruthy();
    });

    simDb.readDelayMs = 80;
    fireEvent.click(screen.getByRole('button', { name: /2 notificaciones sin leer/i }));
    const deleteBtns = await screen.findAllByRole('button', { name: 'Eliminar notificación' });
    fireEvent.click(deleteBtns[0]);

    await waitFor(() => {
      expect(screen.queryByText(/Carlos reservó un turno con Lautaro/i)).toBeNull();
    });

    // Wait past the delayed read window and assert deleted item does NOT bounce back
    await new Promise(resolve => setTimeout(resolve, 110));
    expect(screen.queryByText(/Carlos reservó un turno con Lautaro/i)).toBeNull();
    expect(screen.getByText(/Kani Admin bloqueó el horario/i)).toBeTruthy();
  });

  it('ships responsive Light/Dark confirmation dialog CSS layer rules and hardened Supabase migration', () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass-notifications.css'),
      'utf8',
    );
    expect(css).toContain('z-index: 125 !important');
    expect(css).toContain('z-index: 130 !important');
    expect(css).toContain('.kani-notif-confirm-overlay');
    expect(css).toContain('z-index: 190 !important');
    expect(css).toContain('.kani-notif-confirm-dialog[role="dialog"]');
    expect(css).toContain('z-index: 200 !important');
    expect(css).toContain('.kani-notif-confirm-destructive');
    expect(css).toContain('.notification-popover[data-confirm-open="true"]');

    const migration = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'supabase/migrations/20261114000100_kani_per_user_notifications_persistence.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('revoke insert, update, delete on table public.admin_activity_notifications from authenticated');
    expect(migration).toContain('public.is_operator()');
    expect(migration).toContain('(select auth.uid())');
    expect(migration).toContain('us.read_at as read_at');
    expect(migration).not.toContain('coalesce(us.read_at, n.read_at)');
    expect(migration).toContain('perform public.dismiss_staff_activity_notification_personal');
    expect(migration).toContain('return public.dismiss_all_staff_activity_notifications_personal()');
  });
});
