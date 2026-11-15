// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

type SimUser = { id: string; role: 'ADMIN' | 'MANAGER' | 'BARBER'; barber_id: string | null };

const users: Record<'admin' | 'lautaro' | 'gonzalo', SimUser> = {
  admin: { id: 'uid-admin', role: 'ADMIN', barber_id: null },
  lautaro: { id: 'uid-lautaro', role: 'BARBER', barber_id: 'barber-lautaro' },
  gonzalo: { id: 'uid-gonzalo', role: 'BARBER', barber_id: 'barber-gonzalo' },
};

type SimEvent = {
  id: string;
  event_type: string;
  actor_user_id: string | null;
  actor_display_name: string;
  barber_id: string;
  appointment_id: string | null;
  availability_slot_id: string | null;
  barber_name: string;
  client_name: string | null;
  event_date: string;
  event_time: string;
  created_at: string;
  read_at: string | null;
};

const simDb = vi.hoisted(() => {
  let activeUser: SimUser = { id: 'uid-admin', role: 'ADMIN', barber_id: null };
  const initialNotifications: SimEvent[] = [
    {
      id: 'notif-lautaro-1',
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
      read_at: null,
    },
    {
      id: 'notif-gonzalo-2',
      event_type: 'AVAILABILITY_UNAVAILABLE',
      actor_user_id: 'uid-admin',
      actor_display_name: 'KANI Admin',
      barber_id: 'barber-gonzalo',
      appointment_id: null,
      availability_slot_id: 'slot-2',
      barber_name: 'Gonzalo',
      client_name: null,
      event_date: '2026-11-19',
      event_time: '11:00:00',
      created_at: '2026-11-14T17:00:00Z',
      read_at: null,
    },
  ];
  let sharedNotifications: SimEvent[] = initialNotifications.map(n => ({ ...n }));
  const userStates = new Map<string, { read_at: string | null; dismissed_at: string | null }>();
  const maintenanceCalls: string[] = [];
  const keyFor = (notifId: string, uid: string) => `${notifId}::${uid}`;

  return {
    setActive(user: SimUser) {
      activeUser = user;
    },
    getActive() {
      return activeUser;
    },
    reset() {
      userStates.clear();
      maintenanceCalls.length = 0;
      activeUser = { id: 'uid-admin', role: 'ADMIN', barber_id: null };
      sharedNotifications = initialNotifications.map(n => ({ ...n }));
    },
    insertNotification(event: SimEvent) {
      sharedNotifications = [event, ...sharedNotifications];
    },
    getSharedCount() {
      return sharedNotifications.length;
    },
    getMaintenanceCalls() {
      return [...maintenanceCalls];
    },
    async handleRpc(name: string, params?: Record<string, any>) {
      const uid = activeUser.id;
      const isOp = activeUser.role === 'ADMIN' || activeUser.role === 'MANAGER';
      const inScope = (n: SimEvent) => isOp || n.barber_id === activeUser.barber_id;

      if (name === 'read_staff_activity_notifications') {
        const rows = sharedNotifications
          .filter(n => inScope(n))
          .filter(n => !userStates.get(keyFor(n.id, uid))?.dismissed_at)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .map(n => ({
            ...n,
            read_at: userStates.get(keyFor(n.id, uid))?.read_at ?? null,
          }));
        return { data: rows, error: null };
      }

      if (name === 'set_staff_activity_notification_read') {
        const target = sharedNotifications.find(n => n.id === params?.p_notification_id);
        if (!target) {
          return { data: null, error: { code: 'P0001', message: 'Notificación no encontrada' } };
        }
        if (!isOp && target.barber_id !== activeUser.barber_id) {
          return { data: null, error: { code: '42501', message: 'Notificación fuera de alcance' } };
        }
        const k = keyFor(target.id, uid);
        const prev = userStates.get(k) ?? { read_at: null, dismissed_at: null };
        userStates.set(k, { ...prev, read_at: params?.p_read_at ?? null });
        return { data: null, error: null };
      }

      if (name === 'mark_all_staff_activity_notifications_read') {
        const cutoff = typeof params?.p_before === 'string' ? params.p_before : null;
        const now = '2026-11-14T18:00:00Z';
        for (const n of sharedNotifications) {
          if (!inScope(n)) continue;
          if (cutoff && n.created_at > cutoff) continue;
          const k = keyFor(n.id, uid);
          const prev = userStates.get(k) ?? { read_at: null, dismissed_at: null };
          if (!prev.dismissed_at) {
            userStates.set(k, { ...prev, read_at: prev.read_at ?? now });
          }
        }
        return { data: null, error: null };
      }

      if (name === 'dismiss_staff_activity_notification_personal') {
        const target = sharedNotifications.find(n => n.id === params?.p_notification_id);
        if (!target) {
          return { data: null, error: null };
        }
        if (!isOp && target.barber_id !== activeUser.barber_id) {
          return { data: null, error: { code: '42501', message: 'No autorizado para modificar esta notificación' } };
        }
        const k = keyFor(target.id, uid);
        const prev = userStates.get(k) ?? { read_at: null, dismissed_at: null };
        userStates.set(k, { ...prev, dismissed_at: '2026-11-14T18:05:00Z' });
        return { data: null, error: null };
      }

      if (name === 'dismiss_all_staff_activity_notifications_personal') {
        const cutoff = typeof params?.p_before === 'string' ? params.p_before : null;
        let count = 0;
        for (const n of sharedNotifications) {
          if (!inScope(n)) continue;
          if (cutoff && n.created_at > cutoff) continue;
          const k = keyFor(n.id, uid);
          const prev = userStates.get(k) ?? { read_at: null, dismissed_at: null };
          if (!prev.dismissed_at) {
            userStates.set(k, { ...prev, dismissed_at: '2026-11-14T18:10:00Z' });
            count += 1;
          }
        }
        return { data: count, error: null };
      }

      if (name === 'admin_count_availability_notifications') {
        if (activeUser.role !== 'ADMIN') {
          return { data: null, error: { code: '42501', message: 'MAINTENANCE_ADMIN_REQUIRED' } };
        }
        maintenanceCalls.push(name);
        return { data: 1, error: null };
      }

      if (name === 'admin_cleanup_availability_notifications' || name === 'admin_cleanup_appointment_records') {
        if (activeUser.role !== 'ADMIN') {
          return { data: null, error: { code: '42501', message: 'MAINTENANCE_ADMIN_REQUIRED' } };
        }
        maintenanceCalls.push(name);
        return {
          data: [{ operation_id: 'op-1', operation_status: 'SUCCEEDED', notifications_deleted: 1, error_code: null }],
          error: null,
        };
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

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    user: { id: simDb.getActive().id, email: 'staff@kanibarber.com' },
    profile: {
      user_id: simDb.getActive().id,
      role: simDb.getActive().role,
      barber_id: simDb.getActive().barber_id,
      display_name: simDb.getActive().role === 'ADMIN' ? 'KANI Admin' : 'Lautaro',
      active: true,
    },
    barbers: [{ id: 'barber-lautaro', name: 'Lautaro', active: true }],
  }),
}));

