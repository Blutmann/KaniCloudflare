// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

let mockPathname = '/reservar-turno-liquid';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, onClick, activeProps: _ap, ...props }: any) => (
    <a href={typeof to === 'string' ? to : '#'} onClick={onClick} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: any) => select({ location: { pathname: mockPathname } }),
  useLocation: ({ select }: any) => select({ pathname: mockPathname }),
}));

const authState = vi.hoisted(() => ({
  staff: {
    user: { id: 'admin-1', email: 'admin@kani.test' },
    profile: { role: 'ADMIN' as 'ADMIN' | 'MANAGER' | 'BARBER', barber_id: null, full_name: 'Admin Kani' },
    barbers: [{ id: 'b1', name: 'Lautaro' }],
  } as any,
}));

const getAuthenticatedStaffMock = vi.hoisted(() => vi.fn(async () => authState.staff));
const onAuthStateChangeMock = vi.hoisted(() =>
  vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
);

vi.mock('@/lib/kani-auth', () => ({
  getAuthenticatedStaff: getAuthenticatedStaffMock,
  clearStaffCache: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: onAuthStateChangeMock,
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
}));

const activityMocks = vi.hoisted(() => ({
  readAdminActivityNotifications: vi.fn(),
  setAdminActivityNotificationRead: vi.fn(),
  markAllAdminActivityNotificationsRead: vi.fn(),
  markAllAdminActivityNotificationsUnread: vi.fn(),
  deleteAdminActivityNotificationGlobal: vi.fn(),
  dismissAdminActivityNotificationPersonal: vi.fn(),
  deleteAllAdminActivityNotificationsGlobal: vi.fn(),
  dismissAllAdminActivityNotificationsPersonal: vi.fn(),
  subscribeAdminActivityChanges: vi.fn(() => vi.fn()),
  extractErrorMessage: vi.fn((err: any, fallback: string) =>
    err instanceof Error ? err.message : fallback,
  ),
}));

vi.mock('@/lib/kani-admin-activity', () => activityMocks);

const storeState = vi.hoisted(() => ({
  mobileMenuOpen: false,
  setMobileMenuOpen: vi.fn(),
  theme: 'light' as 'light' | 'dark',
  toggleTheme: vi.fn(),
}));

vi.mock('@/components/kani/store', () => ({
  useKani: () => storeState,
}));

vi.mock('@/components/kani/header-menu-sheet', () => ({
  HeaderMenuSheet: () => <button type="button" aria-label="Menú" />,
}));

import { SiteHeader } from '@/components/kani/site-header';
import { AdminActivityPopover } from '@/components/kani/admin-activity-popover';

const sampleEvents = [
  {
    id: 'n-1',
    event_type: 'APPOINTMENT_REQUESTED',
    actor_display_name: 'Juan Pérez',
    client_name: 'Juan Pérez',
    barber_name: 'Lautaro',
    event_date: '2026-11-15',
    event_time: '14:30:00',
    read_at: null,
    created_at: '2026-11-14T15:00:00Z',
  },
  {
    id: 'n-2',
    event_type: 'AVAILABILITY_UNAVAILABLE',
    actor_display_name: 'KANI Admin',
    client_name: null,
    barber_name: 'Lautaro',
    event_date: '2026-11-16',
    event_time: '11:00:00',
    read_at: '2026-11-14T15:10:00Z',
    created_at: '2026-11-14T15:05:00Z',
  },
];

