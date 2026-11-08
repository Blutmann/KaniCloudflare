-- Prepared security remediation. Not applied to production during the audit.
-- Missing/inactive staff must return false, never SQL NULL, in IF NOT authorization guards.
CREATE OR REPLACE FUNCTION public.check_is_admin_user()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_role text;
  v_jwt_claim text;
BEGIN
  -- 1. Usuario autenticado con token de sesión
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role
    FROM public.staff_profiles
    WHERE user_id = auth.uid() AND active = true;
    RETURN coalesce(v_role = 'ADMIN', false);
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
$function$
;
