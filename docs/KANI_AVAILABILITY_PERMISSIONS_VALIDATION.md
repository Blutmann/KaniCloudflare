# Disponibilidad pública: validación del 4 de noviembre de 2026

La migración pendiente conserva los cambios recuperados y revoca `SELECT` de
tabla para `anon` y `PUBLIC`, además de cualquier permiso directo de lectura
sobre `internal_note` para esos roles. Después concede a `anon` únicamente
`id`, `barber_id`, `slot_date`, `start_time`, `end_time` y `status`.

Una comprobación de privilegios efectivos aborta la migración si otro permiso
heredado todavía permite leer la nota. La vista pública conserva RLS con
`security_invoker` y sigue ocultando intervalos ocupados o bloqueados.

Pruebas satisfactorias:

- PostgreSQL temporal sin red: reproduce el permiso amplio original, agrega
  accesos por `PUBLIC` y por columna, y comprueba su revocación efectiva.
- Denegadas la lectura anónima de `internal_note` y la consulta `SELECT *`.
- Permitidas las seis columnas públicas y la vista de disponibilidad; las notas
  del personal permanecen accesibles únicamente dentro de su alcance.
- Siguen pasando permisos de ADMIN/MANAGER/BARBER, cobros, clientes compartidos,
  turnos manuales y auditoría. Los permisos amplios del libro de cobros también
  se eliminan; las escrituras autorizadas siguen usando sus RPC.
- 50 pruebas de reservas y turnos manuales: satisfactorias. Se actualizaron
  selectores y expectativas antiguas; el test de email opcional usa RPC simulada
  y no contacta una base real. No se cambió la lógica de la interfaz.

Esta validación no ejecutó migraciones productivas, despliegues, invitaciones
ni ajustes adicionales de Auth. No se publicó el commit para evitar activar
despliegues automáticos durante esta etapa.

**Pendiente:** publicar y verificar el CI cuando se retome esa etapa, y aplicar
la migración junto con el Worker compatible. Hasta entonces, el permiso amplio
identificado en producción no queda corregido por este cambio local.
