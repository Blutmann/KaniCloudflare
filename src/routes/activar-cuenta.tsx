import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/activar-cuenta")({
  component: ActivateAccount,
  head: () => ({
    meta: [{ title: "Activar cuenta — KANI" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function ActivateAccount() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const parameters = new URL(window.location.href).searchParams;
      const code = parameters.get("code");
      const tokenHash = parameters.get("token_hash");
      if (tokenHash && parameters.get("type") === "invite")
        await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "invite" });
      if (code) await supabase.auth.exchangeCodeForSession(code);
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (cancelled) return;
      window.history.replaceState({}, "", "/activar-cuenta");
      if (error || !user)
        setError("La invitación venció o no es válida. Solicitá un nuevo enlace a KANI.");
      else setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < 12 || password !== form.get("confirmation")) {
      setError("Usá al menos 12 caracteres y confirmá la misma contraseña.");
      return;
    }
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(
        "No pudimos establecer la contraseña. Revisá los requisitos o solicitá una nueva invitación.",
      );
      setBusy(false);
    } else window.location.assign("/panel-administracion/turnos");
  }
  return (
    <main className="site-container admin-page">
      <div className="admin-login-shell mx-auto max-w-sm">
        <h1>Activá tu cuenta KANI</h1>
        <p>Elegí tu contraseña individual.</p>
        {error && <p role="alert">{error}</p>}
        {ready && (
          <form onSubmit={submit} className="space-y-5">
            <label className="field-label">
              Contraseña
              <input
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
              <input
                name="confirmation"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={1024}
                disabled={busy}
              />
            </label>
            <button className="v2-primary" disabled={busy}>
              {busy ? "Guardando…" : "Guardar y entrar"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
