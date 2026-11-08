-- Migration: 20261108000100_kani_recurrences_memberships_and_discounts.sql
-- KANI BARBER STUDIO — SISTEMA INTEGRAL DE RECURRENCIAS, MEMBRESÍAS Y DESCUENTOS
--
-- Componentes:
-- 0. remediación idempotente de public.check_is_admin_user() (20261107190103) y métodos de pago en public.service_payments.
-- 1. Disponibilidades recurrentes (public.recurring_availability_rules + public.recurring_availability_exceptions)
--    - Evaluación dinámica e integración en public.read_valid_availability_starts y public.request_appointment
--      preservando public_booking_enabled y horarios de Franco (20261105072253).
--    - Soporte para Por única vez, Todos los días, Todas las semanas, Cada dos semanas, Todos los meses (omitiendo días inexistentes como 31 en meses cortos)
--    - Finalización: Hasta cancelar (NEVER), Hasta una fecha determinada (UNTIL_DATE), Después de N repeticiones (AFTER_COUNT)
--    - Excepciones por ocurrencia individual (BLOCKED / MODIFIED), división de serie (THIS_AND_FOLLOWING) y desactivación futura (ALL_FUTURE)
--    - Gestión de conflictos al bloquear horarios con turnos confirmados (check_availability_block_conflicts)
--
-- 2. Turnos manuales recurrentes (extensión aditiva e idempotente de public.recurring_appointment_rules, public.recurring_rule_conflicts y public.appointments)
--    - Ventana móvil de 90 días (sync_recurring_appointment_rules) con bloqueo transaccional pg_advisory_xact_lock
--    - Creación parcial ante conflictos: crea fechas libres, omite fechas ocupadas y las persiste en excluded_dates + recurring_rule_conflicts
--    - Modos de precio: Tarifa vigente (CURRENT_RATE) o Precio fijo (FIXED_PRICE)
--    - Vinculación opcional con membresía prepagada activa (incompatibilidad con códigos de descuento simultáneos)
--    - Modificación / cancelación con alcance: SINGLE, THIS_AND_FOLLOWING, ALL_FUTURE (preservando turnos con pagos registrados)
--    - Trigger automático: si se cancela individualmente una ocurrencia de una serie, la fecha queda en excluded_dates.
--
-- 3. Membresías prepagadas de 4 y 10 servicios (public.client_memberships, public.client_membership_items, public.client_membership_consumptions, public.client_membership_events)
--    - Membresía 4 servicios (10% descuento) y Membresía 10 servicios (15% descuento)
--    - Snapshot económico exacto en ARS enteros e inmutable ante cambios futuros de tarifas
--    - Titularidad individual e intransferible por cliente
--    - Estados: PENDING_PAYMENT, ACTIVE, EXHAUSTED, EXPIRED, CANCELLED
--    - Todos los métodos de pago existentes en KANI: Efectivo, Transferencia, Tarjeta — Payway, Tarjeta de crédito, Tarjeta de débito, Payway, Mercado Pago
--    - Imputación contable única al adquirir el paquete sin duplicar ingresos al consumir sesiones
--    - Consumo estricto por servicio contratado (SERVICE_COMPLETED o NO_SHOW_DEDUCTION), con prevención de duplicados y reintegro auditado (REFUNDED)
--
-- 4. Seguridad RBAC + RLS estricta para ADMIN, MANAGER (public.is_operator()) y BARBER (public.current_staff_barber_id()).

SET LOCAL lock_timeout = '5s';

-- ==============================================================================
-- 0. REMEDIACIÓN IDEMPOTENTE DE GUARDIA ADMIN Y MÉTODOS DE PAGO KANI
-- ==============================================================================

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
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role
    FROM public.staff_profiles
    WHERE user_id = auth.uid() AND active = true;
    RETURN coalesce(v_role = 'ADMIN', false);
  END IF;

  BEGIN
    v_jwt_claim := current_setting('request.jwt.claim.role', true);
    IF v_jwt_claim = 'service_role' THEN
      RETURN true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN false;
END;
$function$;

-- Ampliar restricción de métodos de pago en service_payments para admitir todos los medios existentes en KANI
ALTER TABLE public.service_payments
  DROP CONSTRAINT IF EXISTS service_payments_payment_method_check;

ALTER TABLE public.service_payments
  ADD CONSTRAINT service_payments_payment_method_check
  CHECK (
    payment_method = ANY (
      ARRAY[
        'Efectivo'::text,
        'Transferencia'::text,
        'Tarjeta — Payway'::text,
        'Tarjeta de crédito'::text,
        'Tarjeta de débito'::text,
        'Payway'::text,
        'Mercado Pago'::text
      ]
    )
  );

-- ==============================================================================
-- 1. FUNCIÓN AUXILIAR DE EVALUACIÓN DE FECHAS RECURRENTES (CON REGLA DEL DÍA 31)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.generate_recurrence_dates(
  p_start_date date,
  p_frequency_type text,
  p_end_type text DEFAULT 'NEVER',
  p_end_date date DEFAULT NULL,
  p_max_occurrences integer DEFAULT NULL,
  p_window_from date DEFAULT NULL,
  p_window_to date DEFAULT NULL,
  p_excluded_dates date[] DEFAULT '{}'::date[]
)
RETURNS SETOF date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_freq text := upper(trim(coalesce(p_frequency_type, 'WEEKLY')));
  v_end text := upper(trim(coalesce(p_end_type, 'NEVER')));
  v_from date := coalesce(p_window_from, p_start_date);
  v_to date := coalesce(p_window_to, p_start_date + 90);
  v_cur date;
  v_occ_count integer := 0;
  v_step integer := 0;
  v_target_day integer := extract(day from p_start_date)::integer;
  v_candidate_month date;
  v_days_in_month integer;
BEGIN
  IF p_start_date IS NULL OR v_to < p_start_date OR v_from > v_to THEN
    RETURN;
  END IF;

  IF v_end = 'UNTIL_DATE' AND p_end_date IS NOT NULL AND p_end_date < v_to THEN
    v_to := p_end_date;
  END IF;

  IF v_freq = 'ONCE' THEN
    IF p_start_date BETWEEN v_from AND v_to
       AND NOT (p_start_date = ANY(coalesce(p_excluded_dates, '{}'::date[]))) THEN
      RETURN NEXT p_start_date;
    END IF;
    RETURN;
  END IF;

  WHILE true LOOP
    IF v_freq = 'DAILY' THEN
      v_cur := p_start_date + v_step;
    ELSIF v_freq = 'WEEKLY' THEN
      v_cur := p_start_date + (v_step * 7);
    ELSIF v_freq = 'BIWEEKLY' THEN
      v_cur := p_start_date + (v_step * 14);
    ELSIF v_freq = 'TRIWEEKLY' THEN
      v_cur := p_start_date + (v_step * 21);
    ELSIF v_freq = 'MONTHLY' THEN
      v_candidate_month := (date_trunc('month', p_start_date)::date + (v_step || ' months')::interval)::date;
      v_days_in_month := extract(day from (date_trunc('month', v_candidate_month) + interval '1 month - 1 day'))::integer;
      -- Regla estricta: si la recurrencia mensual es el día 31 (o 29/30 en feb) y el mes no tiene ese día, se omite ese mes.
      IF v_target_day > v_days_in_month THEN
        v_step := v_step + 1;
        IF v_candidate_month > v_to THEN
          EXIT;
        END IF;
        CONTINUE;
      END IF;
      v_cur := (v_candidate_month + (v_target_day - 1));
    ELSE
      EXIT;
    END IF;

    v_step := v_step + 1;

    IF v_cur > v_to THEN
      EXIT;
    END IF;

    IF v_end = 'UNTIL_DATE' AND p_end_date IS NOT NULL AND v_cur > p_end_date THEN
      EXIT;
    END IF;

    v_occ_count := v_occ_count + 1;
    IF v_end = 'AFTER_COUNT' AND p_max_occurrences IS NOT NULL AND v_occ_count > p_max_occurrences THEN
      EXIT;
    END IF;

    IF v_cur >= v_from AND NOT (v_cur = ANY(coalesce(p_excluded_dates, '{}'::date[]))) THEN
      RETURN NEXT v_cur;
    END IF;

    IF v_step > 2000 THEN
      EXIT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_recurrence_dates(date, text, text, date, integer, date, date, date[]) FROM public;
GRANT EXECUTE ON FUNCTION public.generate_recurrence_dates(date, text, text, date, integer, date, date, date[]) TO anon, authenticated, service_role;

-- ==============================================================================
-- 2. DISPONIBILIDADES RECURRENTES Y EXCEPCIONES (FASE 3, 6, 11)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.recurring_availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  frequency_type text NOT NULL CHECK (frequency_type IN ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY')),
  end_type text NOT NULL DEFAULT 'NEVER' CHECK (end_type IN ('NEVER', 'UNTIL_DATE', 'AFTER_COUNT')),
  end_date date DEFAULT NULL,
  max_occurrences integer DEFAULT NULL CHECK (max_occurrences IS NULL OR max_occurrences >= 1),
  excluded_dates date[] NOT NULL DEFAULT '{}'::date[],
  active boolean NOT NULL DEFAULT true,
  internal_note text DEFAULT NULL,
  created_by_user_id uuid DEFAULT auth.uid(),
  created_by_display_name text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recurring_availability_rules_barber_active
  ON public.recurring_availability_rules (barber_id, active, start_date);

CREATE TABLE IF NOT EXISTS public.recurring_availability_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.recurring_availability_rules(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  exception_type text NOT NULL CHECK (exception_type IN ('BLOCKED', 'MODIFIED')),
  override_start_time time DEFAULT NULL,
  override_end_time time DEFAULT NULL,
  reason text DEFAULT NULL,
  created_by_user_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, exception_date)
);

ALTER TABLE public.recurring_availability_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_availability_exceptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.recurring_availability_rules FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recurring_availability_rules TO authenticated;
GRANT ALL ON TABLE public.recurring_availability_rules TO service_role;

REVOKE ALL ON TABLE public.recurring_availability_exceptions FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recurring_availability_exceptions TO authenticated;
GRANT ALL ON TABLE public.recurring_availability_exceptions TO service_role;

DROP POLICY IF EXISTS "staff_read_recurring_availability_rules" ON public.recurring_availability_rules;
CREATE POLICY "staff_read_recurring_availability_rules"
  ON public.recurring_availability_rules
  FOR SELECT
  TO authenticated
  USING (
    coalesce(public.is_operator(), false)
    OR barber_id = public.current_staff_barber_id()
  );

DROP POLICY IF EXISTS "staff_manage_recurring_availability_rules" ON public.recurring_availability_rules;
CREATE POLICY "staff_manage_recurring_availability_rules"
  ON public.recurring_availability_rules
  FOR ALL
  TO authenticated
  USING (
    coalesce(public.is_operator(), false)
    OR barber_id = public.current_staff_barber_id()
  )
  WITH CHECK (
    coalesce(public.is_operator(), false)
    OR barber_id = public.current_staff_barber_id()
  );

DROP POLICY IF EXISTS "staff_read_recurring_availability_exceptions" ON public.recurring_availability_exceptions;
CREATE POLICY "staff_read_recurring_availability_exceptions"
  ON public.recurring_availability_exceptions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recurring_availability_rules r
      WHERE r.id = rule_id
        AND (coalesce(public.is_operator(), false) OR r.barber_id = public.current_staff_barber_id())
    )
  );

DROP POLICY IF EXISTS "staff_manage_recurring_availability_exceptions" ON public.recurring_availability_exceptions;
CREATE POLICY "staff_manage_recurring_availability_exceptions"
  ON public.recurring_availability_exceptions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recurring_availability_rules r
      WHERE r.id = rule_id
        AND (coalesce(public.is_operator(), false) OR r.barber_id = public.current_staff_barber_id())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.recurring_availability_rules r
      WHERE r.id = rule_id
        AND (coalesce(public.is_operator(), false) OR r.barber_id = public.current_staff_barber_id())
    )
  );

