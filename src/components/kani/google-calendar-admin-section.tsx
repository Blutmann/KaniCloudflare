import { useEffect, useState } from 'react';
import { Calendar, Check, ExternalLink, RefreshCw, ShieldCheck, AlertCircle, PlayCircle, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAdminStaff } from '@/lib/kani-admin-context';
import type { ControlledAuditResult } from '@/lib/kani-google-calendar-sync';

export type GoogleCalendarStatusData = {
  configured: boolean;
  authorized: boolean;
  strategy: 'OAUTH2' | 'SERVICE_ACCOUNT' | 'NONE';
  syncEnabled: boolean;
  scope: string;
  lastAuthorizedAt: string | null;
  redirectUri: string;
  authorizeUrl: string;
  envDetection?: {
    hasGoogleClientId: boolean;
    hasGoogleClientSecret: boolean;
    hasSupabaseServiceRoleKey: boolean;
    detectedMatchingKeyNames?: string[];
  };
};

export function GoogleCalendarAdminSection() {
  const staff = useAdminStaff();
  const isAdmin = staff.profile.role === 'ADMIN';

  const [status, setStatus] = useState<GoogleCalendarStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [successNotice, setSuccessNotice] = useState(false);

  // Estados para la auditoría en vivo del calendario de Franco
  const [auditing, setAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<ControlledAuditResult | null>(null);
  const [auditError, setAuditError] = useState('');

  // Detectar si venimos de un callback exitoso mediante ?gcal=success
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location?.href) return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('gcal') === 'success') {
        setSuccessNotice(true);
        // Limpiar el parámetro de la URL sin recargar la página
        url.searchParams.delete('gcal');
        window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
      }
    } catch {
      // Ignorar si href es sintético o inválido en entornos de test
    }
  }, []);

  async function loadStatus() {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/integrations/google-calendar/status');
      if (res.ok) {
        const data = (await res.json()) as GoogleCalendarStatusData;
        setStatus(data);
      } else {
        setError('No se pudo verificar el estado de Google Calendar.');
      }
    } catch {
      setError('Error de comunicación con el servicio de integración.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAdmin) {
      void loadStatus();
    }
  }, [isAdmin]);

  async function handleConnect() {
    setConnecting(true);
    setError('');

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError('Debe tener una sesión activa de administrador para autorizar Google Calendar.');
        setConnecting(false);
        return;
      }

      // Solicitud autenticada con Bearer token a /api/integrations/google-calendar/authorize
      const res = await fetch('/api/integrations/google-calendar/authorize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Accept: 'application/json',
        },
        credentials: 'include',
      });

      const data = await res.json();

      if (!res.ok || !data.url) {
        setError(data.error || 'No se pudo iniciar el flujo de autorización de Google.');
        setConnecting(false);
        return;
      }

      // Navegar a Google consent screen con el state y la cookie CSRF ya establecida
      window.location.href = data.url;
    } catch (err: any) {
      setError(err?.message || 'Error al conectar con el servidor.');
      setConnecting(false);
    }
  }

  async function handleRunFrancoAudit() {
    setAuditing(true);
    setAuditError('');
    setAuditResult(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setAuditError('Debe tener una sesión activa de administrador para ejecutar la auditoría.');
        setAuditing(false);
        return;
      }

      const res = await fetch('/api/admin/calendar-sync/audit?barber=Franco', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Accept: 'application/json',
        },
      });

      const data = (await res.json()) as ControlledAuditResult;

      if (!res.ok && !data.steps) {
        setAuditError((data as any).message || (data as any).error || 'Error al ejecutar la auditoría.');
      } else {
        setAuditResult(data);
        if (!data.success && data.error) {
          setAuditError(data.error);
        }
      }
    } catch (err: any) {
      setAuditError(err?.message || 'Fallo de conexión al ejecutar la auditoría de Google Calendar.');
    } finally {
      setAuditing(false);
    }
  }

  if (!isAdmin) return null;

  const isConnected = Boolean(status?.authorized);

  return (
    <section className="v2-panel maintenance-card maintenance-gcal-card" aria-labelledby="gcal-heading">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Calendar className="mt-0.5 shrink-0 text-gold" size={20} aria-hidden="true" />
          <div className="min-w-0">
            <span className="v2-eyebrow eyebrow">INTEGRACIÓN</span>
            <h2 id="gcal-heading" className="text-base font-medium">Google Calendar</h2>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              Sincronización centralizada de reservas confirmadas con los calendarios de los 4 barberos (Lautaro, Gonzalo, Valentín y Franco).
            </p>
          </div>
        </div>
        <div>
          {loading ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
              <RefreshCw size={12} className="animate-spin" /> Verificando…
            </span>
          ) : isConnected ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Conectado
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span> Desconectado
            </span>
          )}
        </div>
      </div>

      {successNotice && (
        <div role="status" className="notice v2-success-notice mt-4 flex items-center gap-2">
          <Check size={16} className="shrink-0 text-emerald-400" />
          <span className="text-sm">
            ¡Google Calendar conectado correctamente! El refresh token se encuentra cifrado y resguardado en el backend.
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="notice v2-alert-notice mt-4 text-destructive flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          <span className="text-sm min-w-0 break-words">{error}</span>
        </div>
      )}

      <div className="mt-4 p-3.5 rounded-[var(--radius-control)] bg-[var(--v2-inset)] border border-border space-y-2 text-xs">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Modo de autenticación:</span>
          <span className="font-medium text-foreground">OAuth 2.0 Centralizado (Acceso Offline)</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Almacenamiento de credenciales:</span>
          <span className="font-medium text-foreground">Cifrado AES-GCM en backend (service_role)</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Sincronización automática de turnos:</span>
          <span className="font-semibold text-amber-400/90">En pausa (Etapa 1 controlada)</span>
        </div>
        {status?.lastAuthorizedAt && (
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Última autorización:</span>
            <span className="font-medium text-foreground">
              {new Date(status.lastAuthorizedAt).toLocaleString('es-AR', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </span>
          </div>
        )}
      </div>

      {/* Bloque de Auditoría en Vivo (Calendario de Franco) */}
      {isConnected && (
        <div className="mt-5 pt-4 border-t border-border">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-gold" />
                <h3 className="text-sm font-semibold text-foreground">Auditoría Real — Calendario de Franco</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Ejecuta la secuencia de 5 operaciones en Google Calendar API (<code className="text-gold">GOOGLE_CALENDAR_FRANCO_ID</code>) sin alterar reservas de Supabase y con limpieza automática garantizada.
              </p>
            </div>
            <Button
              type="button"
              className="v2-secondary min-h-[40px] shrink-0 text-xs gap-1.5"
              disabled={auditing || loading}
              onClick={() => void handleRunFrancoAudit()}
            >
              {auditing ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Ejecutando auditoría…</span>
                </>
              ) : (
                <>
                  <PlayCircle size={14} className="text-gold" />
                  <span>Ejecutar auditoría Franco</span>
                </>
              )}
            </Button>
          </div>

          {auditError && (
            <div role="alert" className="notice v2-alert-notice mt-3 text-destructive flex items-center gap-2 text-xs">
              <AlertCircle size={14} className="shrink-0" />
              <span>{auditError}</span>
            </div>
          )}

          {auditResult && (
            <div className="mt-3 p-3.5 rounded-[var(--radius-control)] bg-black/40 border border-border/80 space-y-2 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-border/60">
                <span className="font-medium text-foreground flex items-center gap-1.5">
                  {auditResult.success ? (
                    <CheckCircle2 size={15} className="text-emerald-400" />
                  ) : (
                    <XCircle size={15} className="text-destructive" />
                  )}
                  Resultado: {auditResult.success ? 'Auditoría aprobada exitosamente' : 'Auditoría incompleta'}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Variable: <code className="text-gold">{auditResult.calendarVariable || 'GOOGLE_CALENDAR_FRANCO_ID'}</code>
                </span>
              </div>

              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <span>1. Crear evento ficticio de prueba:</span>
                  <span className={auditResult.steps.create ? 'text-emerald-400 font-medium' : 'text-muted-foreground'}>
                    {auditResult.steps.create ? '✓ Creado' : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>2. Consultar y verificar datos del evento:</span>
                  <span className={auditResult.steps.read ? 'text-emerald-400 font-medium' : 'text-muted-foreground'}>
                    {auditResult.steps.read ? '✓ Verificado' : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>3. Actualizar evento ficticio:</span>
                  <span className={auditResult.steps.update ? 'text-emerald-400 font-medium' : 'text-muted-foreground'}>
                    {auditResult.steps.update ? '✓ Actualizado' : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>4. Eliminar evento de Google Calendar:</span>
                  <span className={auditResult.steps.delete ? 'text-emerald-400 font-medium' : 'text-muted-foreground'}>
                    {auditResult.steps.delete ? '✓ Eliminado' : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>5. Confirmar ausencia en Google Calendar API:</span>
                  <span className={auditResult.steps.confirmDeleted || auditResult.details.confirmedDeleted ? 'text-emerald-400 font-medium' : 'text-muted-foreground'}>
                    {auditResult.steps.confirmDeleted || auditResult.details.confirmedDeleted ? '✓ Confirmada ausencia (404)' : '—'}
                  </span>
                </div>
              </div>

              {auditResult.details.createdEventId && (
                <div className="pt-2 border-t border-border/40 text-[11px] text-muted-foreground flex justify-between">
                  <span>ID de evento generado:</span>
                  <code className="text-foreground">{auditResult.details.createdEventId}</code>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {isConnected
            ? 'La renovación de accesos se realiza de manera automática sin intervención manual.'
            : 'Al conectar, se abrirá la cuenta de Google de Kani para otorgar los permisos de calendario.'}
        </p>
        <Button
          type="button"
          className="v2-primary action-brand w-full sm:w-auto shrink-0 min-h-[44px]"
          disabled={loading || connecting}
          onClick={() => void handleConnect()}
        >
          {connecting ? (
            <>
              <RefreshCw size={16} className="shrink-0 animate-spin mr-2" />
              <span>Iniciando…</span>
            </>
          ) : isConnected ? (
            <>
              <RefreshCw size={16} className="shrink-0 mr-2" />
              <span>Reconectar cuenta</span>
            </>
          ) : (
            <>
              <ExternalLink size={16} className="shrink-0 mr-2" />
              <span>Conectar Google Calendar</span>
            </>
          )}
        </Button>
      </div>
    </section>
  );
}
