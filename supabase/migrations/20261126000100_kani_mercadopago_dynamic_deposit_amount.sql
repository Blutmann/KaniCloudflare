-- Local migration only (do NOT apply remotely without explicit authorization).
-- Relaxes the legacy hardcoded CHECK (expected_amount_ars = 5000) constraint on
-- public.appointment_payment_orders so Mercado Pago Checkout Pro supports dynamic
-- deposit amounts and benefit-adjusted deposits (> 0 ARS).
-- confirm_verified_appointment_payment and confirm_appointment_from_payment already
-- validate p_paid_amount against v_order.expected_amount_ars dynamically.

BEGIN;

ALTER TABLE public.appointment_payment_orders
  DROP CONSTRAINT IF EXISTS appointment_payment_orders_expected_amount_ars_check;

ALTER TABLE public.appointment_payment_orders
  ADD CONSTRAINT appointment_payment_orders_expected_amount_ars_check
  CHECK (expected_amount_ars > 0);

COMMIT;
