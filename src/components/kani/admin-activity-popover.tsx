import { useEffect, useRef, useState } from 'react';
import { Bell, CalendarDays, CheckCheck, Mail, MailOpen, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
  type AdminActivityEvent,
} from '@/lib/kani-admin-activity';
import '@/components/kani/experimental/liquid-glass-notifications.css';

type NotificationHref = '/admin' | '/admin/horarios' | '/admin-liquid' | '/admin-liquid/horarios';
type AdminNotification = {
  id: string;
  type: 'availability' | 'appointment';
  message: string;
  time: string;
  readAt: string | null;
  href: NotificationHref;
};

function toAdminNotification(event: AdminActivityEvent, useLiquidPaths: boolean): AdminNotification {
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
        ? `${client} reservó un turno con ${event.barber_name}`
        : event.event_type === 'APPOINTMENT_CONFIRMED'
          ? `${actor} confirmó el turno de ${client}`
          : `${actor} rechazó el turno de ${client}`;

  const href: NotificationHref = useLiquidPaths
    ? (isAvailability ? '/admin-liquid/horarios' : '/admin-liquid')
    : (isAvailability ? '/admin/horarios' : '/admin');

  return {
    id: event.id,
    type: isAvailability ? 'availability' : 'appointment',
    message,
    time: new Date(event.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    readAt: event.read_at,
    href,
  };
}

export function AdminActivityPopover({
  role = 'ADMIN',
  userId,
  isLiquid = false,
}: {
  role?: 'ADMIN' | 'MANAGER' | 'BARBER';
  userId?: string;
  isLiquid?: boolean;
}) {
  const [events, setEvents] = useState<AdminActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [desktopAlignOffset, setDesktopAlignOffset] = useState(0);
  const [desktopSideOffset, setDesktopSideOffset] = useState(10);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const effectiveLiquid =
    isLiquid ||
    (typeof document !== 'undefined' &&
      (document.body.classList.contains('liquid-glass-active') ||
        document.querySelector('.liquid-glass-header') !== null));

  const notifications = events.map(event => toAdminNotification(event, effectiveLiquid));
  const unreadNotifications = notifications.filter(notification => !notification.readAt);

  function reload() {
    let cancelled = false;
    setLoading(true);
    readAdminActivityNotifications(userId)
      .then(loaded => { if (!cancelled) setEvents(loaded); })
      .catch(cause => { if (!cancelled) setError(extractErrorMessage(cause, 'No se pudieron cargar las novedades.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }

  useEffect(() => {
    return reload();
  }, [role, userId]);

  useEffect(() => {
    if (!open || !effectiveLiquid || typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const syncGeometry = () => {
      const header = triggerRef.current?.closest('.site-header') ?? document.querySelector('.site-header.liquid-glass-header');
      if (header) {
        const bottom = Math.max(48, Math.round(header.getBoundingClientRect().bottom));
        document.documentElement.style.setProperty('--lg-notif-top', `${bottom}px`);
      }

      if (window.innerWidth >= 768 && triggerRef.current) {
        const controls = triggerRef.current.closest('.header-controls');
        const triggerRect = triggerRef.current.getBoundingClientRect();
        if (header) {
          const headerBottom = Math.round(header.getBoundingClientRect().bottom);
          setDesktopSideOffset(Math.max(10, Math.round(headerBottom - triggerRect.bottom + 10)));
        }
        if (controls) {
          const controlsRect = controls.getBoundingClientRect();
          const rightDelta = Math.max(0, Math.round(controlsRect.right - triggerRect.right));
          setDesktopAlignOffset(-rightDelta);
        }
      } else {
        setDesktopAlignOffset(0);
        setDesktopSideOffset(10);
      }
    };

    syncGeometry();
    window.addEventListener('resize', syncGeometry);
    window.addEventListener('scroll', syncGeometry, { passive: true });
    return () => {
      window.removeEventListener('resize', syncGeometry);
      window.removeEventListener('scroll', syncGeometry);
      document.documentElement.style.removeProperty('--lg-notif-top');
    };
  }, [open, effectiveLiquid]);

  async function toggleNotificationRead(notification: AdminNotification) {
    const readAt = notification.readAt ? null : new Date().toISOString();
    try {
      await setAdminActivityNotificationRead(notification.id, readAt);
      setEvents(current => current.map(item => item.id === notification.id ? { ...item, read_at: readAt } : item));
    } catch (cause) {
      setError(extractErrorMessage(cause, 'No se pudo actualizar la notificación.'));
    }
  }

  async function markAllNotificationsRead() {
    if (!unreadNotifications.length) return;
    try {
      await markAllAdminActivityNotificationsRead(events.map(n => n.id));
      const readAt = new Date().toISOString();
      setEvents(current => current.map(item => ({ ...item, read_at: readAt })));
    } catch (cause) {
      setError(extractErrorMessage(cause, 'No se pudieron marcar las notificaciones.'));
    }
  }

  async function markAllNotificationsUnread() {
    const hasRead = notifications.some(item => Boolean(item.readAt));
    if (!hasRead) return;
    try {
      await markAllAdminActivityNotificationsUnread(events.map(n => n.id));
      setEvents(current => current.map(item => ({ ...item, read_at: null })));
    } catch (cause) {
      setError(extractErrorMessage(cause, 'No se pudieron marcar las notificaciones como no leídas.'));
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
      setEvents(current => current.filter(item => item.id !== notification.id));
    } catch (cause) {
      setError(extractErrorMessage(cause, 'No se pudo eliminar la notificación.'));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleConfirmDeleteAll() {
    try {
      setIsDeletingAll(true);
      setError('');
      const ids = events.map(n => n.id);
      if (role === 'ADMIN') {
        await deleteAllAdminActivityNotificationsGlobal(ids);
      } else {
        await dismissAllAdminActivityNotificationsPersonal(ids);
      }
      setEvents([]);
      setConfirmDeleteAllOpen(false);
    } catch (cause) {
      setError(extractErrorMessage(cause, 'No se pudieron eliminar las notificaciones.'));
    } finally {
      setIsDeletingAll(false);
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            variant="outline"
            size="icon"
            className="notification-trigger header-control-button"
            aria-label={unreadNotifications.length ? `${unreadNotifications.length} notificaciones sin leer` : 'Notificaciones'}
            aria-expanded={open}
          >
            <Bell />
            {unreadNotifications.length > 0 && (
              <span className="notification-count" aria-label={`${unreadNotifications.length} sin leer`}>
                {unreadNotifications.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          sideOffset={effectiveLiquid ? desktopSideOffset : 10}
          align="end"
          alignOffset={effectiveLiquid ? desktopAlignOffset : 0}
          collisionPadding={{ top: 12, right: 16, bottom: 16, left: 16 }}
          onInteractOutside={event => {
            if (confirmDeleteAllOpen) event.preventDefault();
          }}
          className={effectiveLiquid ? 'notification-popover liquid-glass-notification-popover' : 'notification-popover'}
        >
          <div className="notification-header">
            <div className="notification-header-main">
              <div className="notification-title-row">
                <h2 className="notification-title">Notificaciones</h2>
                {!loading && unreadNotifications.length > 0 && (
                  <span className="notification-unread-pill" aria-label={`${unreadNotifications.length} sin leer`}>
                    {unreadNotifications.length} sin leer
                  </span>
                )}
              </div>
              <p className="notification-unread-summary">
                {loading
                  ? 'Cargando novedades...'
                  : notifications.length === 0
                    ? 'Sin novedades pendientes'
                    : unreadNotifications.length > 0
                      ? `${notifications.length} ${notifications.length === 1 ? 'registro reciente' : 'registros recientes'}`
                      : 'Todas leídas'}
              </p>
            </div>
            <button
              type="button"
              className="notification-close-btn"
              aria-label="Cerrar notificaciones"
              onClick={() => setOpen(false)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          {error && <p role="alert" className="notification-error text-xs text-destructive">{error}</p>}

          {notifications.length > 0 && (
            <div className="notification-bulk-bar">
              {unreadNotifications.length > 0 ? (
                <button
                  type="button"
                  className="notification-mark-all"
                  onClick={() => void markAllNotificationsRead()}
                >
                  <CheckCheck size={14} aria-hidden="true" />
                  <span>Marcar todas como leídas</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="notification-mark-all"
                  onClick={() => void markAllNotificationsUnread()}
                >
                  <Mail size={14} aria-hidden="true" />
                  <span>Marcar todas como no leídas</span>
                </button>
              )}
              <button
                type="button"
                className="notification-delete-all"
                onClick={() => setConfirmDeleteAllOpen(true)}
              >
                <Trash2 size={13} aria-hidden="true" />
                <span>Eliminar notificaciones</span>
              </button>
            </div>
          )}

          {loading && notifications.length === 0 ? (
            <div className="notification-empty" role="status">
              <Bell size={22} aria-hidden="true" />
              <p>Cargando novedades...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="notification-empty">
              <Bell size={22} aria-hidden="true" />
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
                    <Link
                      to={notification.href}
                      className="notification-link"
                      aria-label={notification.message}
                      onClick={() => setOpen(false)}
                    >
                      <p className="notification-message">{notification.message}</p>
                      <div className="notification-time-row">
                        {!notification.readAt && <span className="notification-unread-dot" aria-hidden="true" />}
                        <time>{notification.time}</time>
                        {!notification.readAt && <span className="notification-state-label">Sin leer</span>}
                      </div>
                    </Link>
                    <div className="notification-meta">
                      <button type="button" className="notification-toggle" onClick={() => void toggleNotificationRead(notification)}>
                        {notification.readAt ? (
                          <>
                            <Mail size={12} aria-hidden="true" />
                            <span>Marcar como no leída</span>
                          </>
                        ) : (
                          <>
                            <MailOpen size={12} aria-hidden="true" />
                            <span>Marcar como leída</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className="notification-delete"
                        title={role === 'ADMIN' ? 'Eliminar notificación globalmente' : 'Eliminar de mi vista'}
                        disabled={deletingId === notification.id}
                        onClick={() => void handleDeleteNotification(notification)}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                        <span>Eliminar</span>
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>

      <Dialog open={confirmDeleteAllOpen} onOpenChange={openState => {
        setConfirmDeleteAllOpen(openState);
        if (!openState) setError('');
      }}>
        <DialogContent className="sm:max-w-md kani-notif-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Eliminar notificaciones</DialogTitle>
            <DialogDescription className="text-sm pt-2 text-foreground font-normal">
              ¿Estás seguro que deseas eliminar todas las notificaciones?
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
          <DialogFooter className="flex flex-row justify-end gap-2 mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDeleteAllOpen(false)}
              disabled={isDeletingAll}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirmDeleteAll()}
              disabled={isDeletingAll}
            >
              {isDeletingAll ? 'Eliminando...' : 'Eliminar notificaciones'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