vi.mock('@/components/kani/google-calendar-admin-section', () => ({
  GoogleCalendarAdminSection: () => <div data-testid="gcal-section" />,
}));

vi.mock('@/components/kani/admin-benefit-codes-section', () => ({
  BenefitCodesAdminSection: () => <div data-testid="benefit-section" />,
}));

import { AdminActivityPopover } from '@/components/kani/admin-activity-popover';
import { AdminMaintenance } from '@/components/kani/admin-maintenance';
import { dismissAdminActivityNotificationPersonal, setAdminActivityNotificationRead } from '@/lib/kani-admin-activity';
import { cleanupAppointmentRecords, cleanupAvailabilityNotifications } from '@/lib/kani-maintenance';

describe('Liquid Glass V12.40 — Complete Scenarios A–G Verification', () => {
  beforeEach(() => {
    simDb.reset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('Escenario A — Confirmation modal renders in front of dimmed popover with specific Liquid Glass rules', async () => {
    simDb.setActive(users.admin);
    render(<AdminActivityPopover role="ADMIN" userId={users.admin.id} isLiquid={true} />);

    fireEvent.click(await screen.findByRole('button', { name: /2 notificaciones sin leer/i }));
    await screen.findByText(/Carlos reservó un turno con Lautaro/i);

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar notificaciones' }));
    const dialog = await screen.findByRole('dialog', { name: 'Eliminar notificaciones' });
    const popover = document.querySelector('.liquid-glass-notification-popover');
    const overlay = document.querySelector('.kani-notif-confirm-overlay');

    expect(popover?.getAttribute('data-confirm-open')).toBe('true');
    expect(popover?.contains(dialog)).toBe(false);
    expect(overlay).toBeTruthy();
    expect(dialog.className).toContain('liquid-glass-confirm-dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Eliminar notificaciones' })).toBeNull();
    });
    expect(screen.getByText(/Carlos reservó un turno con Lautaro/i)).toBeTruthy();

    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass-notifications.css'),
      'utf8',
    );
    expect(css).toContain('body[data-lg-admin="true"]');
    expect(css).toContain('.kani-notif-confirm-footer button.kani-notif-confirm-cancel');
    expect(css).toContain('z-index: 200 !important');
  });

  it('Escenario B & E — Admin individual delete and read states persist across devices while Lautaro keeps his own states', async () => {
    simDb.setActive(users.admin);
    const adminDeviceA = render(<AdminActivityPopover key="admin-dev-a" role="ADMIN" userId={users.admin.id} isLiquid={true} />);

    fireEvent.click(await screen.findByRole('button', { name: /2 notificaciones sin leer/i }));
    await screen.findByText(/Carlos reservó un turno con Lautaro/i);

    // Admin marks notif-lautaro-1 as read and deletes notif-gonzalo-2 individually
    fireEvent.click(screen.getAllByRole('button', { name: 'Marcar como leída' })[1]);
    await waitFor(() => {
      expect(screen.getByText('1 sin leer')).toBeTruthy();
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar notificación' })[0]);
    await waitFor(() => {
      expect(screen.queryByText(/Kani Admin bloqueó el horario/i)).toBeNull();
    });
    adminDeviceA.unmount();

    // Simulate closing browser / logging in from another device (fresh storage + fresh component mount)
    window.localStorage.clear();
    window.sessionStorage.clear();
    const adminDeviceB = render(<AdminActivityPopover key="admin-dev-b" role="ADMIN" userId={users.admin.id} isLiquid={true} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Notificaciones$/i }));
    expect(await screen.findByText(/Carlos reservó un turno con Lautaro/i)).toBeTruthy();
    expect(screen.queryByText(/Kani Admin bloqueó el horario/i)).toBeNull();
    expect(screen.getByText('Todas leídas')).toBeTruthy();
    adminDeviceB.unmount();

    // Lautaro still has notif-lautaro-1 UNREAD and shared DB table rows still exist
    expect(simDb.getSharedCount()).toBe(2);
    simDb.setActive(users.lautaro);
    render(<AdminActivityPopover key="lautaro-dev" role="BARBER" userId={users.lautaro.id} isLiquid={true} />);
    fireEvent.click(await screen.findByRole('button', { name: /1 notificaciones sin leer/i }));
    expect(await screen.findByText(/Carlos reservó un turno con Lautaro/i)).toBeTruthy();
    expect(screen.getByText('1 sin leer')).toBeTruthy();
  });

  it('Escenario C & D — Admin bulk deletion clears only pre-cutoff notifications; new post-cutoff arrivals appear normally and Lautaro keeps his', async () => {
    simDb.setActive(users.admin);
    const adminView = render(<AdminActivityPopover key="admin-bulk" role="ADMIN" userId={users.admin.id} isLiquid={true} />);

    fireEvent.click(await screen.findByRole('button', { name: /2 notificaciones sin leer/i }));
    await screen.findByText(/Carlos reservó un turno con Lautaro/i);

    // Admin opens confirmation dialog at cutoff = 17:00:00Z
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar notificaciones' }));
    const dialog = await screen.findByRole('dialog', { name: 'Eliminar notificaciones' });

    // Race condition simulation: a brand new notification arrives WHILE confirmation modal is open!
    simDb.insertNotification({
      id: 'notif-race-new',
      event_type: 'APPOINTMENT_CONFIRMED',
      actor_user_id: 'uid-admin',
      actor_display_name: 'KANI Admin',
      barber_id: 'barber-lautaro',
      appointment_id: 'apt-race',
      availability_slot_id: null,
      barber_name: 'Lautaro',
      client_name: 'Martín Nuevo',
      event_date: '2026-11-20',
      event_time: '18:00:00',
      created_at: '2026-11-14T19:00:00Z',
      read_at: null,
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar notificaciones' }));

    // The 2 old notifications are gone, AND the race arrival generated after cutoff appears cleanly!
    await waitFor(() => {
      expect(screen.queryByText(/Carlos reservó un turno con Lautaro/i)).toBeNull();
      expect(screen.queryByText(/Kani Admin bloqueó el horario/i)).toBeNull();
      expect(screen.getByText(/confirmó el turno de Martín Nuevo/i)).toBeTruthy();
    });
    expect(screen.getByText('1 sin leer')).toBeTruthy();
    adminView.unmount();

    // Another new notification generated after bulk dismissal appears as well
    simDb.insertNotification({
      id: 'notif-post-dismiss',
      event_type: 'APPOINTMENT_REQUESTED',
      actor_user_id: null,
      actor_display_name: 'Lucas',
      barber_id: 'barber-lautaro',
      appointment_id: 'apt-post',
      availability_slot_id: null,
      barber_name: 'Lautaro',
      client_name: 'Lucas Post',
      event_date: '2026-11-21',
      event_time: '12:00:00',
      created_at: '2026-11-14T19:30:00Z',
      read_at: null,
    });

    const adminReload = render(<AdminActivityPopover key="admin-after" role="ADMIN" userId={users.admin.id} isLiquid={true} />);
    fireEvent.click(await screen.findByRole('button', { name: /2 notificaciones sin leer/i }));
    expect(await screen.findByText(/Lucas Post reservó un turno con Lautaro/i)).toBeTruthy();
    expect(screen.queryByText(/Carlos reservó un turno con Lautaro/i)).toBeNull();
    adminReload.unmount();

    // Lautaro retains his earlier notification (Carlos) plus his new ones untouched
    simDb.setActive(users.lautaro);
    render(<AdminActivityPopover key="lautaro-after" role="BARBER" userId={users.lautaro.id} isLiquid={true} />);
    fireEvent.click(await screen.findByRole('button', { name: /notificaciones sin leer/i }));
    expect(await screen.findByText(/Carlos reservó un turno con Lautaro/i)).toBeTruthy();
  });

  it('Escenario F — Lautaro cannot dismiss or mark as read notifications belonging to Admin/another barber even by tampering IDs', async () => {
    simDb.setActive(users.lautaro);

    await expect(dismissAdminActivityNotificationPersonal('notif-gonzalo-2')).rejects.toThrow(
      /No autorizado/i,
    );
    await expect(
      setAdminActivityNotificationRead('notif-gonzalo-2', '2026-11-14T18:00:00Z'),
    ).rejects.toThrow(/fuera de alcance/i);

    // SQL migrations never accept client-sent user_id and always enforce (select auth.uid())
    const mig14 = fs.readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/20261114000100_kani_per_user_notifications_persistence.sql'),
      'utf8',
    );
    const mig15 = fs.readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/20261115000100_kani_v12_40_notification_persistence_hardening.sql'),
      'utf8',
    );
    expect(mig14).not.toContain('p_user_id');
    expect(mig15).not.toContain('p_user_id');
    expect(mig15).toContain('(select auth.uid())');
    expect(mig15).toContain('p_before is null or n.created_at <= p_before');
  });

  it('Escenario G — Global Maintenance cleanup requires ADMIN role, shows scope and demands explicit confirmation', async () => {
    // 1. Non-admin BARBER is rejected by backend Maintenance RPCs
    simDb.setActive(users.lautaro);
    await expect(cleanupAvailabilityNotifications()).rejects.toThrow(/permisos ADMIN/i);
    await expect(cleanupAppointmentRecords(['CANCELLED'])).rejects.toThrow(/permisos ADMIN/i);
    expect(simDb.getMaintenanceCalls()).toEqual([]);

    // 2. ADMIN Maintenance page shows exact scope, does not auto-execute cleanup, and opens confirmation modal before calling RPC
    simDb.setActive(users.admin);
    render(<AdminMaintenance />);
    expect(await screen.findByText('Notificaciones eliminables')).toBeTruthy();
    await waitFor(() => {
      expect(simDb.getMaintenanceCalls()).toEqual(['admin_count_availability_notifications']);
    });

    const availSection = screen.getByRole('heading', { name: 'Historial de disponibilidad' }).closest('section')!;
    const triggerAvailCleanupBtn = within(availSection).getByRole('button', { name: 'Eliminar notificaciones' });
    await waitFor(() => {
      expect((triggerAvailCleanupBtn as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(triggerAvailCleanupBtn);
    const confirmDialog = await screen.findByRole('dialog');
    expect(within(confirmDialog).getByText(/Se eliminarán exactamente 1 notificaciones/i)).toBeTruthy();
    // Global cleanup must still NOT have fired before explicit confirmation
    expect(simDb.getMaintenanceCalls()).toEqual(['admin_count_availability_notifications']);

    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(simDb.getMaintenanceCalls()).toEqual(['admin_count_availability_notifications']);
  });
});
