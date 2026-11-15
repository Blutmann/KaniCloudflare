// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, onClick, activeProps: _ap, ...props }: any) => (
    <a href={typeof to === 'string' ? to : '#'} onClick={onClick} {...props}>
      {children}
    </a>
  ),
}));

const activityMocks = vi.hoisted(() => ({
  readAdminActivityNotifications: vi.fn(),
  setAdminActivityNotificationRead: vi.fn(),
  markAllAdminActivityNotificationsRead: vi.fn(),
  markAllAdminActivityNotificationsUnread: vi.fn(),
  dismissAdminActivityNotificationPersonal: vi.fn(),
  dismissAllAdminActivityNotificationsPersonal: vi.fn(),
  subscribeAdminActivityChanges: vi.fn(() => vi.fn()),
  extractErrorMessage: vi.fn((err: any, fallback: string) =>
    err instanceof Error ? err.message : fallback,
  ),
}));

vi.mock('@/lib/kani-admin-activity', () => activityMocks);

import { AdminActivityPopover } from '@/components/kani/admin-activity-popover';

const mixedEvents = [
  {
    id: 'n-unread',
    event_type: 'APPOINTMENT_REQUESTED',
    actor_display_name: 'Juan Pérez',
    client_name: 'Juan Pérez',
    barber_name: 'Lautaro',
    event_date: '2026-11-15',
    event_time: '14:30:00',
    read_at: null,
    created_at: '2026-11-15T12:00:00.000Z',
  },
  {
    id: 'n-read',
    event_type: 'APPOINTMENT_CONFIRMED',
    actor_display_name: 'KANI Admin',
    client_name: 'Matías López',
    barber_name: 'Gonzalo',
    event_date: '2026-11-15',
    event_time: '16:00:00',
    read_at: '2026-11-15T11:00:00.000Z',
    created_at: '2026-11-15T10:00:00.000Z',
  },
];

describe('Liquid Glass V12.45 — Jerarquía visual de notificaciones y eliminar individual en mobile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityMocks.readAdminActivityNotifications.mockResolvedValue(mixedEvents);
    activityMocks.setAdminActivityNotificationRead.mockResolvedValue(undefined);
    activityMocks.dismissAdminActivityNotificationPersonal.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete document.body.dataset.lgAdmin;
    document.body.className = '';
  });

  it('renderiza estados no leído vs leído, botón Eliminar individual con aria-label="Eliminar notificación" y conserva botón masivo "Eliminar notificaciones"', async () => {
    document.body.dataset.lgAdmin = 'true';
    render(<AdminActivityPopover role="ADMIN" userId="admin-1" isLiquid />);

    const bell = await screen.findByRole('button', { name: '1 notificaciones sin leer' });
    fireEvent.click(bell);

    await screen.findByText('Juan Pérez reservó un turno con Lautaro');

    const unreadItem = document.querySelector<HTMLElement>('.notification-item.is-unread');
    const readItem = document.querySelector<HTMLElement>('.notification-item.is-read');
    expect(unreadItem).not.toBeNull();
    expect(readItem).not.toBeNull();

    // No leída conserva punto dorado y etiqueta SIN LEER; leída no los muestra
    expect(unreadItem!.querySelector('.notification-unread-dot')).not.toBeNull();
    expect(unreadItem!.querySelector('.notification-state-label')?.textContent?.trim()).toBe('Sin leer');
    expect(readItem!.querySelector('.notification-unread-dot')).toBeNull();
    expect(readItem!.querySelector('.notification-state-label')).toBeNull();

    // Botón superior masivo conserva su texto intacto
    const bulkDeleteBtn = screen.getByRole('button', { name: 'Eliminar notificaciones' });
    expect(bulkDeleteBtn.className).toContain('notification-delete-all');
    expect(bulkDeleteBtn.querySelector('span')?.textContent?.trim()).toBe('Eliminar notificaciones');

    // Botón individual tiene aria-label="Eliminar notificación", ícono de papelera y etiqueta para desktop
    const individualDeleteBtns = screen.getAllByRole('button', { name: 'Eliminar notificación' });
    expect(individualDeleteBtns).toHaveLength(2);
    for (const btn of individualDeleteBtns) {
      expect(btn.getAttribute('aria-label')).toBe('Eliminar notificación');
      expect(btn.querySelector('.notification-delete-icon')).not.toBeNull();
      expect(btn.querySelector('.notification-delete-label')?.textContent?.trim()).toBe('Eliminar');
    }

    // Conserva confirmación window.confirm antes de eliminar individualmente
    fireEvent.click(individualDeleteBtns[0]);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(activityMocks.dismissAdminActivityNotificationPersonal).toHaveBeenCalledWith('n-unread');
    });
  });

  it('diferencia notificaciones leídas vs no leídas en Light/Dark Mode (sin fondos sólidos) y adapta Eliminar individual a ícono 44x44 en mobile', () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass-notifications.css'),
      'utf8',
    );

    // Light Mode: acento champagne translúcido en no leídas y lectura neutra en leídas
    const lightSection = css.slice(
      css.indexOf('html[data-theme="light"] .liquid-glass-notification-popover'),
      css.indexOf('/* Dark Mode'),
    );
    expect(lightSection).toContain('--lg-notif-unread-text: #12110f;');
    expect(lightSection).toContain('--lg-notif-read-text:');
    expect(lightSection).toContain('--lg-notif-unread-bg: linear-gradient');

    // Dark Mode: diferenciación nítida sobre cristal obsidiana sin fondos sólidos
    const darkSection = css.slice(
      css.indexOf('html[data-theme="dark"] .liquid-glass-notification-popover'),
      css.indexOf('@supports not (backdrop-filter'),
    );
    expect(darkSection).toContain('--lg-notif-unread-text: #fcfaf5;');
    expect(darkSection).toContain('--lg-notif-read-text:');
    expect(darkSection).toContain('--lg-notif-unread-bg: linear-gradient');
    expect(darkSection).toContain('--lg-notif-unread-time:');
    expect(darkSection).toContain('--lg-notif-read-time:');

    // Pesos y fondos por estado
    expect(css).toMatch(/\.notification-message\s*\{[\s\S]*?color:\s*var\(--lg-notif-read-text\) !important;[\s\S]*?font-weight:\s*400 !important;/);
    expect(css).toMatch(/\.notification-item\.is-unread \.notification-message\s*\{[\s\S]*?color:\s*var\(--lg-notif-unread-text\) !important;[\s\S]*?font-weight:\s*600 !important;/);
    expect(css).toMatch(/\.notification-item\.is-read\s*\{[\s\S]*?background:\s*transparent !important;/);

    // Mobile (<= 767px): Eliminar individual solo ícono >= 44x44 alineado con toggle, manteniendo desktop y Eliminar notificaciones
    const mobileStart = css.indexOf('@media (max-width: 767px)');
    const mobileCss = css.slice(mobileStart, css.indexOf('/* Estructura mínima compartida'));
    expect(mobileCss).toContain('.notification-delete-label');
    expect(mobileCss).toContain('display: none !important;');
    expect(mobileCss).toContain('min-width: 44px !important;');
    expect(mobileCss).toContain('min-height: 44px !important;');
    expect(mobileCss).toContain('align-items: center !important;');
    expect(mobileCss).toContain('justify-content: space-between !important;');
    expect(mobileCss).not.toContain('.notification-delete-all .notification-delete-label');
  });
});
