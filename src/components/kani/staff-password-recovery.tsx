import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/kani-auth";
import {
  STAFF_RECOVERY_MESSAGE,
  STAFF_RECOVERY_MIN_PASSWORD,
  isStaffRecoveryToken,
} from "@/lib/kani-staff-recovery";
import kaniSymbol from "@/assets/kani-symbol.webp";
import kaniSymbolRetina from "@/assets/kani-symbol-2x.webp";
import "./staff-password-recovery.css";

function RecoveryShell({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.body.dataset.adminLogin = "true";
    return () => {
      delete document.body.dataset.adminLogin;
    };
  }, []);
  return (
    <main className="site-container admin-page admin-login-page">
      <div className="admin-login-shell admin-recovery-shell mx-auto max-w-sm">
        <img
          src={kaniSymbol}
          srcSet={`${kaniSymbol} 431w, ${kaniSymbolRetina} 862w`}
          sizes="(max-width: 767px) 68px, 112px"
          alt="Kani Barber Studio"
          width={431}
          height={438}
          className="admin-login-symbol"
        />
        <h1 className="eyebrow admin-login-title text-center">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function StaffRecoveryRequest() {
  const [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || cooldown) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await fetch("/api/staff/password-recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), website: data.get("website") || "" }),
      });
    } catch {
      /* The public message never identifies an account or provider result. */
    } finally {
      setBusy(false);
      setSent(true);
      setCooldown(60);
    }
  }
  return (
    <RecoveryShell title="Recuperar contraseña">
      <p className="admin-recovery-copy">Ingresá el email de tu cuenta del equipo Kani.</p>
      <form className="admin-login-form space-y-5" onSubmit={submit}>
        <label className="field-label">
          Email
          <Input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            disabled={busy}
          />
        </label>
        <div className="admin-recovery-honeypot" aria-hidden="true">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        {sent && (
          <p role="status" className="admin-recovery-copy">
            {STAFF_RECOVERY_MESSAGE}
          </p>
        )}
        <Button
          type="submit"
          className="admin-login-submit h-12 w-full"
          disabled={busy || cooldown > 0}
          aria-busy={busy}
        >
          {busy ? "Enviando…" : "Enviar enlace"}
        </Button>
        {cooldown > 0 && (
          <p className="admin-recovery-copy">Podés volver a intentarlo en {cooldown} s.</p>
        )}
      </form>
      <Link to="/panel-administracion" className="admin-recovery-link">
        Volver al inicio de sesión
      </Link>
    </RecoveryShell>
  );
}

function PasswordField({ name, label, busy }: { name: string; label: string; busy: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <label className="field-label" htmlFor={`reset-${name}`}>
      {label}
      <span className="admin-recovery-password">
        <Input
          id={`reset-${name}`}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={STAFF_RECOVERY_MIN_PASSWORD}
          maxLength={1024}
          disabled={busy}
        />
        <Button
          type="button"
          variant="ghost"
          className="admin-recovery-visibility"
          disabled={busy}
          aria-pressed={shown}
          aria-label={`${shown ? "Ocultar" : "Mostrar"} ${label.toLowerCase()}`}
          onClick={() => setShown(!shown)}
        >
          {shown ? <EyeOff size={18} /> : <Eye size={18} />}
        </Button>
      </span>
    </label>
  );
}

export function StaffPasswordReset() {
  const initialized = useRef(false);
  const [token, setToken] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    const readLink = () => {
      const parameters = new URLSearchParams(window.location.hash.slice(1)),
        hash = parameters.get("token_hash");
      // Fragments never reach HTTP access logs. Remove them before any request or navigation.
      window.history.replaceState({}, "", window.location.pathname);
      setDone(false);
      setSaved(false);
      if (parameters.get("type") === "recovery" && isStaffRecoveryToken(hash)) {
        setToken(hash);
        setError("");
      } else {
        setToken(null);
        setError("El enlace venció, ya fue utilizado o no es válido.");
      }
    };
    if (!initialized.current) {
      initialized.current = true;
      readLink();
    }
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => window.location.assign("/panel-administracion"), 2500);
    return () => clearTimeout(timer);
  }, [done]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || busy) return;
    const form = event.currentTarget,
      data = new FormData(form),
      password = String(data.get("password") || ""),
      confirmation = String(data.get("confirmation") || "");
    if (password.length < STAFF_RECOVERY_MIN_PASSWORD) {
      setError("Usá al menos 12 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const reply = await fetch("/api/staff/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenHash: token, password, confirmation }),
      });
      const result = await reply.json();
      if (result.ok) {
        form.reset();
        setToken(null);
        await signOut("local").catch(() => {});
        setDone(true);
      } else if (result.code === "INVALID_LINK") {
        setToken(null);
        setError("El enlace venció, ya fue utilizado o no es válido.");
      } else if (result.code === "PASSWORD_POLICY")
        setError("Usá al menos 12 caracteres y confirmá la misma contraseña.");
      else if (result.code === "PASSWORD_POLICY_NEW_LINK") {
        setToken(null);
        setError(
          "La contraseña no cumple la política de seguridad o ya estaba en uso. Solicitá un nuevo enlace y elegí una contraseña diferente.",
        );
      } else if (result.passwordSaved) {
        form.reset();
        setToken(null);
        setSaved(true);
        setError(
          "No pudimos completar el cierre de las sesiones anteriores. Solicitá un nuevo enlace para finalizar.",
        );
      } else
        setError("No pudimos completar el cambio. Reintentá más tarde o solicitá un nuevo enlace.");
    } catch {
      setError("No pudimos completar el cambio. Revisá la conexión y reintentá.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <RecoveryShell title="Restablecer contraseña">
      {(done || saved) && (
        <p role="status" className="admin-recovery-copy">
          Tu contraseña se actualizó correctamente
        </p>
      )}
      {error && (
        <p role="alert" className="admin-recovery-copy">
          {error}
        </p>
      )}
      {!done && token && (
        <form key={token} className="admin-login-form space-y-5" onSubmit={submit}>
          <PasswordField name="password" label="Nueva contraseña" busy={busy} />
          <PasswordField name="confirmation" label="Confirmar contraseña" busy={busy} />
          <p className="admin-recovery-copy">Usá al menos 12 caracteres.</p>
          <Button
            type="submit"
            className="admin-login-submit h-12 w-full"
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Guardando…" : "Guardar contraseña"}
          </Button>
        </form>
      )}
      {!done && (
        <Link to="/recuperar-contrasena" className="admin-recovery-link">
          Solicitar un nuevo enlace
        </Link>
      )}
      <Link to="/panel-administracion" className="admin-recovery-link">
        Volver al inicio de sesión
      </Link>
    </RecoveryShell>
  );
}
