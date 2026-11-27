-- ==============================================================================
-- KANI BARBER STUDIO — SEÑAS ONLINE (PAYWAY + MERCADO PAGO) POR FECHA REAL DE PAGO
-- ==============================================================================
-- Migración local (NO ejecutar remotamente sin autorización explícita).
--
-- Objetivo:
--   1. Actualizar public.get_online_deposit_movements para incluir tanto
--      public.payment_attempts (state = 'APPROVED', Payway/MP) como
--      public.appointment_payment_orders (reconciliation_status = 'CONFIRMED', Mercado Pago).
--   2. Usar la fecha/hora real de acreditación/confirmación en zona
--      America/Argentina/Buenos_Aires (coalesce(updated_at, created_at)) como
--      payment_date / payment_time, manteniendo appointments.booking_date y
--      appointments.start_time como metadatos informativos (appointment_date / appointment_time).
--   3. Autorizar operadores (ADMIN y MANAGER vía public.is_operator()) a ver todos los
--      barberos (o filtrar por p_barber_id), manteniendo scoping estricto por barber_id
--      para el rol BARBER.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_online_deposit_movements(
  p_barber_id uuid DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS TABLE (
  movement_id text,
  appointment_id uuid,
  provider text,
  amount_ars numeric,
  payment_date date,
  payment_time text,
  payment_timestamp timestamptz,
  barber_id uuid,
  barber_name text,
  service_name text,
  client_name text,
  client_contact text,
  appointment_date date,
  appointment_time text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_is_operator boolean := coalesce(public.is_operator(), public.is_admin(), false);
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_filter_barber uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_operator THEN
    IF v_staff_barber_id IS NULL THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'FORBIDDEN_STAFF_REQUIRED';
    END IF;
    v_filter_barber := v_staff_barber_id;
  ELSE
    v_filter_barber := p_barber_id;
  END IF;

  RETURN QUERY
  SELECT
    ('deposit-' || a.id::text)::text AS movement_id,
    a.id AS appointment_id,
    dep.provider::text AS provider,
    coalesce(dep.amount_ars, a.deposit_amount_ars::numeric, 5000::numeric) AS amount_ars,
    (timezone('America/Argentina/Buenos_Aires', coalesce(dep.paid_at, a.created_at)))::date AS payment_date,
    to_char(timezone('America/Argentina/Buenos_Aires', coalesce(dep.paid_at, a.created_at)), 'HH24:MI') AS payment_time,
    coalesce(dep.paid_at, a.created_at) AS payment_timestamp,
    a.barber_id,
    coalesce(b.name, 'Barbero')::text AS barber_name,
    (
      'Seña — ' ||
      CASE
        WHEN coalesce(a.custom_service_name, s.name, 'Corte') = 'Corte + barba' THEN 'Corte y barba'
        ELSE coalesce(a.custom_service_name, s.name, 'Corte')
      END
    )::text AS service_name,
    coalesce(a.booking_client_name, c.name, 'Cliente')::text AS client_name,
    coalesce(c.phone, '')::text AS client_contact,
    a.booking_date AS appointment_date,
    to_char(a.start_time, 'HH24:MI') AS appointment_time
  FROM public.appointments a
  JOIN LATERAL (
    SELECT src.provider, src.amount_ars, src.paid_at
    FROM (
      SELECT
        coalesce(p.provider, 'PAYWAY')::text AS provider,
        p.amount_ars::numeric AS amount_ars,
        coalesce(p.updated_at, p.created_at) AS paid_at
      FROM public.payment_attempts p
      WHERE p.appointment_id = a.id
        AND p.state = 'APPROVED'

      UNION ALL

      SELECT
        'MERCADO_PAGO'::text AS provider,
        coalesce(o.paid_amount_ars, o.expected_amount_ars)::numeric AS amount_ars,
        coalesce(o.updated_at, o.created_at) AS paid_at
      FROM public.appointment_payment_orders o
      WHERE o.appointment_id = a.id
        AND o.reconciliation_status = 'CONFIRMED'
    ) src
    ORDER BY src.paid_at DESC
    LIMIT 1
  ) dep ON true
  JOIN public.barbers b ON b.id = a.barber_id
  LEFT JOIN public.services s ON s.id = a.service_id
  LEFT JOIN public.clients c ON c.id = a.client_id
  WHERE a.status <> 'CANCELLED'
    AND (v_filter_barber IS NULL OR a.barber_id = v_filter_barber)
    AND (
      p_start_date IS NULL
      OR (timezone('America/Argentina/Buenos_Aires', coalesce(dep.paid_at, a.created_at)))::date >= p_start_date
    )
    AND (
      p_end_date IS NULL
      OR (timezone('America/Argentina/Buenos_Aires', coalesce(dep.paid_at, a.created_at)))::date <= p_end_date
    )
  ORDER BY coalesce(dep.paid_at, a.created_at) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_online_deposit_movements(uuid, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_online_deposit_movements(uuid, date, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
