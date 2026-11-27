-- Migration: 20261127140000_kani_benefit_codes_allow_enie.sql
-- Kani Barber Studio — Permite la letra Ñ en códigos de beneficio (ej. KANI-SIN-SEÑA-X910, KANI-2027-AÑO-7J9Q)

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.benefit_codes'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%code%'
      AND pg_get_constraintdef(oid) ILIKE '%A-Z0-9%'
  LOOP
    EXECUTE format('ALTER TABLE public.benefit_codes DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.benefit_codes
  ADD CONSTRAINT benefit_codes_code_format_check
    CHECK (code ~ '^[A-Z0-9Ñ-]{4,32}$');