-- RPC para crear una regla de disponibilidad recurrente
CREATE OR REPLACE FUNCTION public.create_recurring_availability_rule(
  p_barber_id uuid,
  p_start_date date,
  p_start_time time,
  p_end_time time DEFAULT NULL,
  p_frequency_type text DEFAULT 'WEEKLY',
  p_end_type text DEFAULT 'NEVER',
  p_end_date date DEFAULT NULL,
  p_max_occurrences integer DEFAULT NULL,
  p_internal_note text DEFAULT NULL
)
RETURNS public.recurring_availability_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
  v_is_op boolean := coalesce(public.is_operator(), false);
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_freq text := upper(trim(coalesce(p_frequency_type, 'WEEKLY')));
  v_end_type text := upper(trim(coalesce(p_end_type, 'NEVER')));
  v_end_time time;
  v_display_name text;
  v_rule public.recurring_availability_rules%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_op AND (v_staff_barber_id IS NULL OR v_staff_barber_id IS DISTINCT FROM p_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  END IF;

  IF p_start_date IS NULL OR p_start_date < v_today THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'AVAILABILITY_DATE_INVALID';
  END IF;

  IF v_freq NOT IN ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'FREQUENCY_INVALID';
  END IF;

  IF v_end_type NOT IN ('NEVER', 'UNTIL_DATE', 'AFTER_COUNT') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'END_TYPE_INVALID';
  END IF;

  IF v_end_type = 'UNTIL_DATE' AND (p_end_date IS NULL OR p_end_date < p_start_date) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'END_DATE_INVALID';
  END IF;

  IF v_end_type = 'AFTER_COUNT' AND (p_max_occurrences IS NULL OR p_max_occurrences < 1) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'MAX_OCCURRENCES_INVALID';
  END IF;

  v_end_time := coalesce(p_end_time, (p_start_time + interval '45 minutes')::time);

  SELECT sp.display_name INTO v_display_name
  FROM public.staff_profiles sp
  WHERE sp.user_id = auth.uid() AND sp.active = true
  LIMIT 1;

  INSERT INTO public.recurring_availability_rules (
    barber_id,
    start_date,
    start_time,
    end_time,
    frequency_type,
    end_type,
    end_date,
    max_occurrences,
    active,
    internal_note,
    created_by_user_id,
    created_by_display_name
  ) VALUES (
    p_barber_id,
    p_start_date,
    p_start_time,
    v_end_time,
    v_freq,
    v_end_type,
    CASE WHEN v_end_type = 'UNTIL_DATE' THEN p_end_date ELSE NULL END,
    CASE WHEN v_end_type = 'AFTER_COUNT' THEN p_max_occurrences ELSE NULL END,
    true,
    nullif(trim(coalesce(p_internal_note, '')), ''),
    auth.uid(),
    coalesce(v_display_name, 'Staff')
  )
  RETURNING * INTO v_rule;

  -- Materializar las ocurrencias en los próximos 60 días en barber_availability_slots para edición rápida en la grilla administrativa
  INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status, internal_note, updated_by)
  SELECT
    p_barber_id,
    occ_date,
    p_start_time,
    v_end_time,
    'AVAILABLE'::public.availability_status,
    v_rule.internal_note,
    auth.uid()
  FROM public.generate_recurrence_dates(
    p_start_date,
    v_freq,
    v_end_type,
    v_rule.end_date,
    v_rule.max_occurrences,
    p_start_date,
    (v_today + 60)::date,
    '{}'::date[]
  ) AS occ_date
  ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING;

  RETURN v_rule;
END;
$$;

