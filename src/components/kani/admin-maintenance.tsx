import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { cleanupAppointmentRecords, cleanupAvailabilityNotifications, cleanupStatusOptions, countAvailabilityNotifications, reauthenticateAdmin, type AvailabilityMaintenanceResult, type CleanupStatus, type MaintenanceResult } from '@/lib/kani-maintenance';

export function AdminMaintenance() {
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
    let cancelled = false;
    void countAvailabilityNotifications()
      .then(count => { if (!cancelled) setAvailabilityCount(count); })
      .catch(cause => { if (!cancelled) setAvailabilityError(cause instanceof Error ? cause.message : 'No se pudo consultar el historial de disponibilidad.'); });
    return () => { cancelled = true; };
  }, []);

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

  return <section className="py-9" aria-labelledby="maintenance-title">
    <div className="max-w-3xl">
      <span className="eyebrow">MANTENIMIENTO</span>
      <h2 id="maintenance-title" className="mt-2 text-2xl">Limpiar registros de prueba</h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Elegí qué estados de turnos querés eliminar después de una etapa de pruebas. La acción es irreversible y requiere volver a verificar tu identidad.</p>

      <div className="maintenance-scope-card mt-8">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-gold" size={19} /><div><h3 className="font-medium">Alcance protegido</h3><p className="mt-1 text-sm text-muted-foreground">Solo se eliminarán los turnos de los estados seleccionados y sus registros derivados.</p></div></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {cleanupStatusOptions.map(option => <label key={option.value} className={`maintenance-status-option ${selectedStatuses.includes(option.value) ? 'selected' : ''}`}><Checkbox checked={selectedStatuses.includes(option.value)} onCheckedChange={() => toggleStatus(option.value)} aria-label={`Seleccionar ${option.label}`} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}
        </div>
      </div>

      <div className="maintenance-preserve-card mt-6"><h3 className="text-sm font-medium">Siempre se conserva</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Clientes, usuarios Auth, perfiles, roles, barberos, servicios, precios, horarios y notas internas, datos de transferencia, notificaciones de disponibilidad, configuraciones y la secuencia de solicitudes.</p></div>

      {selectedLabels.length > 0 && <div className="maintenance-summary mt-6"><span className="eyebrow">RESUMEN</span><p className="mt-2 text-sm">Se eliminarán: <strong>{selectedLabels.join(', ')}</strong>.</p><p className="mt-1 text-xs text-muted-foreground">También se eliminarán las notificaciones administrativas y eventos de email vinculados a esos turnos.</p></div>}
      {error && <div role="alert" className="notice mt-6 text-destructive"><AlertTriangle size={16} />{error}</div>}
      {result && <div role="status" className="notice mt-6"><Check size={16} />Se eliminaron {result.appointments_deleted} turnos, {result.admin_notifications_deleted} notificaciones y {result.notification_events_deleted} eventos de email.</div>}

      <Button className="action-brand mt-8" disabled={selectedStatuses.length === 0 || busy} onClick={() => { setError(''); setReauthOpen(true); }}><Trash2 />Eliminar registros</Button>

      <section className="maintenance-availability-section mt-12 border-t pt-10" aria-labelledby="availability-history-title">
        <span className="eyebrow">HISTORIAL</span>
        <h2 id="availability-history-title" className="mt-2 text-2xl">Historial de disponibilidad</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Eliminá las notificaciones históricas de horarios bloqueados y liberados. Esta acción no modifica la disponibilidad actual de los barberos.</p>
        <div className="maintenance-availability-card mt-6">
          <div className="flex items-start justify-between gap-4"><div><span className="text-sm text-muted-foreground">Notificaciones eliminables</span><strong className="mt-2 block text-3xl">{availabilityCount === null ? '—' : availabilityCount}</strong></div><ShieldCheck className="shrink-0 text-gold" size={21} aria-hidden="true" /></div>
          {availabilityError && <div role="alert" className="notice mt-5 text-destructive"><AlertTriangle size={16} />{availabilityError}</div>}
          {availabilityResult && <div role="status" className="notice mt-5"><Check size={16} />Se eliminaron {availabilityResult.notifications_deleted} notificaciones de disponibilidad.</div>}
          {availabilityCount === 0 && !availabilityError && <p className="mt-5 text-sm text-muted-foreground">No hay notificaciones de disponibilidad para eliminar.</p>}
          <Button className="action-brand mt-6" disabled={availabilityCount === null || availabilityCount === 0 || availabilityBusy} onClick={() => { setAvailabilityError(''); setAvailabilityResult(null); setAvailabilityConfirmationOpen(true); }}><Trash2 />Eliminar notificaciones de disponibilidad</Button>
        </div>
      </section>
    </div>

    <Dialog open={reauthOpen} onOpenChange={open => { if (!busy) setReauthOpen(open); }}><DialogContent className="max-w-[calc(100%-32px)] sm:max-w-md"><DialogTitle>Verificar identidad</DialogTitle><DialogDescription>Ingresá la contraseña actual de tu cuenta ADMIN. No se almacena ni se envía a servicios propios.</DialogDescription><label className="mt-2 block text-sm font-medium" htmlFor="maintenance-password">Contraseña actual</label><input id="maintenance-password" className="input-control" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && password) void handleReauthentication(); }} /><DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setPassword(''); setReauthOpen(false); }}>Cancelar</Button><Button className="action-positive" disabled={!password || busy} onClick={() => void handleReauthentication()}>Continuar</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={confirmationOpen} onOpenChange={open => { if (!busy) setConfirmationOpen(open); }}><DialogContent className="max-w-[calc(100%-32px)] sm:max-w-md"><DialogTitle>¿Eliminar estos registros?</DialogTitle><DialogDescription>Esta acción no se puede deshacer. Se eliminarán los estados seleccionados y sus notificaciones y eventos de email relacionados. No se eliminarán clientes, disponibilidad, perfiles ni la secuencia de solicitudes.</DialogDescription><div className="maintenance-confirmation-list"><strong>{selectedLabels.join(', ')}</strong><span>La operación será transaccional y quedará registrada sin datos personales.</span></div><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmationOpen(false)}>Cancelar</Button><Button className="action-brand" disabled={busy} onClick={() => void handleCleanup()}><Trash2 />Eliminar registros</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={availabilityConfirmationOpen} onOpenChange={open => { if (!availabilityBusy) setAvailabilityConfirmationOpen(open); }}><DialogContent className="max-w-[calc(100%-32px)] sm:max-w-md"><DialogTitle>¿Eliminar historial de disponibilidad?</DialogTitle><DialogDescription>Se eliminarán exactamente {availabilityCount ?? 0} notificaciones de horarios bloqueados y liberados. Esta acción es irreversible y no modifica la disponibilidad actual de los barberos.</DialogDescription><div className="maintenance-confirmation-list"><strong>{availabilityCount ?? 0} notificaciones</strong><span>Las notificaciones de turnos y los horarios vigentes permanecerán intactos.</span></div><DialogFooter><Button variant="outline" disabled={availabilityBusy} onClick={() => setAvailabilityConfirmationOpen(false)}>Cancelar</Button><Button className="action-brand" disabled={availabilityBusy} onClick={() => void handleAvailabilityCleanup()}><Trash2 />Eliminar notificaciones</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
