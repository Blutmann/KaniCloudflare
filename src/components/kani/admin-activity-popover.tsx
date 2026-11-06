import "./notification-inbox.css";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Bell, Mail, MailOpen, Trash2 } from "lucide-react";
import type { AuthenticatedStaff } from "@/lib/kani-auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { notificationGeneratedAt, notificationPhrase, notificationToday } from "@/lib/kani-notification-dates";
import {
  deleteAllAdminActivityNotificationsGlobal,
  extractErrorMessage,
  markAllAdminActivityNotificationsRead,
  readNotificationInbox,
  setAdminActivityNotificationRead,
  type NotificationInbox,
} from "@/lib/kani-admin-activity";
const AppointmentDetail = lazy(() => import("./notification-appointment-detail"));
const empty: NotificationInbox = { items: [], unread_count: 0, through: 0, next_before: null };

export function AdminActivityPopover({
  role = "ADMIN",
  staff,
}: {
  role?: "ADMIN" | "BARBER" | "MANAGER";
  staff?: AuthenticatedStaff;
}) {
  const [inbox, setInbox] = useState(empty);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<{ ids: string[]; scope: 'loaded' | 'single' } | null>(null);
  const [today, setToday] = useState(notificationToday);
  const [busy, setBusy] = useState(false);
  const revision = useRef(0),
    locked = useRef(false);
  const reload = useCallback(async (before: number | null = null) => {
    if (locked.current) return;
    const current = ++revision.current;
    try {
      const next = await readNotificationInbox(before);
      if (current !== revision.current) return;
      setInbox((old) =>
        before === null
          ? next
          : {
              ...next,
              items: [
                ...old.items,
                ...next.items.filter((n) => !old.items.some((o) => o.id === n.id)),
              ],
            },
      );
      setError("");
    } catch (cause) {
      if (current === revision.current) setError(extractErrorMessage(cause));
    }
  }, []);
  useEffect(() => {
    void reload();
    const refresh = () => {
      setToday(notificationToday());
      if (!document.hidden) void reload();
    };
    // Independent of network success: an open card changes wording at the BA day boundary.
    const dayTimer = window.setInterval(() => setToday(notificationToday()), 1000);
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("kani-activity-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      ++revision.current;
      window.clearInterval(timer);
      window.clearInterval(dayTimer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("kani-activity-changed", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload, staff?.user.id]);
  async function mutate(operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    ++revision.current;
    setBusy(true);
    setError("");
    let failure = "";
    try {
      await operation();
    } catch (cause) {
      failure = extractErrorMessage(cause);
    } finally {
      locked.current = false;
      setBusy(false);
      await reload();
      if (failure) setError(failure);
    }
  }
  async function markOpened(id: string) {
    // Called only after current appointment data loaded and authorization succeeded.
    if (inbox.items.find((n) => n.id === id)?.read_at) return;
    await mutate(() => setAdminActivityNotificationRead(id, new Date().toISOString()));
  }
  const closeDetail = () => {
    setSelected(null);
    setOpen(false);
  };
  return (
    <TooltipProvider delayDuration={250}>
      <Popover
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) void reload();
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="notification-trigger header-control-button"
            aria-label={
              inbox.unread_count
                ? `${inbox.unread_count} notificaciones sin leer`
                : "Notificaciones"
            }
          >
            <Bell />
            {inbox.unread_count > 0 && (
              <span className="notification-count" aria-label={`${inbox.unread_count} sin leer`}>
                {inbox.unread_count}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent side="bottom" sideOffset={10} align="end" className="notification-popover">
          <div className="notification-header">
            <h2>Notificaciones</h2>
            <p className="notification-unread-summary">{inbox.unread_count} sin leer</p>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="notification-inbox-toolbar">
            {inbox.unread_count > 0 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const through = inbox.through;
                  void mutate(() => markAllAdminActivityNotificationsRead(through));
                }}
              >
                Marcar todas como leídas
              </Button>
            )}
            {role === "ADMIN" && inbox.items.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setDeletion({ ids: inbox.items.map((n) => n.id), scope: 'loaded' })}
              >
                Eliminar notificaciones
              </Button>
            )}
          </div>
          {!inbox.items.length ? (
            <div className="notification-empty">
              <Bell size={24} />
              <p>No hay notificaciones.</p>
            </div>
          ) : (
            <div className="notification-list">
              {inbox.items.map((notification) => (
                <article
                  key={notification.id}
                  className={`notification-item ${notification.read_at ? "is-read" : "is-unread"}`}
                >
                  <div className="notification-body">
                    <div className="notification-message-row">
                      <p className="notification-message">
                        {notificationPhrase(notification.event_type, notification.client_name, notification.event_date, today)}
                      </p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="notification-toggle notification-icon-action" disabled={busy}
                            aria-label={notification.read_at ? 'Marcar como no leída' : 'Marcar como leída'}
                            onClick={() => void mutate(() => setAdminActivityNotificationRead(notification.id, notification.read_at ? null : new Date().toISOString()))}>
                            {notification.read_at ? <Mail size={15} /> : <MailOpen size={15} />}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="notification-action-tooltip">{notification.read_at ? 'Marcar como no leída' : 'Marcar como leída'}</TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="notification-barber">{notification.barber_name}</p>
                    <div className="notification-meta">
                      <button type="button" className="notification-link notification-detail-link" disabled={busy || !staff}
                        onClick={() => { setOpen(false); setSelected(notification.id); }}>
                        Ver detalles
                      </button>
                      {role === "ADMIN" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" className="notification-delete notification-icon-action" disabled={busy}
                              onClick={(event) => { event.stopPropagation(); setDeletion({ ids: [notification.id], scope: 'single' }); }}
                              aria-label="Eliminar notificación">
                              <Trash2 size={15} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="notification-action-tooltip">Eliminar notificación</TooltipContent>
                        </Tooltip>
                      )}
                      <time dateTime={notification.created_at}
                        title={`Generada el ${notificationGeneratedAt(notification.created_at)} (Buenos Aires)`}
                        aria-label={`Generada el ${notificationGeneratedAt(notification.created_at)}, hora de Buenos Aires`}>
                        {notificationGeneratedAt(notification.created_at)}
                      </time>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {inbox.next_before !== null && (
            <Button variant="ghost" disabled={busy} onClick={() => void reload(inbox.next_before)}>
              Cargar más notificaciones
            </Button>
          )}
        </PopoverContent>
      </Popover>
      <Dialog
        open={selected !== null}
        onOpenChange={(value) => {
          if (!value) closeDetail();
        }}
      >
        <DialogContent
          overlayClassName="notification-dialog-overlay"
          className="v2-dialog notification-detail-dialog"
        >
          <DialogHeader>
            <DialogTitle>Detalle del turno</DialogTitle>
            <DialogDescription>Estado actual del turno y sus cobros.</DialogDescription>
          </DialogHeader>
          {selected && staff && (
            <Suspense fallback={<p role="status">Consultando turno…</p>}>
              <AppointmentDetail
                key={selected}
                notificationId={selected}
                staff={staff}
                onOpened={() => void markOpened(selected)}
                onChanged={() => void reload()}
                onNavigate={closeDetail}
              />
            </Suspense>
          )}
          {error && <p role="alert">{error}</p>}
        </DialogContent>
      </Dialog>
      <Dialog
        open={deletion !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setDeletion(null);
        }}
      >
        <DialogContent
          overlayClassName="notification-dialog-overlay"
          className="v2-dialog notification-confirm-dialog"
        >
          <DialogHeader>
            <DialogTitle>Eliminar notificaciones</DialogTitle>
            <DialogDescription>
              {deletion?.scope === 'loaded'
                ? `Se eliminarán ${deletion.ids.length} notificaciones cargadas en este listado al abrir esta confirmación, de todas las cuentas. No incluye las que aún no se cargaron ni las que lleguen después de abrir esta confirmación.`
                : 'Se eliminará 1 notificación seleccionada de todas las cuentas.'}
              {' '}El turno y sus registros se conservan, junto con la auditoría.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDeletion(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const ids = deletion?.ids;
                if (ids)
                  void mutate(async () => {
                    await deleteAllAdminActivityNotificationsGlobal(ids);
                    setDeletion(null);
                  });
              }}
            >
              {busy ? "Eliminando…" : "Confirmar eliminación"}
            </Button>
          </DialogFooter>
          {error && <p role="alert">{error}</p>}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
