import { useEffect, useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LiquidGlassShell } from '@/components/kani/experimental/liquid-glass-shell';
import '@/components/kani/experimental/liquid-glass-admin.css';
import { supabase } from '@/integrations/supabase/client';
import { requestPasswordReset, signOut } from '@/lib/kani-auth';
import kaniSymbol from '@/assets/kani-symbol.webp';
import kaniSymbolRetina from '@/assets/kani-symbol-2x.webp';

export const Route = createFileRoute('/restablecer-contrasena')({
  component: ResetPasswordRoute,
  head: () => ({
    meta: [
      { title: 'Restablecer contraseña — KANI' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});

function ResetPasswordRoute() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.dataset.lgAdmin = 'true';
    document.body.dataset.adminLogin = 'true';
    return () => {
      delete document.body.dataset.lgAdmin;
      delete document.body.dataset.adminLogin;
    };
  }, []);

  return (
    <LiquidGlassShell section="admin">
      <ResetPasswordScreen />
    </LiquidGlassShell>
  );
}

export function ResetPasswordScreen() {
  const [status, setStatus] = useState<'verifying' | 'ready' | 'invalid' | 'success'>('verifying');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestEmail, setRequestEmail] = useState('');
  const [requestInfo, setRequestInfo] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const url = new URL(window.location.href);
        const parameters = url.searchParams;
        const fragment = new URLSearchParams(url.hash.slice(1));

        if (parameters.has('error') || fragment.has('error')) {
          throw new Error('INVALID_RECOVERY');
        }

        const code = parameters.get('code');
        const tokenHash = parameters.get('token_hash') ?? fragment.get('token_hash');
        const typeParam = parameters.get('type') ?? fragment.get('type');
        const accessToken = fragment.get('access_token');
        const refreshToken = fragment.get('refresh_token');

        if (tokenHash) {
          const otpType =
            typeParam === 'invite' || typeParam === 'magiclink' ? typeParam : 'recovery';
          const { error: otpError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType,
          });
          if (otpError) throw otpError;
        } else if (code) {
          const { error: codeError } = await supabase.auth.exchangeCodeForSession(code);
          if (codeError) throw codeError;
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        } else {
          throw new Error('INVALID_RECOVERY');
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError || !user) throw new Error('INVALID_RECOVERY');

        if (!cancelled) {
          setStatus('ready');
        }
      } catch {
        if (!cancelled) {
          setStatus('invalid');
          setError(
            'El enlace de recuperación venció, ya fue utilizado o no es válido. Solicitá uno nuevo.',
          );
        }
      } finally {
        if (!cancelled && typeof window !== 'undefined') {
          window.history.replaceState({}, '', '/restablecer-contrasena');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function submitNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirmation = String(form.get('confirmation') ?? '');

    if (password.length < 12 || password !== confirmation) {
      setError('Usá al menos 12 caracteres y confirmá la misma contraseña.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setStatus('success');
      try {
        await signOut();
      } catch {
        /* Ignore sign-out errors during redirect */
      }
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          window.location.assign('/panel-administracion');
        }, 1200);
      }
    } catch {
      setError(
        'No pudimos guardar tu nueva contraseña. Verificá los requisitos o solicitá un nuevo enlace.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitNewLinkRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const cleanEmail = requestEmail.trim();
    if (!cleanEmail) {
      setError('Ingresá tu dirección de email.');
      return;
    }

    setBusy(true);
    setError('');
    setRequestInfo('');
    try {
      const { error: resetError } = await requestPasswordReset(cleanEmail);
      const msg = (resetError?.message ?? '').toLowerCase();
      if (
        resetError &&
        ((resetError as { status?: number }).status === 429 ||
          msg.includes('rate limit') ||
          msg.includes('network') ||
          msg.includes('fetch'))
      ) {
        setError('No pudimos procesar la solicitud en este momento. Intentá nuevamente en unos minutos.');
      } else {
        setRequestInfo(
          'Si el correo corresponde a una cuenta interna, te enviamos un nuevo enlace seguro. Revisá tu bandeja de entrada o spam.',
        );
      }
    } catch {
      setError('No pudimos procesar la solicitud en este momento. Intentá nuevamente en unos minutos.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="site-container admin-page admin-login-page">
      <div className="admin-login-shell mx-auto max-w-sm">
        <img
          src={kaniSymbol}
          srcSet={`${kaniSymbol} 431w, ${kaniSymbolRetina} 862w`}
          sizes="(max-width: 767px) 68px, 112px"
          alt="Kani Barber Studio"
          width={431}
          height={438}
          decoding="async"
          className="admin-login-symbol"
        />
        <h1 className="eyebrow admin-login-title text-center">RESTABLECER CONTRASEÑA</h1>

        {status === 'verifying' && (
          <p role="status" className="admin-login-recovery-copy text-center">
            Verificando enlace seguro...
          </p>
        )}

        {status === 'ready' && (
          <form onSubmit={submitNewPassword} className="admin-login-form space-y-5">
            <p className="admin-login-recovery-copy">
              Elegí una nueva contraseña personal de al menos 12 caracteres.
            </p>
            <label className="field-label">
              Nueva contraseña
              <Input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={1024}
                disabled={busy}
              />
            </label>
            <label className="field-label">
              Confirmar contraseña
              <Input
                name="confirmation"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={1024}
                disabled={busy}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="admin-login-submit h-12 w-full"
              disabled={busy}
              aria-busy={busy}
              data-busy={busy}
            >
              {busy ? 'Guardando...' : 'Guardar contraseña'}
              <ArrowRight aria-hidden="true" />
            </Button>
          </form>
        )}

        {status === 'invalid' && (
          <form onSubmit={submitNewLinkRequest} className="admin-login-form space-y-5">
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <label className="field-label">
              Email
              <Input
                name="email"
                type="email"
                autoComplete="username"
                required
                disabled={busy}
                value={requestEmail}
                onChange={(e) => setRequestEmail(e.target.value)}
              />
            </label>
            {requestInfo && (
              <p role="status" className="admin-login-status">
                {requestInfo}
              </p>
            )}
            <Button
              type="submit"
              className="admin-login-submit h-12 w-full"
              disabled={busy}
              aria-busy={busy}
              data-busy={busy}
            >
              {busy ? 'Enviando...' : 'Solicitar nuevo enlace'}
              <ArrowRight aria-hidden="true" />
            </Button>
            <div className="admin-login-back-row">
              <a href="/panel-administracion" className="admin-login-back-link">
                <ArrowLeft size={14} aria-hidden="true" />
                <span>Volver al inicio de sesión</span>
              </a>
            </div>
          </form>
        )}

        {status === 'success' && (
          <div className="admin-login-form space-y-5">
            <p role="status" className="admin-login-status">
              Contraseña actualizada correctamente. Redirigiendo al inicio de sesión...
            </p>
            <div className="admin-login-back-row">
              <a href="/panel-administracion" className="admin-login-back-link">
                <ArrowLeft size={14} aria-hidden="true" />
                <span>Ir a iniciar sesión</span>
              </a>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
