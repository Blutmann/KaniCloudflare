import { useEffect, useState } from 'react';
import { Bell, CalendarDays, Mail, MailOpen, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  deleteAdminActivityNotificationGlobal,
  dismissAdminActivityNotificationPersonal,
  markAllAdminActivityNotificationsRead,
  readAdminActivityNotifications,
  setAdminActivityNotificationRead,
  type AdminActivityEvent,
} from '@/lib/kani-admin-activity';

type NotificationHref = '/admin' | '/admin/horarios';
type AdminNotification = {
  id: string;
  type: 'availability' | 'appointment';
  message: string;
  time: string;
  readAt: string | null;
  href: NotificationHref;
};

function toAdminNotification(event: AdminActivityEvent): AdminNotification {
  const date = new Date(`${event.event_date}T12:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  const time = event.event_time?.slice(0, 5) ?? '--:--';
  const client = event.client_name ?? 'cliente';
  const actor = event.actor_display_name === 'KANI Admin' ? 'Kani Admin' : event.actor_display_name.replace('Personal KANI', 'Kani Barber Studio');
  const isAvailability = event.event_type.startsWith('AVAILABILITY');
  const message = event.event_type === 'AVAILABILITY_UNAVAILABLE'
    ? `${actor} bloqueó el horario del ${date} a las ${time}`
    : event.event_type === 'AVAILABILITY_AVAILABLE'
      ? `${actor} liberó el horario del ${date} a las ${time}`
      : event.event_type === 'APPOINTMENT_REQUESTED'
        ? `${client} solicitó un turno con ${event.barber_name}`
        : event.event_type === 'APPOINTMENT_CONFIRMED'
          ? `${actor} confirmó el turno de ${client}`
          : `${actor} rechazó el turno de ${client}`;

  return {
    id: event.id,
    type: isAvailability ? 'availability' : 'appointment',
    message,
    time: new Date(event.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    readAt: event.read_at,
    href: isAvailability ? '/admin/horarios' : '/admin',
  };
}

export function AdminActivityPopover({ role = 'ADMIN' }: { role?: 'ADMIN' | 'BARBER' }) {
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const unreadNotifications = notifications.filter(notification => !notification.readAt);

  function reload() {
    let cancelled = false;
    readAdminActivityNotifications()
      .then(events => { if (!cancelled) setNotifications(events.map(toAdminNotification)); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las novedades.'); });
    return () => { cancelled = true; };
  }

  useEffect(() => {
    return reload();
  }, [role]);

  async function toggleNotificationRead(notification: AdminNotification) {
    const readAt = notification.readAt ? null : new Date().toISOString();
    try {
      await setAdminActivityNotificationRead(notification.id, readAt);
      setNotifications(current => current.map(item => item.id === notification.id ? { ...item, readAt } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la notificación.');
    }
  }

  async function markAllNotificationsRead() {
    if (!unreadNotifications.length) return;
    try {
      await markAllAdminActivityNotificationsRead();
      const readAt = new Date().toISOString();
      setNotifications(current => current.map(item => ({ ...item, readAt })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron marcar las notificaciones.');
    }
  }

  async function handleDeleteNotification(notification: AdminNotification) {
    const isGlobal = role === 'ADMIN';
    const confirmMessage = isGlobal
      ? '¿Eliminar notificación globalmente? Esta acción borrará el registro de forma permanente para todos los usuarios.'
      : '¿Eliminar notificación de tu vista? La notificación ya no se mostrará en tu cuenta, pero seguirá visible para el Administrador.';

    if (!window.confirm(confirmMessage)) return;

    try {
      setDeletingId(notification.id);
      if (isGlobal) {
        await deleteAdminActivityNotificationGlobal(notification.id);
      } else {
        await dismissAdminActivityNotificationPersonal(notification.id);
      }
      setNotifications(current => current.filter(item => item.id !== notification.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo eliminar la notificación.');
    } finally {
      setDeletingId(null);
    }
  }

  return <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" size="icon" className="notification-trigger" aria-label={unreadNotifications.length ? `${unreadNotifications.length} notificaciones sin leer` : 'Notificaciones'}>
        <Bell />
        {unreadNotifications.length > 0 && <span className="notification-count" aria-label={`${unreadNotifications.length} sin leer`}>{unreadNotifications.length}</span>}
      </Button>
    </PopoverTrigger>
    <PopoverContent side="bottom" sideOffset={10} align="end" className="notification-popover">
      <div className="notification-header">
        <div>
          <span className="eyebrow">ACTIVIDAD</span>
          <h2 className="mt-1 text-lg">Notificaciones</h2>
          <p className="notification-unread-summary">{unreadNotifications.length ? `${unreadNotifications.length} sin leer` : 'Todas leídas'}</p>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
      {unreadNotifications.length > 0 && (
        <Button variant="ghost" className="notification-mark-all" onClick={() => void markAllNotificationsRead()}>
          Marcar todas como leídas
        </Button>
      )}
      {notifications.length === 0 ? (
        <div className="notification-empty">
          <Bell size={24} />
          <p>No hay novedades recientes.</p>
        </div>
      ) : (
        <div className="notification-list">
          {notifications.map(notification => (
            <article key={notification.id} className={`notification-item ${notification.readAt ? 'is-read' : 'is-unread'}`}>
              <span className={`notification-kind ${notification.type}`} aria-hidden="true">
                {notification.type === 'availability' ? <SlidersHorizontal size={13} /> : <CalendarDays size={13} />}
              </span>
              <div className="notification-body">
                <Link to={notification.href} className="notification-link" aria-label={notification.message}>
                  <p className="text-sm leading-relaxed">{notification.message}</p>
                  <time>{notification.time}</time>
                </Link>
                <div className="notification-meta flex items-center justify-between gap-2 mt-2">
                  <button type="button" className="notification-toggle" onClick={() => void toggleNotificationRead(notification)}>
                    {notification.readAt ? <><Mail size={13} /> Marcar como no leída</> : <><MailOpen size={13} /> Marcar como leída</>}
                  </button>
                  <button
                    type="button"
                    className="notification-delete text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors p-1"
                    title={role === 'ADMIN' ? 'Eliminar notificación globalmente' : 'Eliminar de mi vista'}
                    disabled={deletingId === notification.id}
                    onClick={() => void handleDeleteNotification(notification)}
                  >
                    <Trash2 size={13} />
                    <span>Eliminar</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </PopoverContent>
  </Popover>;
}
