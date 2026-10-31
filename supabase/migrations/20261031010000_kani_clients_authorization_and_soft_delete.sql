-- ==============================================================================
-- KANI BARBER STUDIO — MIGRACIÓN: AUTORIZACIÓN Y SOFT-DELETE DE CLIENTES
-- Archivo: 20261031010000_kani_clients_authorization_and_soft_delete.sql
-- Base autorizada: Supabase Test (iockpxtkflyjfagkvgnr)
-- ==============================================================================

-- 1. Actualizar RLS en public.clients para garantizar que:
--    - Admin puede actualizar y eliminar cualquier cliente.
--    - Barberos sólo pueden actualizar clientes con los que tienen turnos registrados.
--    - Barberos no pueden eliminar clientes.
DROP POLICY IF EXISTS staff_can_update_clients ON public.clients;
CREATE POLICY staff_can_update_clients
  ON public.clients
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
    OR (
      public.current_staff_barber_id() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.client_id = clients.id
          AND a.barber_id = public.current_staff_barber_id()
      )
    )
  )
  WITH CHECK (
    public.is_admin()
    OR (
      public.current_staff_barber_id() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.client_id = clients.id
          AND a.barber_id = public.current_staff_barber_id()
      )
    )
  );

DROP POLICY IF EXISTS admin_can_delete_clients ON public.clients;
CREATE POLICY admin_can_delete_clients
  ON public.clients
  FOR DELETE
  TO authenticated
  USING (
    public.is_admin()
  );

-- 2. Actualizar función RPC save_client con control de autorización granular
CREATE OR REPLACE FUNCTION public.save_client(
  p_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS public.clients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_clean_name text := trim(coalesce(p_name, ''));
  v_clean_phone text := trim(coalesce(p_phone, ''));
  v_phone_digits text := regexp_replace(v_clean_phone, '[^0-9]', '', 'g');
  v_clean_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_client public.clients%ROWTYPE;
  v_existing_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_admin AND v_staff_barber_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'FORBIDDEN_STAFF_REQUIRED';
  END IF;

  IF length(v_clean_name) < 2 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_NAME_INVALID';
  END IF;

  IF length(v_phone_digits) < 6 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_PHONE_INVALID';
  END IF;

  IF v_clean_email IS NOT NULL AND (position('@' in v_clean_email) <= 1 OR v_clean_email LIKE '%@kanibarber.internal') THEN
    v_clean_email := NULL;
  END IF;

  IF p_id IS NOT NULL THEN
    -- Verificación de permisos para edición de cliente existente:
    -- Admin puede editar cualquier cliente.
    -- Barbero sólo puede editar si el cliente tiene historial de turnos con dicho barbero.
    IF NOT v_is_admin THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.client_id = p_id
          AND a.barber_id = v_staff_barber_id
      ) THEN
        RAISE EXCEPTION USING errcode = '42501', message = 'FORBIDDEN_BARBER_NOT_LINKED: Solo puede editar clientes vinculados a su propia actividad.';
      END IF;
    END IF;

    SELECT * INTO v_client FROM public.clients WHERE id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING errcode = 'P0002', message = 'CLIENT_NOT_FOUND';
    END IF;

    UPDATE public.clients
    SET name = v_clean_name,
        phone = v_clean_phone,
        email = v_clean_email,
        deleted_at = NULL,
        updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_client;

    RETURN v_client;
  ELSE
    -- Creación de cliente (nuevo o reactivación)
    SELECT id INTO v_existing_id
    FROM public.clients c
    WHERE regexp_replace(c.phone, '[^0-9]', '', 'g') = v_phone_digits
       OR (v_clean_email IS NOT NULL AND lower(trim(coalesce(c.email, ''))) = v_clean_email)
    ORDER BY c.deleted_at NULLS FIRST, c.created_at ASC
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.clients
      SET name = v_clean_name,
          phone = v_clean_phone,
          email = coalesce(v_clean_email, email),
          deleted_at = NULL,
          updated_at = now()
      WHERE id = v_existing_id
      RETURNING * INTO v_client;

      RETURN v_client;
    END IF;

    INSERT INTO public.clients (name, phone, email, created_at, updated_at)
    VALUES (v_clean_name, v_clean_phone, v_clean_email, now(), now())
    RETURNING * INTO v_client;

    RETURN v_client;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_client(uuid, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_client(uuid, text, text, text) TO authenticated;

-- 3. Actualizar función RPC delete_client restringida exclusivamente a ADMIN
CREATE OR REPLACE FUNCTION public.delete_client(
  p_client_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'FORBIDDEN_ADMIN_REQUIRED: Solo los administradores pueden eliminar clientes.';
  END IF;

  IF p_client_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_ID_REQUIRED';
  END IF;

  -- Baja lógica: preservar integridad de turnos, pagos y registros históricos
  UPDATE public.clients
  SET deleted_at = now(),
      updated_at = now()
  WHERE id = p_client_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'CLIENT_NOT_FOUND';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_client(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_client(uuid) TO authenticated;