describe('Liquid Glass V12.35 — Notifications Center & Header Bell Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = '/reservar-turno-liquid';
    authState.staff = {
      user: { id: 'admin-1', email: 'admin@kani.test' },
      profile: { role: 'ADMIN', barber_id: null, full_name: 'Admin Kani' },
      barbers: [{ id: 'b1', name: 'Lautaro' }],
    };
    activityMocks.readAdminActivityNotifications.mockResolvedValue(sampleEvents);
    activityMocks.setAdminActivityNotificationRead.mockResolvedValue(undefined);
    activityMocks.markAllAdminActivityNotificationsRead.mockResolvedValue(undefined);
    activityMocks.markAllAdminActivityNotificationsUnread.mockResolvedValue(undefined);
    activityMocks.deleteAdminActivityNotificationGlobal.mockResolvedValue(undefined);
    activityMocks.dismissAdminActivityNotificationPersonal.mockResolvedValue(undefined);
    activityMocks.deleteAllAdminActivityNotificationsGlobal.mockResolvedValue(undefined);
    activityMocks.dismissAllAdminActivityNotificationsPersonal.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    '/admin-liquid',
    '/reservar-turno-liquid',
    '/contacto-liquid',
    '/politica-de-privacidad-liquid',
    '/terminos-y-condiciones-liquid',
  ])('keeps the notification bell visible on %s for an authenticated admin', async (route) => {
    mockPathname = route;
    render(<SiteHeader />);

    const bell = await screen.findByRole('button', { name: /notificaciones sin leer/i });
    expect(bell).toBeTruthy();
    expect(await screen.findByText('1')).toBeTruthy();
  });

  it('supports MANAGER and BARBER staff roles while hiding the bell completely for unauthorized visitors', async () => {
    authState.staff = {
      user: { id: 'mgr-1', email: 'mgr@kani.test' },
      profile: { role: 'MANAGER', barber_id: null, full_name: 'Manager Kani' },
      barbers: [],
    };
    mockPathname = '/contacto-liquid';
    const { unmount } = render(<SiteHeader />);
    expect(await screen.findByRole('button', { name: /notificaciones sin leer/i })).toBeTruthy();
    unmount();

    authState.staff = {
      user: { id: 'barber-1', email: 'barber@kani.test' },
      profile: { role: 'BARBER', barber_id: 'b1', full_name: 'Lautaro' },
      barbers: [{ id: 'b1', name: 'Lautaro' }],
    };
    mockPathname = '/reservar-turno-liquid';
    const viewBarber = render(<SiteHeader />);
    expect(await screen.findByRole('button', { name: /notificaciones sin leer/i })).toBeTruthy();
    viewBarber.unmount();

    authState.staff = null;
    mockPathname = '/reservar-turno-liquid';
    render(<SiteHeader />);
    await waitFor(() => {
      expect(getAuthenticatedStaffMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('button', { name: /notificaciones/i })).toBeNull();
  });

  it('renders Liquid Glass popover structure, routes links to /admin-liquid when isLiquid=true, and handles read/unread/delete actions', async () => {
    let currentItems = sampleEvents.map((item) => ({ ...item }));
    activityMocks.readAdminActivityNotifications.mockImplementation(async () => currentItems);
    activityMocks.setAdminActivityNotificationRead.mockImplementation(async (id: string, readAt: string | null) => {
      currentItems = currentItems.map((item) => (item.id === id ? { ...item, read_at: readAt } : item));
    });
    activityMocks.markAllAdminActivityNotificationsRead.mockImplementation(async () => {
      currentItems = currentItems.map((item) => ({ ...item, read_at: '2026-11-14T16:00:00Z' }));
    });
    activityMocks.markAllAdminActivityNotificationsUnread.mockImplementation(async () => {
      currentItems = currentItems.map((item) => ({ ...item, read_at: null }));
    });
    activityMocks.dismissAdminActivityNotificationPersonal.mockImplementation(async (id: string) => {
      currentItems = currentItems.filter((item) => item.id !== id);
    });
    activityMocks.dismissAllAdminActivityNotificationsPersonal.mockImplementation(async () => {
      currentItems = [];
      return 0;
    });

    render(<AdminActivityPopover role="ADMIN" userId="admin-1" isLiquid={true} />);

    const bell = await screen.findByRole('button', { name: /notificaciones/i });
    fireEvent.click(bell);

    expect(await screen.findByText('Notificaciones')).toBeTruthy();
    expect(screen.getByText('1 sin leer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar notificaciones' })).toBeTruthy();

    const bookingLink = screen.getByRole('link', { name: /Juan Pérez reservó un turno con Lautaro/i });
    const schedulesLink = screen.getByRole('link', { name: /Kani Admin bloqueó el horario/i });
    expect(bookingLink.getAttribute('href')).toBe('/panel-administracion');
    expect(schedulesLink.getAttribute('href')).toBe('/panel-horarios');

    // Toggle individual item read
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída' }));
    await waitFor(() => {
      expect(activityMocks.setAdminActivityNotificationRead).toHaveBeenCalledWith('n-1', expect.any(String));
      expect(screen.getByText('Todas leídas')).toBeTruthy();
    });

    // Mark all unread
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como no leídas' }));
    await waitFor(() => {
      expect(activityMocks.markAllAdminActivityNotificationsUnread).toHaveBeenCalled();
      expect(screen.getByText('2 sin leer')).toBeTruthy();
    });

    // Mark all read
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como leídas' }));
    await waitFor(() => {
      expect(activityMocks.markAllAdminActivityNotificationsRead).toHaveBeenCalled();
      expect(screen.getByText('Todas leídas')).toBeTruthy();
    });

    // Delete single notification (personal dismissal even for ADMIN in V12.39)
    const deleteButtons = screen.getAllByRole('button', { name: 'Eliminar notificación' });
    fireEvent.click(deleteButtons[0]);
    await waitFor(() => {
      expect(activityMocks.dismissAdminActivityNotificationPersonal).toHaveBeenCalledWith('n-1');
    });

    // Delete all remaining notifications via confirmation modal
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar notificaciones' }));
    const confirmDialog = await screen.findByRole('dialog');
    const confirmBtn = within(confirmDialog).getByRole('button', { name: 'Eliminar notificaciones' });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(activityMocks.dismissAllAdminActivityNotificationsPersonal).toHaveBeenCalled();
      expect(screen.getByText('No hay novedades recientes.')).toBeTruthy();
    });

    // Close button dismisses popover
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar notificaciones' }));
    await waitFor(() => {
      expect(screen.queryByText('No hay novedades recientes.')).toBeNull();
    });
  });

  it('keeps traditional /admin links when isLiquid is false and surfaces action errors cleanly', async () => {
    activityMocks.markAllAdminActivityNotificationsRead.mockRejectedValueOnce(
      new Error('No se pudo actualizar'),
    );

    render(<AdminActivityPopover role="BARBER" userId="barber-1" isLiquid={false} />);

    const bell = await screen.findByRole('button', { name: /notificaciones/i });
    fireEvent.click(bell);

    const bookingLink = await screen.findByRole('link', { name: /Juan Pérez reservó un turno con Lautaro/i });
    const schedulesLink = screen.getByRole('link', { name: /Kani Admin bloqueó el horario/i });
    expect(bookingLink.getAttribute('href')).toBe('/panel-administracion-old');
    expect(schedulesLink.getAttribute('href')).toBe('/panel-administracion-old/horarios');

    fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como leídas' }));
    expect(await screen.findByText('No se pudo actualizar')).toBeTruthy();
  });

  it('ships responsive Liquid Glass Light/Dark CSS, backdrop-filter fallbacks, centered mobile geometry, and aligned desktop width', () => {
    const cssPath = path.resolve(
      process.cwd(),
      'src/components/kani/experimental/liquid-glass-notifications.css',
    );
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toContain('.site-header.liquid-glass-header .notification-trigger');
    expect(css).toContain('.liquid-glass-notification-popover');
    expect(css).toContain('html[data-theme="dark"] .liquid-glass-notification-popover');
    expect(css).toContain('backdrop-filter: blur(26px) saturate(180%)');
    expect(css).toContain('@supports not (backdrop-filter: blur(1px))');
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(css).toContain('--lg-notif-top');
    expect(css).toContain('[data-radix-popper-content-wrapper]:has(> .liquid-glass-notification-popover)');
    expect(css).toContain('@media (min-width: 768px)');
    expect(css).toContain('overflow-x: hidden');
  });
});