REVOKE ALL ON FUNCTION public.create_recurring_availability_rule(uuid, date, time, time, text, text, date, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_recurring_availability_rule(uuid, date, time, time, text, text, date, integer, text) TO authenticated;

-- Modificar o desactivar disponibilidad recurrente por alcance (SINGLE, THIS_AND_FOLLOWING, ALL_FUTURE)
CREATE OR REPLACE FUNCTION public.modify_recurring_availability_rule(
  p_rule_id uuid,
  p_scope text, -- 'SINGLE' | 'THIS_AND_FOLLOWING' | 'ALL_FUTURE'
  p_target_date date,
  p_action text, -- 'BLOCK' | 'MODIFY' | 'DEACTIVATE'
  p_new_start_time time DEFAULT NULL,
  p_new_end_time time DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_rule public.recurring_availability_rules%ROWTYPE;
  v_is_op boolean := coalesce(public.is_operator(), false);
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_scope text := upper(trim(coalesce(p_scope, 'SINGLE')));
  v_action text := upper(trim(coalesce(p_action, 'BLOCK')));
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
  v_new_rule_id uuid := NULL;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO v_rule
  FROM public.recurring_availability_rules
  WHERE id = p_rule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'RULE_NOT_FOUND';
  END IF;

  IF NOT v_is_op AND (v_staff_barber_id IS NULL OR v_staff_barber_id IS DISTINCT FROM v_rule.barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  END IF;

  IF v_scope = 'SINGLE' THEN
    IF p_target_date IS NULL THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'TARGET_DATE_REQUIRED';
    END IF;

    UPDATE public.recurring_availability_rules
    SET excluded_dates = array_append(array_remove(excluded_dates, p_target_date), p_target_date),
        updated_at = now()
    WHERE id = v_rule.id;

    INSERT INTO public.recurring_availability_exceptions (
      rule_id, exception_date, exception_type, override_start_time, override_end_time, reason, created_by_user_id
    ) VALUES (
      v_rule.id,
      p_target_date,
      CASE WHEN v_action = 'MODIFY' THEN 'MODIFIED' ELSE 'BLOCKED' END,
      p_new_start_time,
      p_new_end_time,
      p_reason,
      auth.uid()
    )
    ON CONFLICT (rule_id, exception_date) DO UPDATE
    SET exception_type = EXCLUDED.exception_type,
        override_start_time = EXCLUDED.override_start_time,
        override_end_time = EXCLUDED.override_end_time,
        reason = EXCLUDED.reason;

    IF v_action = 'MODIFY' AND p_new_start_time IS NOT NULL THEN
      DELETE FROM public.barber_availability_slots
      WHERE barber_id = v_rule.barber_id
        AND slot_date = p_target_date
        AND start_time = v_rule.start_time;

      INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status, internal_note, updated_by)
      VALUES (
        v_rule.barber_id,
        p_target_date,
        p_new_start_time,
        coalesce(p_new_end_time, (p_new_start_time + interval '45 minutes')::time),
        'AVAILABLE',
        p_reason,
        auth.uid()
      )
      ON CONFLICT (barber_id, slot_date, start_time) DO UPDATE
      SET end_time = EXCLUDED.end_time,
          status = 'AVAILABLE',
          internal_note = EXCLUDED.internal_note,
          updated_at = now();
    ELSE
      UPDATE public.barber_availability_slots
      SET status = 'UNAVAILABLE',
          internal_note = coalesce(p_reason, internal_note),
          updated_by = auth.uid(),
          updated_at = now()
      WHERE barber_id = v_rule.barber_id
        AND slot_date = p_target_date
        AND start_time = v_rule.start_time;
    END IF;

  ELSIF v_scope = 'THIS_AND_FOLLOWING' THEN
    IF p_target_date IS NULL THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'TARGET_DATE_REQUIRED';
    END IF;

    UPDATE public.recurring_availability_rules
    SET end_type = 'UNTIL_DATE',
        end_date = (p_target_date - 1),
        active = CASE WHEN (p_target_date - 1) < start_date THEN false ELSE active END,
        updated_at = now()
    WHERE id = v_rule.id;

    DELETE FROM public.barber_availability_slots
    WHERE barber_id = v_rule.barber_id
      AND slot_date >= p_target_date
      AND start_time = v_rule.start_time
      AND status = 'AVAILABLE';

    IF v_action = 'MODIFY' AND p_new_start_time IS NOT NULL THEN
      INSERT INTO public.recurring_availability_rules (
        barber_id, start_date, start_time, end_time, frequency_type, end_type, end_date, max_occurrences, active, internal_note, created_by_user_id, created_by_display_name
      ) VALUES (
        v_rule.barber_id,
        p_target_date,
        p_new_start_time,
        coalesce(p_new_end_time, (p_new_start_time + interval '45 minutes')::time),
        v_rule.frequency_type,
        v_rule.end_type,
        v_rule.end_date,
        v_rule.max_occurrences,
        true,
        coalesce(p_reason, v_rule.internal_note),
        auth.uid(),
        v_rule.created_by_display_name
      ) RETURNING id INTO v_new_rule_id;
    END IF;

  ELSIF v_scope = 'ALL_FUTURE' THEN
    UPDATE public.recurring_availability_rules
    SET active = false,
        end_type = 'UNTIL_DATE',
        end_date = LEAST(coalesce(end_date, v_today), v_today - 1),
        updated_at = now()
    WHERE id = v_rule.id;

    DELETE FROM public.barber_availability_slots
    WHERE barber_id = v_rule.barber_id
      AND slot_date >= GREATEST(v_today, coalesce(p_target_date, v_today))
      AND start_time = v_rule.start_time
      AND status = 'AVAILABLE';
  END IF;

  RETURN jsonb_build_object(
    'rule_id', v_rule.id,
    'new_rule_id', v_new_rule_id,
    'scope', v_scope,
    'action', v_action
  );
END;
$$;

REVOKE ALL ON FUNCTION public.modify_recurring_availability_rule(uuid, text, date, text, time, time, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.modify_recurring_availability_rule(uuid, text, date, text, time, time, text) TO authenticated;

-- FASE 6: Verificar turnos afectados antes de bloquear un horario o período
CREATE OR REPLACE FUNCTION public.check_availability_block_conflicts(
  p_barber_id uuid,
  p_from_date date,
  p_to_date date,
  p_start_time time DEFAULT NULL,
  p_end_time time DEFAULT NULL
)
RETURNS TABLE (
  appointment_id uuid,
  booking_date date,
  start_time time,
  end_time time,
  client_name text,
  service_name text,
  barber_name text,
  status public.appointment_status
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_is_op boolean := coalesce(public.is_operator(), false);
  v_staff_barber_id uuid := public.current_staff_barber_id();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_op AND (v_staff_barber_id IS NULL OR v_staff_barber_id IS DISTINCT FROM p_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  END IF;

  RETURN QUERY
  SELECT
    a.id AS appointment_id,
    a.booking_date,
    a.start_time,
    a.end_time,
    coalesce(a.booking_client_name, c.name, 'Cliente') AS client_name,
    coalesce(a.custom_service_name, s.name, 'Servicio') AS service_name,
    b.name AS barber_name,
    a.status
  FROM public.appointments a
  JOIN public.barbers b ON b.id = a.barber_id
  LEFT JOIN public.clients c ON c.id = a.client_id
  LEFT JOIN public.services s ON s.id = a.service_id
  WHERE a.barber_id = p_barber_id
    AND a.booking_date BETWEEN p_from_date AND coalesce(p_to_date, p_from_date)
    AND a.status IN ('PENDING', 'CONFIRMED')
    AND (
      p_start_time IS NULL
      OR tsrange(
        (a.booking_date + a.start_time)::timestamp,
        ((a.booking_date + CASE WHEN a.end_time <= a.start_time THEN 1 ELSE 0 END) + a.end_time)::timestamp,
        '[)'
      ) && tsrange(
        (a.booking_date + p_start_time)::timestamp,
        ((a.booking_date + CASE WHEN coalesce(p_end_time, (p_start_time + interval '45 minutes')::time) <= p_start_time THEN 1 ELSE 0 END) + coalesce(p_end_time, (p_start_time + interval '45 minutes')::time))::timestamp,
        '[)'
      )
    )
  ORDER BY a.booking_date ASC, a.start_time ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.check_availability_block_conflicts(uuid, date, date, time, time) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.check_availability_block_conflicts(uuid, date, date, time, time) TO authenticated;

-- Actualizar read_valid_availability_starts preservando íntegramente 20261105072253_kani_public_booking_visibility.sql
-- (public_booking_enabled y Sábados 15:00-20:00 de Franco) y proyectando dinámicamente recurring_availability_rules
CREATE OR REPLACE FUNCTION public.read_valid_availability_starts(
  p_barber_id uuid DEFAULT NULL::uuid,
  p_from_date date DEFAULT NULL::date,
  p_to_date date DEFAULT NULL::date
)
RETURNS TABLE(
  barber_id uuid,
  slot_date date,
  start_time time without time zone,
  is_exception boolean,
  compatible_services text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
#variable_conflict use_column
DECLARE
  v_from date := coalesce(p_from_date, (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date);
  v_to date := coalesce(p_to_date, v_from + 21);
BEGIN
  IF v_from > v_to THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'DATE_RANGE_INVALID';
  END IF;

  RETURN QUERY
  WITH recurring_base_slots AS (
    -- Horizonte dinámico continuo para Franco (Sábados 15:00 a 20:00)
    SELECT
      b.id AS barber_id,
      d::date AS slot_date,
      slot_def.start_time,
      slot_def.end_time,
      (d::date + slot_def.start_time)::timestamp AS slot_start_ts,
      ((d::date + CASE WHEN slot_def.end_time <= slot_def.start_time THEN 1 ELSE 0 END) + slot_def.end_time)::timestamp AS slot_end_ts
    FROM public.barbers b
    CROSS JOIN generate_series(v_from, v_to, interval '1 day') AS d
    CROSS JOIN (
      VALUES
        (time '15:00:00', time '15:45:00'),
        (time '15:45:00', time '16:30:00'),
        (time '16:30:00', time '17:15:00'),
        (time '17:15:00', time '18:00:00'),
        (time '18:00:00', time '18:45:00'),
        (time '18:45:00', time '19:30:00'),
        (time '19:30:00', time '20:00:00')
    ) AS slot_def(start_time, end_time)
    WHERE b.name = 'Franco'
      AND b.active = true
      AND (b.public_booking_enabled OR coalesce((SELECT public.is_operator()), false) OR b.id = (SELECT public.current_staff_barber_id()))
      AND extract(isodow from d) = 6
      AND (p_barber_id IS NULL OR b.id = p_barber_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.barber_availability_slots blk
        WHERE blk.barber_id = b.id
          AND blk.slot_date = d::date
          AND blk.status = 'UNAVAILABLE'
          AND tsrange(
            d::date + slot_def.start_time,
            (d::date + CASE WHEN slot_def.end_time <= slot_def.start_time THEN 1 ELSE 0 END) + slot_def.end_time,
            '[)'
          ) && tsrange(
            blk.slot_date + blk.start_time,
            (blk.slot_date + CASE WHEN blk.end_time <= blk.start_time THEN 1 ELSE 0 END) + blk.end_time,
            '[)'
          )
      )
  ), dynamic_recurring_rule_slots AS (
    -- Reglas de disponibilidad recurrente configuradas por staff
    SELECT
      r.barber_id,
      occ_date AS slot_date,
      coalesce(exc.override_start_time, r.start_time) AS start_time,
      coalesce(exc.override_end_time, r.end_time) AS end_time,
      (occ_date + coalesce(exc.override_start_time, r.start_time))::timestamp AS slot_start_ts,
      ((occ_date + CASE WHEN coalesce(exc.override_end_time, r.end_time) <= coalesce(exc.override_start_time, r.start_time) THEN 1 ELSE 0 END) + coalesce(exc.override_end_time, r.end_time))::timestamp AS slot_end_ts
    FROM public.recurring_availability_rules r
    JOIN public.barbers b ON b.id = r.barber_id AND b.active = true
      AND (b.public_booking_enabled OR coalesce((SELECT public.is_operator()), false) OR b.id = (SELECT public.current_staff_barber_id()))
    CROSS JOIN LATERAL public.generate_recurrence_dates(
      r.start_date,
      r.frequency_type,
      r.end_type,
      r.end_date,
      r.max_occurrences,
      v_from,
      v_to,
      r.excluded_dates
    ) AS occ_date
    LEFT JOIN public.recurring_availability_exceptions exc
      ON exc.rule_id = r.id AND exc.exception_date = occ_date
    WHERE r.active = true
      AND (p_barber_id IS NULL OR r.barber_id = p_barber_id)
      AND (exc.id IS NULL OR exc.exception_type = 'MODIFIED')
      AND NOT EXISTS (
        SELECT 1
        FROM public.barber_availability_slots blk
        WHERE blk.barber_id = r.barber_id
          AND blk.slot_date = occ_date
          AND blk.status = 'UNAVAILABLE'
          AND tsrange(
            occ_date + coalesce(exc.override_start_time, r.start_time),
            (occ_date + CASE WHEN coalesce(exc.override_end_time, r.end_time) <= coalesce(exc.override_start_time, r.start_time) THEN 1 ELSE 0 END) + coalesce(exc.override_end_time, r.end_time),
            '[)'
          ) && tsrange(
            blk.slot_date + blk.start_time,
            (blk.slot_date + CASE WHEN blk.end_time <= blk.start_time THEN 1 ELSE 0 END) + blk.end_time,
            '[)'
          )
      )
  ), stored_available_slots AS (
    -- Slots explícitos almacenados en BD
    SELECT
      s.barber_id,
      s.slot_date,
      s.start_time,
      s.end_time,
      (s.slot_date + s.start_time)::timestamp AS slot_start_ts,
      ((s.slot_date + CASE WHEN s.end_time <= s.start_time THEN 1 ELSE 0 END) + s.end_time)::timestamp AS slot_end_ts
    FROM public.barber_availability_slots s
    JOIN public.barbers b ON b.id = s.barber_id AND b.active = true
      AND (b.public_booking_enabled OR coalesce((SELECT public.is_operator()), false) OR b.id = (SELECT public.current_staff_barber_id()))
    WHERE s.status = 'AVAILABLE'
      AND s.slot_date BETWEEN v_from AND v_to
      AND (p_barber_id IS NULL OR s.barber_id = p_barber_id)
      AND (s.end_time > s.start_time OR s.end_time = time '00:00:00')
  ), available_slots AS (
    SELECT s.barber_id, s.slot_date, s.start_time, s.end_time, s.slot_start_ts, s.slot_end_ts FROM stored_available_slots s
    UNION
    SELECT r.barber_id, r.slot_date, r.start_time, r.end_time, r.slot_start_ts, r.slot_end_ts FROM recurring_base_slots r
    UNION
    SELECT dr.barber_id, dr.slot_date, dr.start_time, dr.end_time, dr.slot_start_ts, dr.slot_end_ts FROM dynamic_recurring_rule_slots dr
  ), standard_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      gs.candidate_start,
      (extract(isodow from s.slot_date) = 7) AS is_exception
    FROM available_slots s
    CROSS JOIN LATERAL generate_series(
      s.slot_date + time '10:00',
      s.slot_date + time '19:00',
      interval '45 minutes'
    ) AS gs(candidate_start)
    WHERE gs.candidate_start >= s.slot_start_ts
      AND gs.candidate_start < s.slot_end_ts
  ), franco_saturday_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      (s.slot_date + franco_time.t)::timestamp AS candidate_start,
      false AS is_exception
    FROM available_slots s
    JOIN public.barbers b ON b.id = s.barber_id AND b.name = 'Franco'
    CROSS JOIN (
      VALUES
        (time '15:00:00'),
        (time '15:45:00'),
        (time '16:30:00'),
        (time '17:15:00'),
        (time '18:00:00'),
        (time '18:45:00'),
        (time '19:00:00'),
        (time '19:15:00'),
        (time '19:30:00')
    ) AS franco_time(t)
    WHERE extract(isodow from s.slot_date) = 6
      AND (s.slot_date + franco_time.t)::timestamp >= s.slot_start_ts
      AND (s.slot_date + franco_time.t)::timestamp < s.slot_end_ts
  ), extended_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      gs.candidate_start,
      true AS is_exception
    FROM available_slots s
    CROSS JOIN LATERAL generate_series(
      s.slot_start_ts,
      s.slot_end_ts - interval '5 minutes',
      interval '45 minutes'
    ) AS gs(candidate_start)
    WHERE gs.candidate_start::date = s.slot_date
  ), closing_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      (s.slot_date + offset_time.t)::timestamp AS candidate_start,
      false AS is_exception
    FROM available_slots s
    CROSS JOIN (
      VALUES (time '19:00:00'), (time '19:15:00'), (time '19:30:00')
    ) AS offset_time(t)
    WHERE (s.slot_date + offset_time.t)::timestamp >= s.slot_start_ts
      AND (s.slot_date + offset_time.t)::timestamp < s.slot_end_ts
  ), all_candidates AS (
    SELECT
      u.barber_id,
      u.slot_date,
      u.candidate_start,
      bool_and(u.is_exception) AS is_exception
    FROM (
      SELECT sc.barber_id, sc.slot_date, sc.candidate_start, sc.is_exception FROM standard_candidates sc
      UNION ALL
      SELECT fc.barber_id, fc.slot_date, fc.candidate_start, fc.is_exception FROM franco_saturday_candidates fc
      UNION ALL
      SELECT ec.barber_id, ec.slot_date, ec.candidate_start, ec.is_exception FROM extended_candidates ec
      UNION ALL
      SELECT cc.barber_id, cc.slot_date, cc.candidate_start, cc.is_exception FROM closing_candidates cc
    ) u
    GROUP BY u.barber_id, u.slot_date, u.candidate_start
  )
  SELECT
    c.barber_id,
    c.slot_date,
    c.candidate_start::time AS start_time,
    c.is_exception,
    compatibility.compatible_services
  FROM all_candidates c
  CROSS JOIN LATERAL (
    SELECT coalesce(array_agg(svc.name ORDER BY svc.name), '{}'::text[]) AS compatible_services
    FROM public.services svc
    WHERE svc.active
      AND svc.duration_minutes > 0
      AND NOT EXISTS (
        SELECT 1
        FROM generate_series(
          0,
          ceil(svc.duration_minutes::numeric / 5)::integer - 1
        ) AS requested(segment_index)
        WHERE NOT EXISTS (
          SELECT 1
          FROM available_slots available
          WHERE available.barber_id = c.barber_id
            AND available.slot_date = c.slot_date
            AND tsrange(
              c.candidate_start + requested.segment_index * interval '5 minutes',
              c.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
            ) <@ tsrange(
              available.slot_date + available.start_time,
              (available.slot_date + CASE WHEN available.end_time <= available.start_time THEN 1 ELSE 0 END) + available.end_time, '[)'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.barber_availability_slots blocked
              WHERE blocked.barber_id = c.barber_id
                AND blocked.slot_date = c.slot_date
                AND blocked.status = 'UNAVAILABLE'
                AND tsrange(
                  c.candidate_start + requested.segment_index * interval '5 minutes',
                  c.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
                ) && tsrange(
                  blocked.slot_date + blocked.start_time,
                  (blocked.slot_date + CASE WHEN blocked.end_time <= blocked.start_time THEN 1 ELSE 0 END) + blocked.end_time, '[)'
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.appointments a
              WHERE a.barber_id = c.barber_id
                AND a.booking_date = c.slot_date
                AND a.status <> 'CANCELLED'
                AND tsrange(
                  c.candidate_start + requested.segment_index * interval '5 minutes',
                  c.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
                ) && tsrange(
                  a.booking_date + a.start_time,
                  (a.booking_date + CASE WHEN a.end_time <= a.start_time THEN 1 ELSE 0 END) + a.end_time, '[)'
                )
            )
        )
      )
  ) compatibility
  WHERE cardinality(compatibility.compatible_services) > 0
  ORDER BY c.barber_id, c.slot_date, c.candidate_start;
END;
$function$;

REVOKE ALL ON FUNCTION public.read_valid_availability_starts(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.read_valid_availability_starts(uuid, date, date) TO anon, authenticated, service_role;

-- ==============================================================================
-- 3. MEMBRESÍAS PREPAGADAS DE 4 Y 10 SERVICIOS (FASE 7, 8, 9, 13)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.client_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  barber_id uuid REFERENCES public.barbers(id) ON DELETE SET NULL,
  plan_name text NOT NULL,
  package_size integer NOT NULL CHECK (package_size IN (4, 10)),
  discount_percent integer NOT NULL CHECK (discount_percent IN (10, 15)),
  subtotal_ars integer NOT NULL CHECK (subtotal_ars >= 0),
  discount_amount_ars integer NOT NULL CHECK (discount_amount_ars >= 0),
  total_price_ars integer NOT NULL CHECK (total_price_ars >= 0),
  total_sessions integer NOT NULL CHECK (total_sessions IN (4, 10)),
  consumed_sessions integer NOT NULL DEFAULT 0 CHECK (consumed_sessions >= 0 AND consumed_sessions <= total_sessions),
  status text NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN ('PENDING_PAYMENT', 'ACTIVE', 'EXHAUSTED', 'EXPIRED', 'CANCELLED')),
  payment_method text DEFAULT NULL,
  payment_id uuid DEFAULT NULL REFERENCES public.service_payments(id) ON DELETE SET NULL,
  paid_at timestamptz DEFAULT NULL,
  expires_at date DEFAULT NULL,
  expires_updated_by uuid DEFAULT NULL,
  expires_updated_at timestamptz DEFAULT NULL,
  notes text DEFAULT NULL,
  created_by_user_id uuid DEFAULT auth.uid(),
  created_by_display_name text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_plan_discount_match CHECK (
    (package_size = 4 AND discount_percent = 10 AND total_sessions = 4)
    OR (package_size = 10 AND discount_percent = 15 AND total_sessions = 10)
  )
);

CREATE INDEX IF NOT EXISTS idx_client_memberships_client_status
  ON public.client_memberships (client_id, status);
CREATE INDEX IF NOT EXISTS idx_client_memberships_barber_status
  ON public.client_memberships (barber_id, status);

CREATE TABLE IF NOT EXISTS public.client_membership_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.client_memberships(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  service_name text NOT NULL CHECK (service_name IN ('Corte', 'Barba', 'Corte y barba')),
  unit_price_snapshot_ars integer NOT NULL CHECK (unit_price_snapshot_ars >= 0),
  total_quantity integer NOT NULL CHECK (total_quantity > 0 AND total_quantity <= 10),
  consumed_quantity integer NOT NULL DEFAULT 0 CHECK (consumed_quantity >= 0 AND consumed_quantity <= total_quantity),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, service_name)
);

CREATE TABLE IF NOT EXISTS public.client_membership_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.client_memberships(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.client_membership_items(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  barber_id uuid REFERENCES public.barbers(id) ON DELETE SET NULL,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  service_name text NOT NULL,
  consumption_type text NOT NULL CHECK (consumption_type IN ('SERVICE_COMPLETED', 'NO_SHOW_DEDUCTION')),
  status text NOT NULL DEFAULT 'CONSUMED' CHECK (status IN ('CONSUMED', 'REFUNDED')),
  consumed_at timestamptz NOT NULL DEFAULT now(),
  consumed_by_user_id uuid DEFAULT auth.uid(),
  consumed_by_display_name text DEFAULT NULL,
  refunded_at timestamptz DEFAULT NULL,
  refunded_by_user_id uuid DEFAULT NULL,
  refunded_by_display_name text DEFAULT NULL,
  refund_reason text DEFAULT NULL,
  notes text DEFAULT NULL
);

-- Impedir que un mismo turno consuma más de una sesión activa simultáneamente
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_consumption_per_appointment
  ON public.client_membership_consumptions (appointment_id)
  WHERE appointment_id IS NOT NULL AND status = 'CONSUMED';

CREATE INDEX IF NOT EXISTS idx_client_membership_consumptions_membership
  ON public.client_membership_consumptions (membership_id, consumed_at DESC);

CREATE TABLE IF NOT EXISTS public.client_membership_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.client_memberships(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  description text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  actor_user_id uuid DEFAULT auth.uid(),
  actor_display_name text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_membership_events_membership
  ON public.client_membership_events (membership_id, created_at DESC);

ALTER TABLE public.client_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_membership_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_membership_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_membership_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.client_memberships FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.client_memberships TO authenticated;
GRANT ALL ON TABLE public.client_memberships TO service_role;

REVOKE ALL ON TABLE public.client_membership_items FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.client_membership_items TO authenticated;
GRANT ALL ON TABLE public.client_membership_items TO service_role;

REVOKE ALL ON TABLE public.client_membership_consumptions FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.client_membership_consumptions TO authenticated;
GRANT ALL ON TABLE public.client_membership_consumptions TO service_role;

REVOKE ALL ON TABLE public.client_membership_events FROM public, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.client_membership_events TO authenticated;
GRANT ALL ON TABLE public.client_membership_events TO service_role;

-- Políticas RLS para membresías (ADMIN/MANAGER acceso completo; BARBER estrictamente sus membresías propias)
DROP POLICY IF EXISTS "staff_read_client_memberships" ON public.client_memberships;
CREATE POLICY "staff_read_client_memberships"
  ON public.client_memberships
  FOR SELECT
  TO authenticated
  USING (
    coalesce(public.is_operator(), false)
    OR barber_id = public.current_staff_barber_id()
  );

DROP POLICY IF EXISTS "staff_manage_client_memberships" ON public.client_memberships;
CREATE POLICY "staff_manage_client_memberships"
  ON public.client_memberships
  FOR ALL
  TO authenticated
  USING (
    coalesce(public.is_operator(), false)
    OR barber_id = public.current_staff_barber_id()
  )
  WITH CHECK (
    coalesce(public.is_operator(), false)
    OR barber_id = public.current_staff_barber_id()
  );

DROP POLICY IF EXISTS "staff_read_client_membership_items" ON public.client_membership_items;
CREATE POLICY "staff_read_client_membership_items"
  ON public.client_membership_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_memberships m
      WHERE m.id = membership_id
        AND (
          coalesce(public.is_operator(), false)
          OR m.barber_id = public.current_staff_barber_id()
        )
    )
  );

DROP POLICY IF EXISTS "staff_manage_client_membership_items" ON public.client_membership_items;
CREATE POLICY "staff_manage_client_membership_items"
  ON public.client_membership_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_memberships m
      WHERE m.id = membership_id
        AND (coalesce(public.is_operator(), false) OR m.barber_id = public.current_staff_barber_id())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_memberships m
      WHERE m.id = membership_id
        AND (coalesce(public.is_operator(), false) OR m.barber_id = public.current_staff_barber_id())
    )
  );

