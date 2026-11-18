import { useCallback, useEffect, useRef, useState } from 'react';
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
  dismissAllAdminActivityNotificationsPersonal,
  dismissAdminActivityNotificationPersonal,
  extractErrorMessage,
  markAllAdminActivityNotificationsRead,
  markAllAdminActivityNotificationsUnread,
  readAdminActivityNotifications,
  setAdminActivityNotificationRead,
  subscribeAdminActivityChanges,
  type AdminActivityEvent,
} from '@/lib/kani-admin-activity';
import '@/components/kani/experimental/liquid-glass-notifications.css';

type NotificationHref =
  | '/panel-administracion'
  | '/panel-horarios'
  | '/panel-administracion-old'
  | '/panel-administracion-old/horarios';
type AdminNotification = {
  id: string;
  type: 'availability' | 'appointment';
  message: string;
  time: string;
  readAt: string | null;
  href: NotificationHref;
};

function dedupeActivityEvents(events: AdminActivityEvent[]): AdminActivityEvent[] {
  const seen = new Set<string>();
  const unique: AdminActivityEvent[] = [];
  for (const event of events) {
    if (!event?.id || seen.has(event.id)) continue;
    seen.add(event.id);
    unique.push(event);
  }
  return unique;
}

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
    ? (isAvailability ? '/panel-horarios' : '/panel-administracion')
    : (isAvailability ? '/panel-administracion-old/horarios' : '/panel-administracion-old');

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
  const [readingId, setReadingId] = useState<string | null>(null);
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [isBulkReading, setIsBulkReading] = useState(false);
  const [desktopAlignOffset, setDesktopAlignOffset] = useState(0);
  const [desktopSideOffset, setDesktopSideOffset] = useState(10);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  const fetchEpochRef = useRef(0);
  const deletingIdsRef = useRef(new Set<string>());
  const readingIdsRef = useRef(new Set<string>());
  const bulkBusyRef = useRef(false);
  const confirmDeleteCutoffRef = useRef<string | null>(null);
  const lastSyncAtRef = useRef(0);

  function getLatestNotificationTimestamp(list: AdminActivityEvent[]): string | undefined {
    let latest: string | undefined;
    for (const item of list) {
      if (item.created_at && (!latest || item.created_at > latest)) {
        latest = item.created_at;
      }
    }
    return latest;
  }

  const effectiveLiquid =
    isLiquid ||
    (typeof document !== 'undefined' &&
      (document.body.classList.contains('liquid-glass-active') ||
        document.querySelector('.liquid-glass-header') !== null));

  const notifications = events.map(event => toAdminNotification(event, effectiveLiquid));
  const unreadNotifications = notifications.filter(notification => !notification.readAt);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadNotifications = useCallback(
    async ({
      showLoading = false,
      preserveError = false,
    }: { showLoading?: boolean; preserveError?: boolean } = {}) => {
      const epoch = ++fetchEpochRef.current;
      if (showLoading) {
        setLoading(true);
      }
      if (!preserveError) {
        setError('');
      }
      try {
        const loaded = await readAdminActivityNotifications(userId);
        if (!mountedRef.current || epoch !== fetchEpochRef.current) return;
        setEvents(dedupeActivityEvents(loaded));
      } catch (cause) {
        if (!mountedRef.current || epoch !== fetchEpochRef.current) return;
        if (!preserveError) {
          setError(extractErrorMessage(cause, 'No se pudieron cargar las novedades.'));
        }
      } finally {
        if (mountedRef.current && epoch === fetchEpochRef.current) {
          setLoading(false);
        }
      }
    },
    [userId],
  );

  useEffect(() => {
    // Al cambiar de cuenta/usuario, reiniciar estado local y recargar desde la base de datos
    fetchEpochRef.current += 1;
    deletingIdsRef.current.clear();
    readingIdsRef.current.clear();
    bulkBusyRef.current = false;
    confirmDeleteCutoffRef.current = null;
    setEvents([]);
    setError('');
    setConfirmDeleteAllOpen(false);
    setOpen(false);
    void loadNotifications({ showLoading: true });
  }, [role, userId, loadNotifications]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleActivityChanged = () => {
      void loadNotifications({ showLoading: false });
    };
    const handleForegroundSync = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastSyncAtRef.current < 1500) return;
      lastSyncAtRef.current = now;
      void loadNotifications({ showLoading: false, preserveError: true });
    };
    window.addEventListener('kani-activity-changed', handleActivityChanged);
    window.addEventListener('focus', handleForegroundSync);
    document.addEventListener('visibilitychange', handleForegroundSync);
    const unsubscribeRealtime =
      userId && typeof subscribeAdminActivityChanges === 'function'
        ? subscribeAdminActivityChanges(userId, () => {
            void loadNotifications({ showLoading: false, preserveError: true });
          })
        : () => {};
    return () => {
      window.removeEventListener('kani-activity-changed', handleActivityChanged);
      window.removeEventListener('focus', handleForegroundSync);
      document.removeEventListener('visibilitychange', handleForegroundSync);
      unsubscribeRealtime();
    };
  }, [userId, loadNotifications]);

  useEffect(() => {
    if (open) {
      void loadNotifications({ showLoading: false });
    }
  }, [open, loadNotifications]);

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
    if (readingIdsRef.current.has(notification.id) || bulkBusyRef.current) return;
    readingIdsRef.current.add(notification.id);
    setReadingId(notification.id);
    setError('');
    // Invalidar lecturas previas en vuelo para evitar que sobreescriban esta mutación
    fetchEpochRef.current += 1;

    const readAt = notification.readAt ? null : new Date().toISOString();
    try {
      await setAdminActivityNotificationRead(notification.id, readAt);
      fetchEpochRef.current += 1;
      setEvents(current => current.map(item => (item.id === notification.id ? { ...item, read_at: readAt } : item)));
    } catch (cause) {
      setError(extractErrorMessage(cause, 'No se pudo actualizar la notificación.'));
      void loadNotifications({ showLoading: false, preserveError: true });
    } finally {
      readingIdsRef.current.delete(notification.id);
      setReadingId(current => (current === notification.id ? null : current));
    }
  }

  async function markAllNotificationsRead() {
    if (!unreadNotifications.length || bulkBusyRef.current) return;
    bulkBusyRef.current = true;
    setIsBulkReading(true);
    setError('');
    fetchEpochRef.current += 1;

    const cutoff = getLatestNotificationTimestamp(events);
    try {
      await markAllAdminActivityNotificationsRead(events.map(n => n.id), cutoff);
      fetchEpochRef.current += 1;
      const readAt = new Date().toISOString();
      setEvents(current =>
        current.map(item =>
          !cutoff || !item.created_at || item.created_at <= cutoff
            ? { ...item, read_at: item.read_at ?? readAt }
            : item,
        ),
      );
    } catch (cause) {
      setError(extractErrorMessage(cause, 'No se pudieron marcar las notificaciones.'));
      void loadNotifications({ showLoading: false, preserveError: true });
    } finally {
      bulkBusyRef.current = false;
      setIsBulkReading(false);
    }
  }

  async function markAllNotificationsUnread() {
    const hasRead = notifications.some(item => Boolean(item.readAt));
    if (!hasRead || bulkBusyRef.current) return;
    bulkBusyRef.current = true;
    setIsBulkReading(true);
    setError('');
    fetchEpochRef.current += 1;

    try {
      await markAllAdminActivityNotificationsUnread(events.map(n => n.id));
      fetchEpochRef.current += 1;
      setEvents(current => current.map(item => ({ ...item, read_at: null })));
    } catch (cause) {
      setError(extractErrorMessage(cause, 'No se pudieron marcar las notificaciones como no leídas.'));
      void loadNotifications({ showLoading: false, preserveError: true });
    } finally {
      bulkBusyRef.current = false;
      setIsBulkReading(false);
    }
  }

  async function handleDeleteNotification(notification: AdminNotification) {
    if (deletingIdsRef.current.has(notification.id) || bulkBusyRef.current) return;

    const confirmMessage =
      '¿Eliminar esta notificación de tu cuenta? Ya no volverá a mostrarse en tu sesión, sin afectar a otros usuarios.';
    if (!window.confirm(confirmMessage)) return;

    deletingIdsRef.current.add(notification.id);
    setDeletingId(notification.id);
    setError('');
    fetchEpochRef.current += 1;

    try {
      await dismissAdminActivityNotificationPersonal(notification.id);
      fetchEpochRef.current += 1;
      setEvents(current => current.filter(item => item.id !== notification.id));
    } catch (cause) {
      setError(extractErrorMessage(cause, 'No se pudo eliminar la notificación.'));
      void loadNotifications({ showLoading: false, preserveError: true });
    } finally {
      deletingIdsRef.current.delete(notification.id);
      setDeletingId(current => (current === notification.id ? null : current));
    }
  }

  async function handleConfirmDeleteAll() {
    if (bulkBusyRef.current || isDeletingAll) return;
    bulkBusyRef.current = true;
    setIsDeletingAll(true);
    setError('');
    fetchEpochRef.current += 1;

    const cutoff = confirmDeleteCutoffRef.current ?? getLatestNotificationTimestamp(events);
    try {
      const ids = events.map(n => n.id);
      await dismissAllAdminActivityNotificationsPersonal(ids, cutoff);
      fetchEpochRef.current += 1;
      const dismissedSet = new Set(ids);
      setEvents(current =>
        current.filter(item => {
          if (cutoff && item.created_at) {
            return item.created_at > cutoff;
          }
          return !dismissedSet.has(item.id);
        }),
      );
      confirmDeleteCutoffRef.current = null;
      setConfirmDeleteAllOpen(false);
      // Resincronizar con servidor para mostrar inmediatamente notificaciones generadas tras `cutoff`
      void loadNotifications({ showLoading: false, preserveError: true });
    } catch (cause) {
      setError(extractErrorMessage(cause, 'No se pudieron eliminar las notificaciones.'));
      void loadNotifications({ showLoading: false, preserveError: true });
    } finally {
      bulkBusyRef.current = false;
      setIsDeletingAll(false);
    }
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={nextOpen => {
          if (confirmDeleteAllOpen && !nextOpen) return;
          setOpen(nextOpen);
        }}
      >
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
          data-confirm-open={confirmDeleteAllOpen ? 'true' : 'false'}
          onInteractOutside={event => {
            if (confirmDeleteAllOpen) event.preventDefault();
          }}
          onPointerDownOutside={event => {
            if (confirmDeleteAllOpen) event.preventDefault();
          }}
          onFocusOutside={event => {
            if (confirmDeleteAllOpen) event.preventDefault();
          }}
          onEscapeKeyDown={event => {
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

          {error && !confirmDeleteAllOpen && (
            <p role="alert" className="notification-error text-xs text-destructive">
              {error}
            </p>
          )}

          {notifications.length > 0 && (
            <div className="notification-bulk-bar">
              {unreadNotifications.length > 0 ? (
                <button
                  type="button"
                  className="notification-mark-all"
                  disabled={isBulkReading || isDeletingAll}
                  onClick={() => void markAllNotificationsRead()}
                >
                  <CheckCheck size={14} aria-hidden="true" />
                  <span>Marcar todas como leídas</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="notification-mark-all"
                  disabled={isBulkReading || isDeletingAll}
                  onClick={() => void markAllNotificationsUnread()}
                >
                  <Mail size={14} aria-hidden="true" />
                  <span>Marcar todas como no leídas</span>
                </button>
              )}
              <button
                type="button"
                className="notification-delete-all"
                disabled={isDeletingAll || isBulkReading}
                onClick={() => {
                  setError('');
                  confirmDeleteCutoffRef.current = getLatestNotificationTimestamp(events) ?? new Date().toISOString();
                  setConfirmDeleteAllOpen(true);
                }}
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
                      <button
                        type="button"
                        className="notification-toggle"
                        disabled={readingId === notification.id || deletingId === notification.id || isDeletingAll}
                        onClick={() => void toggleNotificationRead(notification)}
                      >
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
                        aria-label="Eliminar notificación"
                        title="Eliminar de mi vista"
                        disabled={deletingId === notification.id || isDeletingAll}
                        onClick={() => void handleDeleteNotification(notification)}
                      >
                        <Trash2 size={13} aria-hidden="true" className="notification-delete-icon" />
                        <span className="notification-delete-label">Eliminar</span>
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>

      <Dialog
        open={confirmDeleteAllOpen}
        modal={true}
        onOpenChange={openState => {
          if (isDeletingAll && !openState) return;
          setConfirmDeleteAllOpen(openState);
          if (!openState) setError('');
        }}
      >
        <DialogContent
          transitionMode="container-transform"
          overlayClassName={effectiveLiquid ? 'kani-notif-confirm-overlay liquid-glass-confirm-overlay' : 'kani-notif-confirm-overlay'}
          className={
            effectiveLiquid
              ? 'sm:max-w-md translate-x-0 translate-y-0 kani-notif-confirm-dialog liquid-glass-confirm-dialog'
              : 'sm:max-w-md translate-x-0 translate-y-0 kani-notif-confirm-dialog'
          }
        >
          <DialogHeader>
            <DialogTitle>Eliminar notificaciones</DialogTitle>
            <DialogDescription className="text-sm pt-2 text-foreground font-normal">
              ¿Estás seguro que deseas eliminar todas tus notificaciones? Dejarán de mostrarse en tu cuenta sin afectar a otros usuarios.
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
          <DialogFooter className="kani-notif-confirm-footer flex flex-row justify-end gap-2.5 mt-4">
            <Button
              type="button"
              variant="outline"
              className="kani-notif-confirm-cancel"
              onClick={() => setConfirmDeleteAllOpen(false)}
              disabled={isDeletingAll}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="kani-notif-confirm-destructive v2-destructive"
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
