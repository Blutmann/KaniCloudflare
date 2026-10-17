import { useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signInWithPassword } from '@/lib/kani-auth';
import kaniSymbol from '@/assets/kani-symbol.png';

export function AdminAccess({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');

    setBusy(true);
    setError('');
    const { error: signInError } = await signInWithPassword(email, password);
    if (signInError) {
      setError('Email o contraseña incorrectos.');
    } else {
      form.reset();
      onAuthenticated();
    }
    setBusy(false);
  }

  return (
    <main className="site-container admin-page admin-login-page">
      <div className="admin-login-shell mx-auto max-w-sm">
        <img src={kaniSymbol} alt="Kani Barber Studio" width={1724} height={1752} className="admin-login-symbol" />
        <h1 className="eyebrow admin-login-title text-center">ADMINISTRACIÓN</h1>
        <form className="admin-login-form space-y-5" onSubmit={submit}>
          <label className="field-label">
            Email
            <Input name="email" type="email" autoComplete="username" required disabled={busy} />
          </label>
          <label className="field-label">
            Contraseña
            <Input name="password" type="password" autoComplete="current-password" required maxLength={1024} disabled={busy} />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="admin-login-submit h-12 w-full" disabled={busy}>
            {busy ? 'VERIFICANDO…' : 'INGRESAR'}
            <ArrowRight />
          </Button>
        </form>
      </div>
    </main>
  );
}