DROP POLICY IF EXISTS "staff_read_client_membership_consumptions" ON public.client_membership_consumptions;
CREATE POLICY "staff_read_client_membership_consumptions"
  ON public.client_membership_consumptions
  FOR SELECT
  TO authenticated
  USING (
    coalesce(public.is_operator(), false)
    OR EXISTS (
      SELECT 1 FROM public.client_memberships m
      WHERE m.id = membership_id
        AND m.barber_id = public.current_staff_barber_id()
    )
  );

DROP POLICY IF EXISTS "staff_manage_client_membership_consumptions" ON public.client_membership_consumptions;
CREATE POLICY "staff_manage_client_membership_consumptions"
  ON public.client_membership_consumptions
  FOR ALL
  TO authenticated
  USING (
    coalesce(public.is_operator(), false)
    OR EXISTS (
      SELECT 1 FROM public.client_memberships m
      WHERE m.id = membership_id
        AND m.barber_id = public.current_staff_barber_id()
    )
  )
  WITH CHECK (
    coalesce(public.is_operator(), false)
    OR EXISTS (
      SELECT 1 FROM public.client_memberships m
      WHERE m.id = membership_id
        AND m.barber_id = public.current_staff_barber_id()
    )
  );

DROP POLICY IF EXISTS "staff_read_client_membership_events" ON public.client_membership_events;
CREATE POLICY "staff_read_client_membership_events"
  ON public.client_membership_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_memberships m
      WHERE m.id = membership_id
        AND (
          coalesce(public.is_operator(), false)
          OR m.barber_id = public.current_staff_barber_id()
        )
    )
  );

-- ==============================================================================
-- 4. TABLAS BASE E IDEMPOTENTES Y EXTENSIONES EN APPOINTMENTS / RECURRING_APPOINTMENT_RULES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.recurring_appointment_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  barber_id uuid NOT NULL REFERENCES public.barbers(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 7),
  start_time time NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  start_date date NOT NULL,
  end_date date,
  active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_display_name text NOT NULL DEFAULT 'Staff',
  time_zone text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Permitir day_of_week 0..7 (extract(dow) devuelve 0..6, extract(isodow) devuelve 1..7)
ALTER TABLE public.recurring_appointment_rules
  DROP CONSTRAINT IF EXISTS recurring_appointment_rules_day_of_week_check;
ALTER TABLE public.recurring_appointment_rules
  ADD CONSTRAINT recurring_appointment_rules_day_of_week_check CHECK (day_of_week BETWEEN 0 AND 7);

CREATE TABLE IF NOT EXISTS public.recurring_rule_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.recurring_appointment_rules(id) ON DELETE CASCADE,
  target_date date NOT NULL,
  conflict_reason text NOT NULL,
  conflicting_appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rule_id, target_date)
);

