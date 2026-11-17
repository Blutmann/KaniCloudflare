import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requestPasswordReset, signInWithPassword } from '@/lib/kani-auth';
import kaniSymbol from '@/assets/kani-symbol.webp';
import kaniSymbolRetina from '@/assets/kani-symbol-2x.webp';

function isRateLimitOrNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as { status?: number; message?: string };
  if (record.status === 429) return true;
  const msg = (record.message ?? '').toLowerCase();
  return (
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('fetch')
  );
}

export function AdminAccess({
  onAuthenticated,
  embedded = false,
  onCancel,
  subtitle,
  externalError,
}: {
  onAuthenticated: () => void | Promise<void>;
  embedded?: boolean;
  onCancel?: () => void;
  subtitle?: string;
  externalError?: string | null;
}) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (embedded) return;
    if (typeof document !== 'undefined') {
      document.body.dataset.adminLogin = 'true';
      return () => {
        delete document.body.dataset.adminLogin;
      };
    }
  }, [embedded]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const submittedEmail = String(formData.get('email') ?? email);
    const password = String(formData.get('password') ?? '');

    setBusy(true);
    setError('');
    setInfo('');
    const { error: signInError } = await signInWithPassword(submittedEmail, password);
    if (signInError) {
      setError('Email o contraseña incorrectos.');
    } else {
      form.reset();
      setEmail('');
      await onAuthenticated();
    }
    setBusy(false);
  }

  async function submitResetRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError('Ingresá tu dirección de email.');
      return;
    }

    setBusy(true);
    setError('');
    setInfo('');
    try {
      const { error: resetError } = await requestPasswordReset(cleanEmail);
      if (resetError && isRateLimitOrNetworkError(resetError)) {
        setError('No pudimos procesar la solicitud en este momento. Intentá nuevamente en unos minutos.');
      } else {
        setInfo(
          'Si el correo corresponde a una cuenta interna, te enviamos un enlace seguro para restablecer o configurar tu contraseña. Revisá tu bandeja de entrada o spam.',
        );
      }
    } catch {
      setError('No pudimos procesar la solicitud en este momento. Intentá nuevamente en unos minutos.');
    } finally {
      setBusy(false);
    }
  }

  function openForgotMode() {
    if (busy) return;
    setError('');
    setInfo('');
    setMode('forgot');
  }

  function backToLoginMode() {
    if (busy) return;
    setError('');
    setInfo('');
    setMode('login');
  }

  const displayedError = error || externalError || '';

  const content = (
    <div className={`admin-login-shell mx-auto max-w-sm ${embedded ? 'w-full' : ''}`}>
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
      <h1 className="eyebrow admin-login-title text-center">
        {mode === 'login' ? 'ADMINISTRACIÓN' : 'RECUPERAR ACCESO'}
      </h1>
      {subtitle && mode === 'login' && (
        <p className="text-center text-xs text-[#9A8E78] -mt-2 mb-4 leading-relaxed">
          {subtitle}
        </p>
      )}

      {mode === 'login' ? (
        <form className="admin-login-form space-y-5" onSubmit={submitLogin}>
          <label className="field-label">
            Email
            <Input
              name="email"
              type="email"
              autoComplete="username"
              required
              disabled={busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field-label">
            Contraseña
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={1024}
              disabled={busy}
            />
          </label>
          <div className="admin-login-forgot-row">
            <button
              type="button"
              className="admin-login-forgot-link"
              onClick={openForgotMode}
              disabled={busy}
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>
          {displayedError && (
            <p role="alert" className="text-sm text-destructive">
              {displayedError}
            </p>
          )}
          <Button
            type="submit"
            className="admin-login-submit h-12 w-full"
            disabled={busy}
            aria-busy={busy}
            data-busy={busy}
          >
            {busy ? 'Verificando...' : 'Iniciar sesión'}
            <ArrowRight aria-hidden="true" />
          </Button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="w-full min-h-[42px] rounded-xl border border-[#2A241B] bg-transparent hover:bg-white/[0.04] text-[#9A8E78] hover:text-white text-xs font-mono tracking-[0.16em] uppercase transition-colors cursor-pointer"
            >
              Volver sin iniciar sesión
            </button>
          )}
        </form>
      ) : (
          <form className="admin-login-form space-y-5" onSubmit={submitResetRequest}>
            <p className="admin-login-recovery-copy">
              Ingresá tu email interno y te enviaremos un enlace seguro para restablecer o configurar tu contraseña.
            </p>
            <label className="field-label">
              Email
              <Input
                name="email"
                type="email"
                autoComplete="username"
                required
                disabled={busy}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {info && (
              <p role="status" className="admin-login-status">
                {info}
              </p>
            )}
            <Button
              type="submit"
              className="admin-login-submit h-12 w-full"
              disabled={busy}
              aria-busy={busy}
              data-busy={busy}
            >
              {busy ? 'Enviando...' : 'Enviar enlace'}
              <ArrowRight aria-hidden="true" />
            </Button>
            <div className="admin-login-back-row">
              <button
                type="button"
                className="admin-login-back-link"
                onClick={backToLoginMode}
                disabled={busy}
              >
                <ArrowLeft size={14} aria-hidden="true" />
                <span>Volver a iniciar sesión</span>
              </button>
            </div>
          </form>
        )}
    </div>
  );

  if (embedded) {
    return content;
  }

  return <main className="site-container admin-page admin-login-page">{content}</main>;
}
