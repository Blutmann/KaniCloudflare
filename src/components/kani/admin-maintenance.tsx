import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import {
  cleanupAppointmentRecords,
  cleanupAvailabilityNotifications,
  cleanupStatusOptions,
  countAvailabilityNotifications,
  reauthenticateAdmin,
  type AvailabilityMaintenanceResult,
  type CleanupStatus,
  type MaintenanceResult,
} from '@/lib/kani-maintenance';
import { useAdminStaff } from '@/lib/kani-admin-context';
import { GoogleCalendarAdminSection } from '@/components/kani/google-calendar-admin-section';
import { BenefitCodesAdminSection } from '@/components/kani/admin-benefit-codes-section';

export function AdminMaintenance() {
  const staff = useAdminStaff();
  const isAdmin = staff.profile.role === 'ADMIN';

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.dataset.adminInternal = 'true';
      return () => {
        delete document.body.dataset.adminInternal;
      };
    }
  }, []);

  const [selectedStatuses, setSelectedStatuses] = useState<CleanupStatus[]>([]);
  const [password, setPassword] = useState('');
  const [reauthOpen, setReauthOpen] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<MaintenanceResult | null>(null);
  const [availabilityCount, setAvailabilityCount] = useState<number | null>(null);
  const [availabilityConfirmationOpen, setAvailabilityConfirmationOpen] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [availabilityResult, setAvailabilityResult] = useState<AvailabilityMaintenanceResult | null>(null);

  const selectedLabels = useMemo(
    () => cleanupStatusOptions.filter(option => selectedStatuses.includes(option.value)).map(option => option.label),
    [selectedStatuses],
  );

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void countAvailabilityNotifications()
      .then(count => { if (!cancelled) setAvailabilityCount(count); })
      .catch(cause => { if (!cancelled) setAvailabilityError(cause instanceof Error ? cause.message : 'No se pudo consultar el historial de disponibilidad.'); });
    return () => { cancelled = true; };
  }, [isAdmin]);

  function toggleStatus(status: CleanupStatus) {
    setResult(null);
    setError('');
    setSelectedStatuses(current => current.includes(status) ? current.filter(value => value !== status) : [...current, status]);
  }

  async function handleReauthentication() {
    setBusy(true);
    setError('');
    try {
      await reauthenticateAdmin(password);
      setPassword('');
      setReauthOpen(false);
      setConfirmationOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo verificar la identidad.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCleanup() {
    setBusy(true);
    setError('');
    try {
      setConfirmationOpen(false);
      setResult(await cleanupAppointmentRecords(selectedStatuses));
      setSelectedStatuses([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar el mantenimiento.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAvailabilityCleanup() {
    setAvailabilityBusy(true);
    setAvailabilityError('');
    try {
      setAvailabilityConfirmationOpen(false);
      const cleanupResult = await cleanupAvailabilityNotifications();
      setAvailabilityResult(cleanupResult);
      setAvailabilityCount(0);
    } catch (cause) {
      setAvailabilityError(cause instanceof Error ? cause.message : 'No se pudo eliminar el historial de disponibilidad.');
    } finally {
      setAvailabilityBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <main className="site-container v2-page admin-maintenance-page" role="main">
        <section className="v2-panel max-w-xl mx-auto my-8 p-6" aria-labelledby="maintenance-unauthorized">
          <span className="v2-eyebrow eyebrow">ACCESO RESTRINGIDO</span>
          <h2 id="maintenance-unauthorized" className="mt-2 text-2xl font-semibold">
            Solo administradores
          </h2>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            El panel de mantenimiento está reservado exclusivamente para cuentas con rol ADMIN.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="site-container v2-page admin-maintenance-page" aria-labelledby="maintenance-title" role="main">
      <div className="v2-page-title">
        <div>
          <h1 id="maintenance-title">Mantenimiento.</h1>
        </div>
      </div>

      {/* Fila propia a todo el ancho (100%) para Descuentos y Beneficios */}
      <section className="maintenance-benefit-codes-full-row w-full mb-6" aria-label="Gestión de descuentos y beneficios">
        <BenefitCodesAdminSection />
      </section>

      <div className="maintenance-grid">
        {/* Columna 1: Google Calendar + Limpiar registros de prueba */}
        <div className="maintenance-col maintenance-appointments-col space-y-4">
          <GoogleCalendarAdminSection />

          <section className="v2-panel maintenance-card" aria-labelledby="cleanup-appointments-heading">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 shrink-0 text-gold" size={20} aria-hidden="true" />
              <div className="min-w-0">
                <h2 id="cleanup-appointments-heading" className="text-base font-medium">Limpiar registros de prueba</h2>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                  Elegí qué estados de turnos querés eliminar después de una etapa de pruebas. La acción es irreversible y requiere volver a verificar tu identidad.
                </p>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Estados a eliminar</span>
                <span className="text-xs text-muted-foreground">
                  {selectedStatuses.length} {selectedStatuses.length === 1 ? 'seleccionado' : 'seleccionados'}
                </span>
              </div>
              <div className="maintenance-status-grid">
                {cleanupStatusOptions.map(option => (
                  <label
                    key={option.value}
                    className={`maintenance-status-option ${selectedStatuses.includes(option.value) ? 'selected' : ''}`}
                  >
                    <Checkbox
                      checked={selectedStatuses.includes(option.value)}
                      onCheckedChange={() => toggleStatus(option.value)}
                      aria-label={`Seleccionar ${option.label}`}
                    />
                    <span className="maintenance-status-text">
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {selectedLabels.length > 0 && (
              <div className="maintenance-summary mt-5">
                <span className="v2-eyebrow eyebrow">RESUMEN</span>
                <p className="mt-1 text-sm">
                  Se eliminarán: <strong>{selectedLabels.join(', ')}</strong>.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  También se eliminarán las notificaciones administrativas y eventos de email vinculados a esos turnos.
                </p>
              </div>
            )}

            {error && (
              <div role="alert" className="notice v2-alert-notice mt-5 text-destructive">
                <AlertTriangle size={16} className="shrink-0" />
                <span className="min-w-0 break-words">{error}</span>
              </div>
            )}
            {result && (
              <div role="status" className="notice v2-success-notice mt-5">
                <Check size={16} className="shrink-0" />
                <span className="min-w-0 break-words">
                  Se eliminaron {result.appointments_deleted} turnos, {result.admin_notifications_deleted} notificaciones y {result.notification_events_deleted} eventos de email.
                </span>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-border flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <Button
                className="v2-destructive action-brand w-full sm:w-auto"
                disabled={selectedStatuses.length === 0 || busy}
                onClick={() => { setError(''); setReauthOpen(true); }}
              >
                <Trash2 size={16} className="shrink-0" />
                <span>Eliminar registros</span>
              </Button>
            </div>
          </section>
        </div>

        {/* Columna 2: Historial de disponibilidad + Siempre se conserva */}
        <div className="maintenance-col maintenance-side-col space-y-4">
          <section className="v2-panel maintenance-availability-card" aria-labelledby="availability-history-title">
            <span className="v2-eyebrow eyebrow">HISTORIAL</span>
            <h2 id="availability-history-title" className="mt-1 text-base font-medium">Historial de disponibilidad</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Eliminá las notificaciones históricas de horarios bloqueados y liberados. Esta acción no modifica la disponibilidad actual de los barberos.
            </p>

            <div className="mt-4 p-4 rounded-[var(--radius-control)] bg-[var(--v2-inset)] border border-border flex items-center justify-between gap-4">
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider block">Notificaciones eliminables</span>
                <strong className="mt-1 block text-3xl font-semibold text-foreground">
                  {availabilityCount === null ? '—' : availabilityCount}
                </strong>
              </div>
              <ShieldCheck className="shrink-0 text-gold opacity-80" size={28} aria-hidden="true" />
            </div>

            {availabilityError && (
              <div role="alert" className="notice v2-alert-notice mt-4 text-destructive">
                <AlertTriangle size={16} className="shrink-0" />
                <span className="min-w-0 break-words">{availabilityError}</span>
              </div>
            )}
            {availabilityResult && (
              <div role="status" className="notice v2-success-notice mt-4">
                <Check size={16} className="shrink-0" />
                <span className="min-w-0 break-words">
                  Se eliminaron {availabilityResult.notifications_deleted} notificaciones de disponibilidad.
                </span>
              </div>
            )}
            {availabilityCount === 0 && !availabilityError && (
              <p className="mt-4 text-xs text-muted-foreground">
                No hay notificaciones de disponibilidad para eliminar.
              </p>
            )}

            <div className="mt-5 pt-4 border-t border-border flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <Button
                className="v2-destructive action-brand w-full sm:w-auto"
                disabled={availabilityCount === null || availabilityCount === 0 || availabilityBusy}
                onClick={() => { setAvailabilityError(''); setAvailabilityResult(null); setAvailabilityConfirmationOpen(true); }}
              >
                <Trash2 size={16} className="shrink-0" />
                <span>Eliminar notificaciones</span>
              </Button>
            </div>
          </section>

          <section className="v2-panel maintenance-preserve-card" aria-labelledby="preserve-heading">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 shrink-0 text-gold" size={20} aria-hidden="true" />
              <div className="min-w-0">
                <h3 id="preserve-heading" className="text-sm font-medium">Siempre se conserva</h3>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  Clientes, usuarios Auth, perfiles, roles, barberos, servicios, precios, horarios y notas internas, datos de transferencia, notificaciones de disponibilidad, configuraciones y la secuencia de reservas.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Diálogo de verificación de identidad */}
      <Dialog open={reauthOpen} onOpenChange={open => { if (!busy) setReauthOpen(open); }}>
        <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-md p-5 sm:p-6 rounded-[var(--radius-card)]">
          <DialogTitle className="text-lg font-medium">Verificar identidad</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Ingresá la contraseña actual de tu cuenta ADMIN. No se almacena ni se envía a servicios propios.
          </DialogDescription>
          <div className="mt-4">
            <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5" htmlFor="maintenance-password">
              Contraseña actual
            </label>
            <input
              id="maintenance-password"
              className="maintenance-input input-control"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              value={password}
              onChange={event => setPassword(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && password) void handleReauthentication(); }}
            />
          </div>
          <DialogFooter className="mt-5 flex flex-col-reverse sm:flex-row gap-2.5">
            <Button
              variant="outline"
              className="v2-secondary w-full sm:w-auto min-h-[44px]"
              disabled={busy}
              onClick={() => { setPassword(''); setReauthOpen(false); }}
            >
              Cancelar
            </Button>
            <Button
              className="v2-primary action-positive w-full sm:w-auto min-h-[44px]"
              disabled={!password || busy}
              onClick={() => void handleReauthentication()}
            >
              Continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de confirmación para eliminar turnos */}
      <Dialog open={confirmationOpen} onOpenChange={open => { if (!busy) setConfirmationOpen(open); }}>
        <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-md p-5 sm:p-6 rounded-[var(--radius-card)]">
          <DialogTitle className="text-lg font-medium">¿Eliminar estos registros?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Esta acción no se puede deshacer. Se eliminarán los estados seleccionados y sus notificaciones y eventos de email relacionados. No se eliminarán clientes, disponibilidad, perfiles ni la secuencia de reservas.
          </DialogDescription>
          <div className="maintenance-confirmation-list mt-4">
            <strong className="block text-sm font-semibold break-words">{selectedLabels.join(', ')}</strong>
            <span className="block text-xs text-muted-foreground mt-1">
              La operación será transaccional y quedará registrada sin datos personales.
            </span>
          </div>
          <DialogFooter className="mt-5 flex flex-col-reverse sm:flex-row gap-2.5">
            <Button
              variant="outline"
              className="v2-secondary w-full sm:w-auto min-h-[44px]"
              disabled={busy}
              onClick={() => setConfirmationOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              className="v2-destructive action-brand w-full sm:w-auto min-h-[44px]"
              disabled={busy}
              onClick={() => void handleCleanup()}
            >
              <Trash2 size={16} className="shrink-0" />
              <span>Eliminar registros</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de confirmación para eliminar disponibilidad */}
      <Dialog open={availabilityConfirmationOpen} onOpenChange={open => { if (!availabilityBusy) setAvailabilityConfirmationOpen(open); }}>
        <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-md p-5 sm:p-6 rounded-[var(--radius-card)]">
          <DialogTitle className="text-lg font-medium">¿Eliminar historial de disponibilidad?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Se eliminarán exactamente {availabilityCount ?? 0} notificaciones de horarios bloqueados y liberados. Esta acción es irreversible y no modifica la disponibilidad actual de los barberos.
          </DialogDescription>
          <div className="maintenance-confirmation-list mt-4">
            <strong className="block text-sm font-semibold">{availabilityCount ?? 0} notificaciones</strong>
            <span className="block text-xs text-muted-foreground mt-1">
              Las notificaciones de turnos y los horarios vigentes permanecerán intactos.
            </span>
          </div>
          <DialogFooter className="mt-5 flex flex-col-reverse sm:flex-row gap-2.5">
            <Button
              variant="outline"
              className="v2-secondary w-full sm:w-auto min-h-[44px]"
              disabled={availabilityBusy}
              onClick={() => setAvailabilityConfirmationOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              className="v2-destructive action-brand w-full sm:w-auto min-h-[44px]"
              disabled={availabilityBusy}
              onClick={() => void handleAvailabilityCleanup()}
            >
              <Trash2 size={16} className="shrink-0" />
              <span>Eliminar notificaciones</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
