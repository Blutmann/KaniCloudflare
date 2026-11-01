-- Migration: 20261101160000_kani_google_calendar_oauth.sql
-- KANI BARBER STUDIO — Almacenamiento seguro de tokens OAuth 2.0 de Google Calendar
--
-- Tabla protegida exclusivamente para service_role (backend del Worker).
-- No accesible por clientes anónimos ni usuarios regulares autenticados.

CREATE TABLE IF NOT EXISTS public.google_calendar_oauth_tokens (
  id text PRIMARY KEY DEFAULT 'primary',
  refresh_token text NOT NULL,
  access_token text,
  expires_at timestamptz,
  scope text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Revocar todos los accesos públicos y de anon/authenticated
REVOKE ALL ON TABLE public.google_calendar_oauth_tokens FROM public, anon, authenticated;

-- Otorgar control exclusivo a service_role
GRANT ALL ON TABLE public.google_calendar_oauth_tokens TO service_role;
