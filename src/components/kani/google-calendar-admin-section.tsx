import { useEffect, useState } from 'react';
import { Calendar, Check, ExternalLink, RefreshCw, ShieldCheck, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAdminStaff } from '@/lib/kani-admin-context';

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