CREATE INDEX IF NOT EXISTS idx_recurring_rules_barber ON public.recurring_appointment_rules (barber_id, active);
CREATE INDEX IF NOT EXISTS idx_recurring_rules_client ON public.recurring_appointment_rules (client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_recurring_rule ON public.appointments (recurring_rule_id, booking_date);

ALTER TABLE public.recurring_appointment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_rule_conflicts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.recurring_appointment_rules FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recurring_appointment_rules TO authenticated;
GRANT ALL ON TABLE public.recurring_appointment_rules TO service_role;

REVOKE ALL ON TABLE public.recurring_rule_conflicts FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recurring_rule_conflicts TO authenticated;
GRANT ALL ON TABLE public.recurring_rule_conflicts TO service_role;

-- Asegurar FK opcional desde appointments.recurring_rule_id hacia recurring_appointment_rules(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'appointments_recurring_rule_id_fkey'
      AND table_name = 'appointments'
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_recurring_rule_id_fkey
      FOREIGN KEY (recurring_rule_id)
      REFERENCES public.recurring_appointment_rules(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

ALTER TABLE public.recurring_appointment_rules
  ADD COLUMN IF NOT EXISTS frequency_type text NOT NULL DEFAULT 'WEEKLY',
  ADD COLUMN IF NOT EXISTS end_type text NOT NULL DEFAULT 'NEVER',
  ADD COLUMN IF NOT EXISTS max_occurrences integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'CURRENT_RATE',
  ADD COLUMN IF NOT EXISTS fixed_price_ars integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_service_name text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS membership_id uuid REFERENCES public.client_memberships(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS excluded_dates date[] NOT NULL DEFAULT '{}'::date[],
  ADD COLUMN IF NOT EXISTS last_generated_until date DEFAULT NULL;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS membership_id uuid REFERENCES public.client_memberships(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS membership_consumption_id uuid REFERENCES public.client_membership_consumptions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pricing_mode text DEFAULT 'CURRENT_RATE',
  ADD COLUMN IF NOT EXISTS grouped_notification_sent_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS grouped_notification_claim_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reminder_claim_at timestamptz DEFAULT NULL;

-- Impedir la combinación simultánea de un código de beneficio y una membresía en el mismo turno
ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_incompatible_discount_combination_check;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_incompatible_discount_combination_check
  CHECK (NOT (membership_id IS NOT NULL AND benefit_code_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_appointments_membership_id
  ON public.appointments (membership_id)
  WHERE membership_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_reminder_pending
  ON public.appointments (booking_date, status)
  WHERE reminder_sent_at IS NULL AND status = 'CONFIRMED';

-- Políticas RLS para recurring_appointment_rules y recurring_rule_conflicts
DROP POLICY IF EXISTS "staff_can_read_recurring_rules" ON public.recurring_appointment_rules;
DROP POLICY IF EXISTS "operator_full_access_recurring_rules" ON public.recurring_appointment_rules;
CREATE POLICY "operator_full_access_recurring_rules"
  ON public.recurring_appointment_rules
  FOR ALL
  TO authenticated
  USING (coalesce(public.is_operator(), false) OR barber_id = public.current_staff_barber_id())
  WITH CHECK (coalesce(public.is_operator(), false) OR barber_id = public.current_staff_barber_id());

DROP POLICY IF EXISTS "staff_can_read_recurring_conflicts" ON public.recurring_rule_conflicts;
DROP POLICY IF EXISTS "operator_full_access_recurring_conflicts" ON public.recurring_rule_conflicts;
CREATE POLICY "operator_full_access_recurring_conflicts"
  ON public.recurring_rule_conflicts
  FOR ALL
  TO authenticated
  USING (
    coalesce(public.is_operator(), false)
    OR EXISTS (
      SELECT 1 FROM public.recurring_appointment_rules r
      WHERE r.id = recurring_rule_conflicts.rule_id
        AND r.barber_id = public.current_staff_barber_id()
    )
  )
  WITH CHECK (
    coalesce(public.is_operator(), false)
    OR EXISTS (
      SELECT 1 FROM public.recurring_appointment_rules r
      WHERE r.id = recurring_rule_conflicts.rule_id
        AND r.barber_id = public.current_staff_barber_id()
    )
  );

-- Trigger para registrar automáticamente en excluded_dates cualquier ocurrencia de una serie que pase a CANCELLED
CREATE OR REPLACE FUNCTION public.sync_cancelled_recurring_appointment_exclusion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'CANCELLED'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'CANCELLED')
     AND NEW.recurring_rule_id IS NOT NULL THEN
    UPDATE public.recurring_appointment_rules
    SET excluded_dates = array_append(array_remove(excluded_dates, NEW.booking_date), NEW.booking_date),
        updated_at = now()
    WHERE id = NEW.recurring_rule_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_cancelled_recurring_appointment_exclusion() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_cancelled_recurring_appointment_exclusion ON public.appointments;
CREATE TRIGGER trg_sync_cancelled_recurring_appointment_exclusion
  AFTER INSERT OR UPDATE OF status ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_cancelled_recurring_appointment_exclusion();

-- ==============================================================================
-- 5. RPCS DE GESTIÓN DE MEMBRESÍAS PREPAGADAS
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.create_client_membership(
  p_client_id uuid,
  p_barber_id uuid,
  p_package_size integer, -- 4 o 10
  p_items jsonb, -- [{"service_name": "Corte", "quantity": 4, "unit_price_ars": 25000}]
  p_payment_now boolean DEFAULT false,
  p_payment_method text DEFAULT 'Efectivo',
  p_expires_at date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_op boolean := coalesce(public.is_operator(), false);
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_actor_name text;
  v_client public.clients%ROWTYPE;
  v_discount_percent integer;
  v_plan_name text;
  v_item jsonb;
  v_srv_name text;
  v_qty integer;
  v_unit_price integer;
  v_service_id uuid;
  v_sum_qty integer := 0;
  v_subtotal_ars integer := 0;
  v_discount_ars integer := 0;
  v_total_ars integer := 0;
  v_membership public.client_memberships%ROWTYPE;
  v_payment_id uuid := NULL;
  v_target_barber_id uuid;
  v_method text := coalesce(nullif(trim(p_payment_method), ''), 'Efectivo');
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
  v_now_time time := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::time;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  v_target_barber_id := coalesce(p_barber_id, v_staff_barber_id);
  IF NOT v_is_op AND (v_staff_barber_id IS NULL OR v_target_barber_id IS DISTINCT FROM v_staff_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'MEMBERSHIP_FORBIDDEN_BARBER_SCOPE';
  END IF;

  IF p_payment_now AND v_method NOT IN (
    'Efectivo',
    'Transferencia',
    'Tarjeta — Payway',
    'Tarjeta de crédito',
    'Tarjeta de débito',
    'Payway',
    'Mercado Pago'
  ) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_PAYMENT_METHOD';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'CLIENT_NOT_FOUND';
  END IF;

  IF p_package_size = 4 THEN
    v_discount_percent := 10;
    v_plan_name := 'Membresía 4 servicios';
  ELSIF p_package_size = 10 THEN
    v_discount_percent := 15;
    v_plan_name := 'Membresía 10 servicios';
  ELSE
    RAISE EXCEPTION USING errcode = '22023', message = 'MEMBERSHIP_PACKAGE_SIZE_INVALID';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'MEMBERSHIP_ITEMS_REQUIRED';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_srv_name := trim(coalesce(v_item->>'service_name', ''));
    IF v_srv_name IN ('Corte + barba', 'Corte + Barba') THEN
      v_srv_name := 'Corte y barba';
    ELSIF v_srv_name = 'Corte de cabello' THEN
      v_srv_name := 'Corte';
    END IF;

    IF v_srv_name NOT IN ('Corte', 'Barba', 'Corte y barba') THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'MEMBERSHIP_SERVICE_NOT_ALLOWED';
    END IF;

    v_qty := coalesce((v_item->>'quantity')::integer, 0);
    IF v_qty < 0 THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'MEMBERSHIP_QUANTITY_INVALID';
    END IF;

    IF v_qty > 0 THEN
      SELECT s.id, coalesce((v_item->>'unit_price_ars')::integer, s.price_ars)
      INTO v_service_id, v_unit_price
      FROM public.services s
      WHERE s.name IN (
        v_srv_name,
        CASE WHEN v_srv_name = 'Corte y barba' THEN 'Corte + barba' WHEN v_srv_name = 'Corte' THEN 'Corte de cabello' ELSE v_srv_name END
      )
      ORDER BY s.active DESC
      LIMIT 1;

      v_unit_price := coalesce(v_unit_price, (v_item->>'unit_price_ars')::integer, 25000);
      IF v_unit_price <= 0 THEN
        RAISE EXCEPTION USING errcode = '22023', message = 'MEMBERSHIP_UNIT_PRICE_INVALID';
      END IF;
      v_sum_qty := v_sum_qty + v_qty;
      v_subtotal_ars := v_subtotal_ars + (v_unit_price * v_qty);
    END IF;
  END LOOP;

  IF v_sum_qty <> p_package_size THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'MEMBERSHIP_COMPOSITION_SUM_MISMATCH';
  END IF;

  v_discount_ars := round((v_subtotal_ars::numeric * v_discount_percent::numeric) / 100.0)::integer;
  v_total_ars := GREATEST(0, v_subtotal_ars - v_discount_ars);

  SELECT sp.display_name INTO v_actor_name
  FROM public.staff_profiles sp
  WHERE sp.user_id = v_uid AND sp.active = true
  LIMIT 1;
  v_actor_name := coalesce(v_actor_name, 'Staff');

  IF p_payment_now THEN
    IF v_target_barber_id IS NULL THEN
      SELECT id INTO v_target_barber_id FROM public.barbers WHERE active = true ORDER BY name LIMIT 1;
    END IF;

    INSERT INTO public.service_payments (
      barber_id,
      service_id,
      service_name,
      service_other_detail,
      service_price_ars,
      discount_ars,
      discount_kind,
      discount_value,
      final_amount_ars,
      payment_date,
      payment_time,
      payment_method,
      online_deposit_paid,
      online_deposit_amount_ars,
      collected_amount_ars,
      client_id,
      client_name,
      client_contact,
      appointment_id,
      service_origin,
      created_by_user_id,
      created_by_display_name
    ) VALUES (
      v_target_barber_id,
      NULL,
      'Otros',
      v_plan_name,
      v_subtotal_ars,
      v_discount_ars,
      'PERCENT',
      v_discount_percent,
      v_total_ars,
      v_today,
      v_now_time,
      v_method,
      false,
      0,
      v_total_ars,
      v_client.id,
      v_client.name,
      v_client.phone,
      NULL,
      'walk_in',
      v_uid,
      v_actor_name
    )
    RETURNING id INTO v_payment_id;
  END IF;

  INSERT INTO public.client_memberships (
    client_id,
    barber_id,
    plan_name,
    package_size,
    discount_percent,
    subtotal_ars,
    discount_amount_ars,
    total_price_ars,
    total_sessions,
    consumed_sessions,
    status,
    payment_method,
    payment_id,
    paid_at,
    expires_at,
    expires_updated_by,
    expires_updated_at,
    notes,
    created_by_user_id,
    created_by_display_name
  ) VALUES (
    v_client.id,
    v_target_barber_id,
    v_plan_name,
    p_package_size,
    v_discount_percent,
    v_subtotal_ars,
    v_discount_ars,
    v_total_ars,
    p_package_size,
    0,
    CASE WHEN p_payment_now THEN 'ACTIVE' ELSE 'PENDING_PAYMENT' END,
    CASE WHEN p_payment_now THEN v_method ELSE NULL END,
    v_payment_id,
    CASE WHEN p_payment_now THEN now() ELSE NULL END,
    p_expires_at,
    CASE WHEN p_expires_at IS NOT NULL THEN v_uid ELSE NULL END,
    CASE WHEN p_expires_at IS NOT NULL THEN now() ELSE NULL END,
    nullif(trim(coalesce(p_notes, '')), ''),
    v_uid,
    v_actor_name
  )
  RETURNING * INTO v_membership;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_srv_name := trim(coalesce(v_item->>'service_name', ''));
    IF v_srv_name IN ('Corte + barba', 'Corte + Barba') THEN
      v_srv_name := 'Corte y barba';
    ELSIF v_srv_name = 'Corte de cabello' THEN
      v_srv_name := 'Corte';
    END IF;
    v_qty := coalesce((v_item->>'quantity')::integer, 0);
    IF v_qty > 0 THEN
      SELECT s.id, coalesce((v_item->>'unit_price_ars')::integer, s.price_ars)
      INTO v_service_id, v_unit_price
      FROM public.services s
      WHERE s.name IN (
        v_srv_name,
        CASE WHEN v_srv_name = 'Corte y barba' THEN 'Corte + barba' WHEN v_srv_name = 'Corte' THEN 'Corte de cabello' ELSE v_srv_name END
      )
      ORDER BY s.active DESC
      LIMIT 1;

      v_unit_price := coalesce(v_unit_price, (v_item->>'unit_price_ars')::integer, 25000);

      INSERT INTO public.client_membership_items (
        membership_id,
        service_id,
        service_name,
        unit_price_snapshot_ars,
        total_quantity,
        consumed_quantity
      ) VALUES (
        v_membership.id,
        v_service_id,
        v_srv_name,
        v_unit_price,
        v_qty,
        0
      )
      ON CONFLICT (membership_id, service_name) DO UPDATE
      SET total_quantity = public.client_membership_items.total_quantity + EXCLUDED.total_quantity;
    END IF;
  END LOOP;

  INSERT INTO public.client_membership_events (
    membership_id, event_type, description, metadata, actor_user_id, actor_display_name
  ) VALUES (
    v_membership.id,
    'CREATED',
    CASE
      WHEN p_payment_now THEN format('%s creada y activada (%s).', v_plan_name, v_method)
      ELSE format('%s creada en estado Pendiente de pago.', v_plan_name)
    END,
    jsonb_build_object(
      'package_size', p_package_size,
      'subtotal_ars', v_subtotal_ars,
      'discount_amount_ars', v_discount_ars,
      'total_price_ars', v_total_ars,
      'payment_id', v_payment_id
    ),
    v_uid,
    v_actor_name
  );

  RETURN to_jsonb(v_membership);
END;
$$;

REVOKE ALL ON FUNCTION public.create_client_membership(uuid, uuid, integer, jsonb, boolean, text, date, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_client_membership(uuid, uuid, integer, jsonb, boolean, text, date, text) TO authenticated;

-- Registrar pago de una membresía pendiente
CREATE OR REPLACE FUNCTION public.register_membership_payment(
  p_membership_id uuid,
  p_payment_method text DEFAULT 'Efectivo',
  p_barber_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_op boolean := coalesce(public.is_operator(), false);
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_actor_name text;
  v_membership public.client_memberships%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_payment_id uuid;
  v_target_barber_id uuid;
  v_method text := coalesce(nullif(trim(p_payment_method), ''), 'Efectivo');
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
  v_now_time time := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::time;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF v_method NOT IN (
    'Efectivo',
    'Transferencia',
    'Tarjeta — Payway',
    'Tarjeta de crédito',
    'Tarjeta de débito',
    'Payway',
    'Mercado Pago'
  ) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_PAYMENT_METHOD';
  END IF;

  SELECT * INTO v_membership
  FROM public.client_memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'MEMBERSHIP_NOT_FOUND';
  END IF;

  IF NOT v_is_op AND (v_staff_barber_id IS NULL OR v_membership.barber_id IS DISTINCT FROM v_staff_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'MEMBERSHIP_FORBIDDEN';
  END IF;

  IF v_membership.status <> 'PENDING_PAYMENT' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'MEMBERSHIP_ALREADY_PAID_OR_CLOSED';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = v_membership.client_id;
  SELECT sp.display_name INTO v_actor_name FROM public.staff_profiles sp WHERE sp.user_id = v_uid AND sp.active = true LIMIT 1;
  v_actor_name := coalesce(v_actor_name, 'Staff');

  v_target_barber_id := coalesce(v_membership.barber_id, p_barber_id, v_staff_barber_id);
  IF v_target_barber_id IS NULL THEN
    SELECT id INTO v_target_barber_id FROM public.barbers WHERE active = true ORDER BY name LIMIT 1;
  END IF;

  INSERT INTO public.service_payments (
    barber_id,
    service_id,
    service_name,
    service_other_detail,
    service_price_ars,
    discount_ars,
    discount_kind,
    discount_value,
    final_amount_ars,
    payment_date,
    payment_time,
    payment_method,
    online_deposit_paid,
    online_deposit_amount_ars,
    collected_amount_ars,
    client_id,
    client_name,
    client_contact,
    appointment_id,
    service_origin,
    created_by_user_id,
    created_by_display_name
  ) VALUES (
    v_target_barber_id,
    NULL,
    'Otros',
    v_membership.plan_name,
    v_membership.subtotal_ars,
    v_membership.discount_amount_ars,
    'PERCENT',
    v_membership.discount_percent,
    v_membership.total_price_ars,
    v_today,
    v_now_time,
    v_method,
    false,
    0,
    v_membership.total_price_ars,
    v_client.id,
    v_client.name,
    v_client.phone,
    NULL,
    'walk_in',
    v_uid,
    v_actor_name
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.client_memberships
  SET status = CASE WHEN consumed_sessions >= total_sessions THEN 'EXHAUSTED' ELSE 'ACTIVE' END,
      payment_method = v_method,
      payment_id = v_payment_id,
      paid_at = now(),
      barber_id = coalesce(barber_id, v_target_barber_id),
      updated_at = now()
  WHERE id = v_membership.id
  RETURNING * INTO v_membership;

  INSERT INTO public.client_membership_events (
    membership_id, event_type, description, metadata, actor_user_id, actor_display_name
  ) VALUES (
    v_membership.id,
    'PAYMENT_REGISTERED',
    format('Pago total registrado (%s). Membresía activada.', v_membership.payment_method),
    jsonb_build_object('payment_id', v_payment_id, 'amount_ars', v_membership.total_price_ars),
    v_uid,
    v_actor_name
  );

  RETURN to_jsonb(v_membership);
END;
$$;

REVOKE ALL ON FUNCTION public.register_membership_payment(uuid, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.register_membership_payment(uuid, text, uuid) TO authenticated;

-- Consumir una sesión de membresía (por servicio realizado o inasistencia explícita)
CREATE OR REPLACE FUNCTION public.consume_membership_session(
  p_membership_id uuid,
  p_service_name text DEFAULT NULL,
  p_appointment_id uuid DEFAULT NULL,
  p_consumption_type text DEFAULT 'SERVICE_COMPLETED', -- 'SERVICE_COMPLETED' | 'NO_SHOW_DEDUCTION'
  p_barber_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_op boolean := coalesce(public.is_operator(), false);
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_actor_name text;
  v_membership public.client_memberships%ROWTYPE;
  v_item public.client_membership_items%ROWTYPE;
  v_consumption public.client_membership_consumptions%ROWTYPE;
  v_srv_name text := trim(coalesce(p_service_name, ''));
  v_type text := upper(trim(coalesce(p_consumption_type, 'SERVICE_COMPLETED')));
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
  v_apt public.appointments%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF v_type NOT IN ('SERVICE_COMPLETED', 'NO_SHOW_DEDUCTION') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CONSUMPTION_TYPE_INVALID';
  END IF;

  SELECT * INTO v_membership
  FROM public.client_memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'MEMBERSHIP_NOT_FOUND';
  END IF;

  -- Un barbero solo puede consumir sesiones de sus propias membresías asignadas
  IF NOT v_is_op AND (v_staff_barber_id IS NULL OR v_membership.barber_id IS DISTINCT FROM v_staff_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'MEMBERSHIP_FORBIDDEN';
  END IF;

  IF v_membership.status = 'PENDING_PAYMENT' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'MEMBERSHIP_PENDING_PAYMENT';
  END IF;

  IF v_membership.status IN ('CANCELLED', 'EXPIRED') OR (v_membership.expires_at IS NOT NULL AND v_membership.expires_at < v_today) THEN
    UPDATE public.client_memberships
    SET status = CASE WHEN v_membership.status = 'CANCELLED' THEN 'CANCELLED' ELSE 'EXPIRED' END,
        updated_at = now()
    WHERE id = v_membership.id;
    RAISE EXCEPTION USING errcode = '22023', message = 'MEMBERSHIP_NOT_ACTIVE_OR_EXPIRED';
  END IF;

  IF v_membership.consumed_sessions >= v_membership.total_sessions OR v_membership.status = 'EXHAUSTED' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'MEMBERSHIP_EXHAUSTED';
  END IF;

  IF p_appointment_id IS NOT NULL THEN
    SELECT * INTO v_apt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING errcode = 'P0002', message = 'APPOINTMENT_NOT_FOUND';
    END IF;
    IF NOT v_is_op AND v_apt.barber_id IS DISTINCT FROM v_staff_barber_id THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'APPOINTMENT_FORBIDDEN';
    END IF;
    IF v_apt.client_id IS DISTINCT FROM v_membership.client_id THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'MEMBERSHIP_CLIENT_MISMATCH';
    END IF;
    IF v_apt.benefit_code_id IS NOT NULL THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'INCOMPATIBLE_DISCOUNT_COMBINATION';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.client_membership_consumptions c
      WHERE c.appointment_id = p_appointment_id AND c.status = 'CONSUMED'
    ) THEN
      RAISE EXCEPTION USING errcode = '23505', message = 'APPOINTMENT_SESSION_ALREADY_CONSUMED';
    END IF;

    IF v_srv_name = '' THEN
      SELECT coalesce(v_apt.custom_service_name, s.name, 'Corte')
      INTO v_srv_name
      FROM public.services s
      WHERE s.id = v_apt.service_id;
    END IF;
  END IF;

  IF v_srv_name IN ('Corte + barba', 'Corte + Barba') THEN
    v_srv_name := 'Corte y barba';
  ELSIF v_srv_name = 'Corte de cabello' THEN
    v_srv_name := 'Corte';
  END IF;

  -- Respeto estricto de la cantidad contratada por cada servicio
  IF v_srv_name <> '' THEN
    SELECT * INTO v_item
    FROM public.client_membership_items
    WHERE membership_id = v_membership.id
      AND service_name = v_srv_name
      AND consumed_quantity < total_quantity
    FOR UPDATE
    LIMIT 1;
  ELSE
    SELECT * INTO v_item
    FROM public.client_membership_items
    WHERE membership_id = v_membership.id
      AND consumed_quantity < total_quantity
    ORDER BY created_at ASC
    FOR UPDATE
    LIMIT 1;
  END IF;

  IF v_item.id IS NULL THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'MEMBERSHIP_ITEM_EXHAUSTED';
  END IF;

  SELECT sp.display_name INTO v_actor_name FROM public.staff_profiles sp WHERE sp.user_id = v_uid AND sp.active = true LIMIT 1;
  v_actor_name := coalesce(v_actor_name, 'Staff');

  UPDATE public.client_membership_items
  SET consumed_quantity = consumed_quantity + 1
  WHERE id = v_item.id
  RETURNING * INTO v_item;

  INSERT INTO public.client_membership_consumptions (
    membership_id,
    item_id,
    client_id,
    appointment_id,
    barber_id,
    service_id,
    service_name,
    consumption_type,
    status,
    consumed_at,
    consumed_by_user_id,
    consumed_by_display_name,
    notes
  ) VALUES (
    v_membership.id,
    v_item.id,
    v_membership.client_id,
    p_appointment_id,
    coalesce(v_apt.barber_id, v_membership.barber_id, p_barber_id, v_staff_barber_id),
    v_item.service_id,
    v_item.service_name,
    v_type,
    'CONSUMED',
    now(),
    v_uid,
    v_actor_name,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  RETURNING * INTO v_consumption;

  UPDATE public.client_memberships
  SET consumed_sessions = consumed_sessions + 1,
      status = CASE WHEN consumed_sessions + 1 >= total_sessions THEN 'EXHAUSTED' ELSE status END,
      updated_at = now()
  WHERE id = v_membership.id
  RETURNING * INTO v_membership;

  IF p_appointment_id IS NOT NULL THEN
    -- En PostgreSQL productivo, public.appointment_status es ENUM('PENDING','CONFIRMED','CANCELLED','COMPLETED').
    -- Para NO_SHOW_DEDUCTION se marca COMPLETED con saldo cubierto por membresía (sin ingreso duplicado en service_payments)
    -- y trazabilidad exacta en client_membership_consumptions.consumption_type = 'NO_SHOW_DEDUCTION'.
    UPDATE public.appointments
    SET membership_id = v_membership.id,
        membership_consumption_id = v_consumption.id,
        service_price_ars = 0,
        balance_paid = true,
        status = 'COMPLETED'::public.appointment_status,
        updated_at = now()
    WHERE id = p_appointment_id;
  END IF;

  INSERT INTO public.client_membership_events (
    membership_id, event_type, description, metadata, actor_user_id, actor_display_name
  ) VALUES (
    v_membership.id,
    'SESSION_CONSUMED',
    format(
      'Sesión consumida (%s — %s). Restantes: %s de %s.',
      v_item.service_name,
      CASE WHEN v_type = 'NO_SHOW_DEDUCTION' THEN 'Inasistencia descontada' ELSE 'Servicio realizado' END,
      v_membership.total_sessions - v_membership.consumed_sessions,
      v_membership.total_sessions
    ),
    jsonb_build_object(
      'consumption_id', v_consumption.id,
      'appointment_id', p_appointment_id,
      'service_name', v_item.service_name,
      'consumption_type', v_type,
      'remaining_sessions', v_membership.total_sessions - v_membership.consumed_sessions
    ),
    v_uid,
    v_actor_name
  );

  RETURN jsonb_build_object(
    'membership', to_jsonb(v_membership),
    'consumption', to_jsonb(v_consumption),
    'remaining_sessions', v_membership.total_sessions - v_membership.consumed_sessions,
    'is_exhausted', (v_membership.status = 'EXHAUSTED')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_membership_session(uuid, text, uuid, text, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consume_membership_session(uuid, text, uuid, text, uuid, text) TO authenticated;

-- Reintegrar una sesión consumida
CREATE OR REPLACE FUNCTION public.refund_membership_session(
  p_consumption_id uuid DEFAULT NULL,
  p_appointment_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_op boolean := coalesce(public.is_operator(), false);
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_actor_name text;
  v_consumption public.client_membership_consumptions%ROWTYPE;
  v_membership public.client_memberships%ROWTYPE;
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF p_consumption_id IS NOT NULL THEN
    SELECT * INTO v_consumption
    FROM public.client_membership_consumptions
    WHERE id = p_consumption_id
    FOR UPDATE;
  ELSIF p_appointment_id IS NOT NULL THEN
    SELECT * INTO v_consumption
    FROM public.client_membership_consumptions
    WHERE appointment_id = p_appointment_id AND status = 'CONSUMED'
    ORDER BY consumed_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_consumption.id IS NULL THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'CONSUMPTION_NOT_FOUND';
  END IF;

  IF v_consumption.status = 'REFUNDED' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CONSUMPTION_ALREADY_REFUNDED';
  END IF;

  SELECT * INTO v_membership
  FROM public.client_memberships
  WHERE id = v_consumption.membership_id
  FOR UPDATE;

  IF NOT v_is_op AND (v_staff_barber_id IS NULL OR v_membership.barber_id IS DISTINCT FROM v_staff_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'MEMBERSHIP_FORBIDDEN';
  END IF;

  SELECT sp.display_name INTO v_actor_name FROM public.staff_profiles sp WHERE sp.user_id = v_uid AND sp.active = true LIMIT 1;
  v_actor_name := coalesce(v_actor_name, 'Staff');

  UPDATE public.client_membership_consumptions
  SET status = 'REFUNDED',
      refunded_at = now(),
      refunded_by_user_id = v_uid,
      refunded_by_display_name = v_actor_name,
      refund_reason = nullif(trim(coalesce(p_reason, '')), '')
  WHERE id = v_consumption.id
  RETURNING * INTO v_consumption;

  UPDATE public.client_membership_items
  SET consumed_quantity = GREATEST(0, consumed_quantity - 1)
  WHERE id = v_consumption.item_id;

  UPDATE public.client_memberships
  SET consumed_sessions = GREATEST(0, consumed_sessions - 1),
      status = CASE
        WHEN status = 'EXHAUSTED' AND (expires_at IS NULL OR expires_at >= v_today) THEN 'ACTIVE'
        ELSE status
      END,
      updated_at = now()
  WHERE id = v_membership.id
  RETURNING * INTO v_membership;

  IF v_consumption.appointment_id IS NOT NULL THEN
    UPDATE public.appointments
    SET membership_consumption_id = NULL,
        updated_at = now()
    WHERE id = v_consumption.appointment_id;
  END IF;

  INSERT INTO public.client_membership_events (
    membership_id, event_type, description, metadata, actor_user_id, actor_display_name
  ) VALUES (
    v_membership.id,
    'SESSION_REFUNDED',
    format(
      'Sesión reintegrada (%s). Sesiones disponibles: %s de %s.',
      v_consumption.service_name,
      v_membership.total_sessions - v_membership.consumed_sessions,
      v_membership.total_sessions
    ),
    jsonb_build_object(
      'consumption_id', v_consumption.id,
      'appointment_id', v_consumption.appointment_id,
      'reason', p_reason,
      'remaining_sessions', v_membership.total_sessions - v_membership.consumed_sessions
    ),
    v_uid,
    v_actor_name
  );

  RETURN jsonb_build_object(
    'membership', to_jsonb(v_membership),
    'consumption', to_jsonb(v_consumption),
    'remaining_sessions', v_membership.total_sessions - v_membership.consumed_sessions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refund_membership_session(uuid, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.refund_membership_session(uuid, uuid, text) TO authenticated;

-- Actualizar vencimiento o estado de membresía con auditoría
CREATE OR REPLACE FUNCTION public.update_client_membership(
  p_membership_id uuid,
  p_expires_at date DEFAULT NULL,
  p_clear_expiration boolean DEFAULT false,
  p_status text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_op boolean := coalesce(public.is_operator(), false);
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_actor_name text;
  v_membership public.client_memberships%ROWTYPE;
  v_new_expires date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO v_membership
  FROM public.client_memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'MEMBERSHIP_NOT_FOUND';
  END IF;

  IF NOT v_is_op AND (v_staff_barber_id IS NULL OR v_membership.barber_id IS DISTINCT FROM v_staff_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'MEMBERSHIP_FORBIDDEN';
  END IF;

  SELECT sp.display_name INTO v_actor_name FROM public.staff_profiles sp WHERE sp.user_id = v_uid AND sp.active = true LIMIT 1;
  v_actor_name := coalesce(v_actor_name, 'Staff');

  v_new_expires := CASE WHEN p_clear_expiration THEN NULL ELSE coalesce(p_expires_at, v_membership.expires_at) END;

  UPDATE public.client_memberships
  SET expires_at = v_new_expires,
      expires_updated_by = CASE WHEN v_new_expires IS DISTINCT FROM v_membership.expires_at THEN v_uid ELSE expires_updated_by END,
      expires_updated_at = CASE WHEN v_new_expires IS DISTINCT FROM v_membership.expires_at THEN now() ELSE expires_updated_at END,
      status = coalesce(nullif(upper(trim(coalesce(p_status, ''))), ''), status),
      notes = coalesce(nullif(trim(coalesce(p_notes, '')), ''), notes),
      updated_at = now()
  WHERE id = v_membership.id
  RETURNING * INTO v_membership;

  INSERT INTO public.client_membership_events (
    membership_id, event_type, description, metadata, actor_user_id, actor_display_name
  ) VALUES (
    v_membership.id,
    'UPDATED',
    format(
      'Membresía actualizada por %s. Vencimiento: %s. Estado: %s.',
      v_actor_name,
      coalesce(v_membership.expires_at::text, 'Sin vencimiento'),
      v_membership.status
    ),
    jsonb_build_object(
      'expires_at', v_membership.expires_at,
      'status', v_membership.status
    ),
    v_uid,
    v_actor_name
  );

  RETURN to_jsonb(v_membership);
END;
$$;

REVOKE ALL ON FUNCTION public.update_client_membership(uuid, date, boolean, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_client_membership(uuid, date, boolean, text, text) TO authenticated;

-- ==============================================================================
-- 6. TURNOS MANUALES RECURRENTES Y VENTANA MÓVIL DE 90 DÍAS (FASE 4, 5, 11, 12)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.sync_recurring_appointment_rules(
  p_horizon_days integer DEFAULT 90,
  p_rule_id uuid DEFAULT NULL
)
RETURNS TABLE (
  rule_id uuid,
  generated_appointments integer,
  recorded_conflicts integer,
  created_appointment_ids uuid[],
  omitted_dates date[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
  v_horizon_end date := v_today + GREATEST(1, LEAST(coalesce(p_horizon_days, 90), 365));
  v_is_service_role boolean := (
    current_setting('role', true) = 'service_role'
    OR coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR coalesce((SELECT auth.role()), '') = 'service_role'
  );
  v_is_op boolean := coalesce(public.is_operator(), false);
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_rule public.recurring_appointment_rules%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_target_date date;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_end_time time;
  v_conflict_apt_id uuid;
  v_generated integer;
  v_conflicts integer;
  v_created_ids uuid[];
  v_omitted date[];
  v_new_apt_id uuid;
  v_effective_price integer;
BEGIN
  IF NOT v_is_service_role AND NOT v_is_op AND v_staff_barber_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  FOR v_rule IN
    SELECT r.*
    FROM public.recurring_appointment_rules r
    JOIN public.barbers b ON b.id = r.barber_id AND b.active = true
    WHERE r.active = true
      AND (p_rule_id IS NULL OR r.id = p_rule_id)
      AND (r.end_date IS NULL OR r.end_date >= v_today)
      AND (v_is_service_role OR v_is_op OR r.barber_id = v_staff_barber_id)
  LOOP
    v_generated := 0;
    v_conflicts := 0;
    v_created_ids := '{}'::uuid[];
    v_omitted := '{}'::date[];

    SELECT s.* INTO v_service
    FROM public.services s
    WHERE s.id = v_rule.service_id;

    SELECT c.* INTO v_client
    FROM public.clients c
    WHERE c.id = v_rule.client_id;

    v_end_time := (v_rule.start_time + (v_rule.duration_minutes * interval '1 minute'))::time;

    IF v_rule.membership_id IS NOT NULL THEN
      -- Cubierto por membresía prepagada: no generar cobro independiente por turno
      v_effective_price := 0;
    ELSIF v_rule.pricing_mode = 'FIXED_PRICE' AND v_rule.fixed_price_ars IS NOT NULL THEN
      v_effective_price := v_rule.fixed_price_ars;
    ELSE
      v_effective_price := coalesce(
        (SELECT bsp.price_ars FROM public.barber_service_prices bsp WHERE bsp.barber_id = v_rule.barber_id AND bsp.service_id = v_rule.service_id AND bsp.active = true LIMIT 1),
        v_service.price_ars,
        v_rule.fixed_price_ars,
        0
      );
    END IF;

    FOR v_target_date IN
      SELECT occ_date
      FROM public.generate_recurrence_dates(
        v_rule.start_date,
        v_rule.frequency_type,
        v_rule.end_type,
        v_rule.end_date,
        v_rule.max_occurrences,
        GREATEST(v_today, v_rule.start_date),
        v_horizon_end,
        v_rule.excluded_dates
      ) AS occ_date
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(v_rule.barber_id::text || '|' || v_target_date::text, 0));

      -- Si ya existe un turno de esta misma regla en esta fecha (incluyendo cancelados), continuar idempotentemente
      IF EXISTS (
        SELECT 1
        FROM public.appointments a
        WHERE a.recurring_rule_id = v_rule.id
          AND a.booking_date = v_target_date
      ) THEN
        CONTINUE;
      END IF;

      -- Si la fecha ya fue omitida previamente por conflicto, se mantiene la excepción (FASE 5)
      IF EXISTS (
        SELECT 1
        FROM public.recurring_rule_conflicts rc
        WHERE rc.rule_id = v_rule.id
          AND rc.target_date = v_target_date
      ) THEN
        CONTINUE;
      END IF;

      v_start_ts := (v_target_date + v_rule.start_time)::timestamp;
      v_end_ts := v_start_ts + (v_rule.duration_minutes * interval '1 minute');

      -- Verificar si existe un turno activo que se solape
      SELECT a.id INTO v_conflict_apt_id
      FROM public.appointments a
      WHERE a.barber_id = v_rule.barber_id
        AND a.booking_date = v_target_date
        AND a.status <> 'CANCELLED'
        AND tsrange(
          (a.booking_date + a.start_time)::timestamp,
          ((a.booking_date + CASE WHEN a.end_time <= a.start_time THEN 1 ELSE 0 END) + a.end_time)::timestamp,
          '[)'
        ) && tsrange(v_start_ts, v_end_ts, '[)')
      ORDER BY a.start_time
      LIMIT 1;

      IF v_conflict_apt_id IS NOT NULL THEN
        INSERT INTO public.recurring_rule_conflicts (
          rule_id, target_date, conflict_reason, conflicting_appointment_id, resolved
        ) VALUES (
          v_rule.id, v_target_date, 'EXISTING_APPOINTMENT_OVERLAP', v_conflict_apt_id, false
        )
        ON CONFLICT (rule_id, target_date) DO UPDATE
        SET conflict_reason = EXCLUDED.conflict_reason,
            conflicting_appointment_id = EXCLUDED.conflicting_appointment_id;

        -- Persistir como fecha excluida para que si luego se cancela el turno en conflicto no se cree automáticamente
        UPDATE public.recurring_appointment_rules
        SET excluded_dates = array_append(array_remove(excluded_dates, v_target_date), v_target_date),
            updated_at = now()
        WHERE id = v_rule.id;

        v_conflicts := v_conflicts + 1;
        v_omitted := array_append(v_omitted, v_target_date);
        CONTINUE;
      END IF;

      INSERT INTO public.appointments (
        client_id,
        barber_id,
        service_id,
        custom_service_name,
        service_price_ars,
        booking_date,
        start_time,
        end_time,
        status,
        notes,
        booking_client_name,
        is_manual,
        origin,
        created_by_user_id,
        created_by_display_name,
        recurring_rule_id,
        membership_id,
        pricing_mode,
        deposit_required,
        deposit_paid,
        deposit_amount_ars,
        balance_paid
      ) VALUES (
        v_rule.client_id,
        v_rule.barber_id,
        v_rule.service_id,
        v_rule.custom_service_name,
        v_effective_price,
        v_target_date,
        v_rule.start_time,
        v_end_time,
        'CONFIRMED',
        v_rule.notes,
        v_client.name,
        true,
        'MANUAL',
        v_rule.created_by_user_id,
        v_rule.created_by_display_name,
        v_rule.id,
        v_rule.membership_id,
        v_rule.pricing_mode,
        false,
        false,
        0,
        (v_rule.membership_id IS NOT NULL)
      )
      RETURNING id INTO v_new_apt_id;

      v_generated := v_generated + 1;
      v_created_ids := array_append(v_created_ids, v_new_apt_id);
    END LOOP;

    UPDATE public.recurring_appointment_rules
    SET last_generated_until = v_horizon_end,
        updated_at = now()
    WHERE id = v_rule.id;

    rule_id := v_rule.id;
    generated_appointments := v_generated;
    recorded_conflicts := v_conflicts;
    created_appointment_ids := v_created_ids;
    omitted_dates := v_omitted;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_recurring_appointment_rules(integer, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sync_recurring_appointment_rules(integer, uuid) TO authenticated, service_role;

-- Crear serie de turnos manuales recurrentes con manejo de conflictos parciales (FASE 4 y 5)
CREATE OR REPLACE FUNCTION public.create_recurring_manual_series(
  p_barber_id uuid,
  p_service_id uuid DEFAULT NULL,
  p_custom_service_name text DEFAULT NULL,
  p_service_price_ars integer DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_start_time time DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL,
  p_client_name text DEFAULT NULL,
  p_client_phone text DEFAULT NULL,
  p_client_email text DEFAULT NULL,
  p_client_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_frequency_type text DEFAULT 'WEEKLY', -- 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'
  p_end_type text DEFAULT 'NEVER', -- 'NEVER' | 'UNTIL_DATE' | 'AFTER_COUNT'
  p_end_date date DEFAULT NULL,
  p_max_occurrences integer DEFAULT NULL,
  p_pricing_mode text DEFAULT 'CURRENT_RATE', -- 'CURRENT_RATE' | 'FIXED_PRICE'
  p_membership_id uuid DEFAULT NULL,
  p_horizon_days integer DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_op boolean := coalesce(public.is_operator(), false);
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_actor_name text;
  v_barber public.barbers%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_membership public.client_memberships%ROWTYPE;
  v_client_id uuid;
  v_clean_name text := trim(coalesce(p_client_name, ''));
  v_clean_phone text := trim(coalesce(p_client_phone, ''));
  v_clean_email text := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  v_duration_min integer;
  v_freq text := upper(trim(coalesce(p_frequency_type, 'WEEKLY')));
  v_end_type text := upper(trim(coalesce(p_end_type, 'NEVER')));
  v_pricing text := upper(trim(coalesce(p_pricing_mode, 'CURRENT_RATE')));
  v_rule public.recurring_appointment_rules%ROWTYPE;
  v_sync record;
  v_conflicts_json jsonb := '[]'::jsonb;
  v_created_json jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_op AND (v_staff_barber_id IS NULL OR v_staff_barber_id IS DISTINCT FROM p_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
  END IF;

  SELECT * INTO v_barber FROM public.barbers WHERE id = p_barber_id AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'BARBER_NOT_FOUND';
  END IF;

  IF p_service_id IS NOT NULL THEN
    SELECT * INTO v_service FROM public.services WHERE id = p_service_id;
  ELSE
    SELECT * INTO v_service FROM public.services WHERE active = true ORDER BY name LIMIT 1;
  END IF;

  v_duration_min := coalesce(p_duration_minutes, v_service.duration_minutes, 45);

  IF p_client_id IS NOT NULL THEN
    SELECT id INTO v_client_id FROM public.clients WHERE id = p_client_id;
  END IF;

  IF v_client_id IS NULL THEN
    SELECT id INTO v_client_id
    FROM public.clients c
    WHERE regexp_replace(c.phone, '[^0-9]', '', 'g') = regexp_replace(v_clean_phone, '[^0-9]', '', 'g')
    ORDER BY c.deleted_at NULLS FIRST, c.created_at ASC
    LIMIT 1;
  END IF;

  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (name, phone, email)
    VALUES (v_clean_name, v_clean_phone, v_clean_email)
    RETURNING id INTO v_client_id;
  ELSE
    UPDATE public.clients
    SET name = coalesce(nullif(v_clean_name, ''), name),
        phone = coalesce(nullif(v_clean_phone, ''), phone),
        email = coalesce(v_clean_email, email),
        deleted_at = NULL,
        updated_at = now()
    WHERE id = v_client_id;
  END IF;

  -- Si se vincula membresía, validar que pertenezca al mismo cliente y esté activa
  IF p_membership_id IS NOT NULL THEN
    SELECT * INTO v_membership FROM public.client_memberships WHERE id = p_membership_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING errcode = 'P0002', message = 'MEMBERSHIP_NOT_FOUND';
    END IF;
    IF v_membership.client_id IS DISTINCT FROM v_client_id THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'MEMBERSHIP_CLIENT_MISMATCH';
    END IF;
    IF v_membership.status <> 'ACTIVE' THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'MEMBERSHIP_NOT_ACTIVE';
    END IF;
  END IF;

  SELECT sp.display_name INTO v_actor_name FROM public.staff_profiles sp WHERE sp.user_id = v_uid AND sp.active = true LIMIT 1;
  v_actor_name := coalesce(v_actor_name, 'Staff');

  INSERT INTO public.recurring_appointment_rules (
    client_id,
    barber_id,
    service_id,
    custom_service_name,
    day_of_week,
    start_time,
    duration_minutes,
    start_date,
    end_date,
    frequency_type,
    end_type,
    max_occurrences,
    pricing_mode,
    fixed_price_ars,
    membership_id,
    active,
    created_by_user_id,
    created_by_display_name,
    notes
  ) VALUES (
    v_client_id,
    p_barber_id,
    v_service.id,
    nullif(trim(coalesce(p_custom_service_name, '')), ''),
    extract(isodow from p_start_date)::smallint,
    p_start_time,
    v_duration_min,
    p_start_date,
    CASE WHEN v_end_type = 'UNTIL_DATE' THEN p_end_date ELSE NULL END,
    v_freq,
    v_end_type,
    CASE WHEN v_end_type = 'AFTER_COUNT' THEN p_max_occurrences ELSE NULL END,
    v_pricing,
    p_service_price_ars,
    p_membership_id,
    true,
    v_uid,
    v_actor_name,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  RETURNING * INTO v_rule;

  SELECT * INTO v_sync
  FROM public.sync_recurring_appointment_rules(coalesce(p_horizon_days, 90), v_rule.id)
  LIMIT 1;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'booking_date', a.booking_date,
    'start_time', to_char(a.start_time, 'HH24:MI'),
    'end_time', to_char(a.end_time, 'HH24:MI'),
    'service_price_ars', a.service_price_ars
  ) ORDER BY a.booking_date ASC), '[]'::jsonb)
  INTO v_created_json
  FROM public.appointments a
  WHERE a.id = ANY(coalesce(v_sync.created_appointment_ids, '{}'::uuid[]));

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'target_date', rc.target_date,
    'start_time', to_char(v_rule.start_time, 'HH24:MI'),
    'conflict_reason', rc.conflict_reason,
    'conflicting_appointment_id', rc.conflicting_appointment_id,
    'conflicting_client_name', CASE
      WHEN v_is_op OR ca.barber_id = v_staff_barber_id THEN coalesce(ca.booking_client_name, cc.name, 'Turno ocupado')
      ELSE NULL
    END
  ) ORDER BY rc.target_date ASC), '[]'::jsonb)
  INTO v_conflicts_json
  FROM public.recurring_rule_conflicts rc
  LEFT JOIN public.appointments ca ON ca.id = rc.conflicting_appointment_id
  LEFT JOIN public.clients cc ON cc.id = ca.client_id
  WHERE rc.rule_id = v_rule.id;

  RETURN jsonb_build_object(
    'rule_id', v_rule.id,
    'created_count', coalesce(v_sync.generated_appointments, 0),
    'omitted_count', coalesce(v_sync.recorded_conflicts, 0),
    'created_appointments', v_created_json,
    'omitted_conflicts', v_conflicts_json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_recurring_manual_series(uuid, uuid, text, integer, date, time, integer, text, text, text, uuid, text, text, text, date, integer, text, uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_recurring_manual_series(uuid, uuid, text, integer, date, time, integer, text, text, text, uuid, text, text, text, date, integer, text, uuid, integer) TO authenticated;

-- Modificar o cancelar serie de turnos recurrentes por alcance (FASE 11)
-- Verifica solapamientos en UPDATE y preserva turnos con pagos registrados en CANCEL masivo
CREATE OR REPLACE FUNCTION public.modify_recurring_appointment_series(
  p_appointment_id uuid,
  p_scope text, -- 'SINGLE' | 'THIS_AND_FOLLOWING' | 'ALL_FUTURE'
  p_action text, -- 'CANCEL' | 'UPDATE'
  p_new_start_time time DEFAULT NULL,
  p_new_service_id uuid DEFAULT NULL,
  p_new_price_ars integer DEFAULT NULL,
  p_new_pricing_mode text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_op boolean := coalesce(public.is_operator(), false);
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_apt public.appointments%ROWTYPE;
  v_rule public.recurring_appointment_rules%ROWTYPE;
  v_scope text := upper(trim(coalesce(p_scope, 'SINGLE')));
  v_action text := upper(trim(coalesce(p_action, 'CANCEL')));
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
  v_affected_ids uuid[] := '{}'::uuid[];
  v_affected_dates date[] := '{}'::date[];
  v_preserved_paid_ids uuid[] := '{}'::uuid[];
  v_target record;
  v_new_end_time time;
  v_duration_min integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO v_apt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'APPOINTMENT_NOT_FOUND';
  END IF;

  IF NOT v_is_op AND (v_staff_barber_id IS NULL OR v_apt.barber_id IS DISTINCT FROM v_staff_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'APPOINTMENT_FORBIDDEN';
  END IF;

  IF v_apt.recurring_rule_id IS NOT NULL THEN
    SELECT * INTO v_rule FROM public.recurring_appointment_rules WHERE id = v_apt.recurring_rule_id FOR UPDATE;
  END IF;

  v_duration_min := coalesce(v_rule.duration_minutes, 45);

  IF v_scope = 'SINGLE' OR v_rule.id IS NULL THEN
    IF v_rule.id IS NOT NULL THEN
      UPDATE public.recurring_appointment_rules
      SET excluded_dates = array_append(array_remove(excluded_dates, v_apt.booking_date), v_apt.booking_date),
          updated_at = now()
      WHERE id = v_rule.id;
    END IF;

    IF v_action = 'CANCEL' THEN
      UPDATE public.appointments
      SET status = 'CANCELLED',
          updated_at = now()
      WHERE id = v_apt.id;
    ELSE
      IF p_new_start_time IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(v_apt.barber_id::text || '|' || v_apt.booking_date::text, 0));
        v_new_end_time := (p_new_start_time + (v_duration_min * interval '1 minute'))::time;
        IF EXISTS (
          SELECT 1
          FROM public.appointments other
          WHERE other.barber_id = v_apt.barber_id
            AND other.booking_date = v_apt.booking_date
            AND other.id <> v_apt.id
            AND other.status <> 'CANCELLED'
            AND tsrange(
              (other.booking_date + other.start_time)::timestamp,
              ((other.booking_date + CASE WHEN other.end_time <= other.start_time THEN 1 ELSE 0 END) + other.end_time)::timestamp,
              '[)'
            ) && tsrange(
              (v_apt.booking_date + p_new_start_time)::timestamp,
              ((v_apt.booking_date + CASE WHEN v_new_end_time <= p_new_start_time THEN 1 ELSE 0 END) + v_new_end_time)::timestamp,
              '[)'
            )
        ) THEN
          RAISE EXCEPTION USING errcode = '23P01', message = 'APPOINTMENT_COLLISION_DETAILS';
        END IF;
      END IF;

      UPDATE public.appointments
      SET start_time = coalesce(p_new_start_time, start_time),
          end_time = CASE
            WHEN p_new_start_time IS NOT NULL THEN (p_new_start_time + (v_duration_min * interval '1 minute'))::time
            ELSE end_time
          END,
          service_id = coalesce(p_new_service_id, service_id),
          service_price_ars = coalesce(p_new_price_ars, service_price_ars),
          pricing_mode = coalesce(p_new_pricing_mode, pricing_mode),
          notes = coalesce(p_notes, notes),
          updated_at = now()
      WHERE id = v_apt.id;
    END IF;

    v_affected_ids := ARRAY[v_apt.id];
    v_affected_dates := ARRAY[v_apt.booking_date];

  ELSIF v_scope IN ('THIS_AND_FOLLOWING', 'ALL_FUTURE') THEN
    FOR v_target IN
      SELECT a.*
      FROM public.appointments a
      WHERE a.recurring_rule_id = v_rule.id
        AND a.booking_date >= CASE
          WHEN v_scope = 'THIS_AND_FOLLOWING' THEN GREATEST(v_apt.booking_date, v_today)
          ELSE v_today
        END
        AND a.status IN ('PENDING', 'CONFIRMED')
      ORDER BY a.booking_date ASC
      FOR UPDATE
    LOOP
      IF v_action = 'CANCEL' THEN
        -- Preservar turnos que ya registran pagos efectivos o señas abonadas o consumos de membresía
        IF coalesce(v_target.deposit_paid, false)
           OR v_target.membership_consumption_id IS NOT NULL
           OR EXISTS (
             SELECT 1
             FROM public.service_payments sp
             WHERE sp.appointment_id = v_target.id
               AND sp.deleted_at IS NULL
               AND sp.service_name <> 'Anulado'
           ) THEN
          v_preserved_paid_ids := array_append(v_preserved_paid_ids, v_target.id);
          CONTINUE;
        END IF;

        UPDATE public.appointments
        SET status = 'CANCELLED',
            updated_at = now()
        WHERE id = v_target.id;

        v_affected_ids := array_append(v_affected_ids, v_target.id);
        v_affected_dates := array_append(v_affected_dates, v_target.booking_date);
      ELSE
        -- Acción UPDATE sobre la serie: verificar que el nuevo horario no colisione en esa fecha
        IF p_new_start_time IS NOT NULL THEN
          PERFORM pg_advisory_xact_lock(hashtextextended(v_target.barber_id::text || '|' || v_target.booking_date::text, 0));
          v_new_end_time := (p_new_start_time + (v_duration_min * interval '1 minute'))::time;
          IF EXISTS (
            SELECT 1
            FROM public.appointments other
            WHERE other.barber_id = v_target.barber_id
              AND other.booking_date = v_target.booking_date
              AND other.id <> v_target.id
              AND other.status <> 'CANCELLED'
              AND tsrange(
                (other.booking_date + other.start_time)::timestamp,
                ((other.booking_date + CASE WHEN other.end_time <= other.start_time THEN 1 ELSE 0 END) + other.end_time)::timestamp,
                '[)'
              ) && tsrange(
                (v_target.booking_date + p_new_start_time)::timestamp,
                ((v_target.booking_date + CASE WHEN v_new_end_time <= p_new_start_time THEN 1 ELSE 0 END) + v_new_end_time)::timestamp,
                '[)'
              )
          ) THEN
            -- Si la fecha objetivo ya está ocupada en el nuevo horario, se preserva sin pisar el turno existente
            CONTINUE;
          END IF;
        END IF;

        UPDATE public.appointments
        SET start_time = coalesce(p_new_start_time, start_time),
            end_time = CASE
              WHEN p_new_start_time IS NOT NULL THEN (p_new_start_time + (v_duration_min * interval '1 minute'))::time
              ELSE end_time
            END,
            service_id = coalesce(p_new_service_id, service_id),
            service_price_ars = coalesce(p_new_price_ars, service_price_ars),
            pricing_mode = coalesce(p_new_pricing_mode, pricing_mode),
            notes = coalesce(p_notes, notes),
            updated_at = now()
        WHERE id = v_target.id;

        v_affected_ids := array_append(v_affected_ids, v_target.id);
        v_affected_dates := array_append(v_affected_dates, v_target.booking_date);
      END IF;
    END LOOP;

    IF v_action = 'CANCEL' THEN
      IF v_scope = 'THIS_AND_FOLLOWING' THEN
        UPDATE public.recurring_appointment_rules
        SET end_type = 'UNTIL_DATE',
            end_date = (v_apt.booking_date - 1),
            active = CASE WHEN (v_apt.booking_date - 1) < start_date THEN false ELSE active END,
            updated_at = now()
        WHERE id = v_rule.id;
      ELSE
        UPDATE public.recurring_appointment_rules
        SET active = false,
            end_type = 'UNTIL_DATE',
            end_date = (v_today - 1),
            updated_at = now()
        WHERE id = v_rule.id;
      END IF;
    ELSE
      UPDATE public.recurring_appointment_rules
      SET start_time = coalesce(p_new_start_time, start_time),
          service_id = coalesce(p_new_service_id, service_id),
          fixed_price_ars = coalesce(p_new_price_ars, fixed_price_ars),
          pricing_mode = coalesce(p_new_pricing_mode, pricing_mode),
          notes = coalesce(p_notes, notes),
          updated_at = now()
      WHERE id = v_rule.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'rule_id', v_rule.id,
    'scope', v_scope,
    'action', v_action,
    'affected_count', cardinality(v_affected_ids),
    'affected_appointment_ids', v_affected_ids,
    'affected_dates', v_affected_dates,
    'preserved_paid_appointment_ids', v_preserved_paid_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.modify_recurring_appointment_series(uuid, text, text, time, uuid, integer, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.modify_recurring_appointment_series(uuid, text, text, time, uuid, integer, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
