-- Migration: 20261102020000_kani_benefit_codes_admin_authorization.sql
-- Kani Barber Studio — Benefit Codes Admin Authorization Fix
-- Reutiliza y asegura la verificación del rol ADMIN en el servidor y base de datos:
-- 1. Si auth.uid() está presente (usuario autenticado con token JWT), verifica rol ADMIN activo en staff_profiles.
-- 2. Si es llamado internamente desde el backend validado con claim service_role, permite la ejecución de la RPC.
-- 3. BARBER, usuarios anónimos o no autorizados continúan estrictamente bloqueados con UNAUTHORIZED_ADMIN_ONLY.

CREATE OR REPLACE FUNCTION public.check_is_admin_user()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_role text;
  v_jwt_claim text;
BEGIN
  -- 1. Usuario autenticado con token de sesión
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role
    FROM public.staff_profiles
    WHERE user_id = auth.uid() AND active = true;
    RETURN (v_role = 'ADMIN');
  END IF;

  -- 2. Llamadas internas desde servidor de Antigravity validadas
  BEGIN
    v_jwt_claim := current_setting('request.jwt.claim.role', true);
    IF v_jwt_claim = 'service_role' THEN
      RETURN true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- In case setting is not present
  END;

  RETURN false;
END;
$$;
