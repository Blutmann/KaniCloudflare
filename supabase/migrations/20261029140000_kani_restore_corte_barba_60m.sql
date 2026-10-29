-- Migration: 20261029140000_kani_restore_corte_barba_60m.sql
-- Restaurar la duración oficial de "Corte + barba" / "Corte y barba" a 60 minutos,
-- manteniendo "Barba" en 30 minutos, "Corte" en 45 minutos y la grilla administrativa
-- de disponibilidad en intervalos de 45 minutos.

UPDATE public.services
SET duration_minutes = 60,
    updated_at = now()
WHERE name IN ('Corte + barba', 'Corte y barba');
