# Reconciliación pendiente de migraciones históricas

Incidencia independiente de SMTP y de la activación de cuentas, identificada
el 4 de noviembre de 2026 en el check automático de Supabase de `main`.

La migración `20261102140000_kani_rename_corte_to_corte_de_cabello.sql` falla en
su segunda sentencia con `SQLSTATE 42703`: actualiza la columna inexistente
`public.barber_availability_slots.compatible_services`. El archivo también
contiene otros cambios; saltar esa sentencia no demuestra su compatibilidad.

Las tres migraciones de personal ya están registradas en producción como
`20261104224853`, `20261104224855` y `20261104224857`. La corrección independiente
de disponibilidad figura una sola vez como `20261104223457`. No deben repetirse.

Antes de reanudar automatizaciones que apliquen migraciones desde `main`:

1. Comparar el historial remoto y las definiciones actuales con todos los archivos
   que la integración considera pendientes, sin ejecutarlos.
2. Identificar cambios ya realizados fuera de ese historial y diferencias reales,
   incluyendo funciones de reservas, disponibilidad y restricciones de cobros.
3. Reproducir la secuencia propuesta sobre una restauración aislada; verificar
   datos, reservas, permisos e integraciones. Conservar respaldo y plan de retorno.
4. Preparar correcciones nuevas y, solo cuando corresponda, una reconciliación
   explícita del historial respaldada por esa comparación. No marcar archivos
   enteros como aplicados por mera coincidencia parcial de esquema.
5. Ejecutar únicamente la secuencia revisada y comprobar esquema e historial.

Durante la revisión SMTP no se modifica ninguna migración aplicada ni se
reanuda esa cola. El Worker y el esquema de personal publicados siguen activos.
