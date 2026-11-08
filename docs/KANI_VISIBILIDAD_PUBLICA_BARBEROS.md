# Visibilidad comercial y correos del personal

Cambio autorizado el 5 de noviembre de 2026 sobre la implementación existente.

`barbers.public_booking_enabled` controla exclusivamente las **nuevas reservas
públicas**. `active` y las identidades de Auth siguen siendo independientes.
Franco permanece activo como BARBER, con su UUID, agenda, cobros e historial.
Lautaro, Gonzalo y Valentín continúan ofrecidos al público.

La migración `kani_public_booking_visibility` agrega el indicador con valor
predeterminado `true` y configura únicamente a Franco en `false`. No elimina ni
reescribe turnos, clientes, horarios, cobros, perfiles o transacciones existentes.
Conserva la corrección de ACL de `internal_note` aplicada anteriormente.

Aplicada una sola vez en producción como
`20261105072253_kani_public_booking_visibility.sql`. El archivo local fue alineado
con esa versión del historial remoto; no debe ejecutarse nuevamente.

La lista pública usa una RPC de solo lectura que devuelve exclusivamente
profesionales activos y habilitados, también cuando el visitante tiene una sesión
de personal. Las políticas anónimas, la vista `security_invoker` y la RPC de
disponibilidad aplican el mismo filtro. La RPC interna conserva el acceso del
barbero propietario y de ADMIN/MANAGER a sus horarios.

`request_appointment` rechaza al profesional excluido antes de modificar contactos
o generar horarios. Un bloqueo de fila serializa esta decisión con los cambios
del indicador. Un trigger privado protege además los INSERT públicos por UUID.
La preparación de PayWay y los beneficios sin seña utilizan la misma validación.
Los turnos MANUAL autorizados y las confirmaciones de pagos de turnos ya existentes
siguen funcionando. No se cambia código ni configuración de los proveedores.

## Reversión comercial

Con una sesión **ADMIN** verificada, invocar
`admin_set_barber_public_booking(p_barber_id, p_enabled)` con el UUID existente y
`true` para volver a ofrecerlo, o `false` para excluirlo. La función usa los
permisos/RLS existentes; MANAGER y BARBER no pueden modificar esta opción.
Recargar la página pública después de cambiar la configuración. No recrear
usuarios ni recuperar datos, ni desactivar `barbers.active`.

## Correos y confirmación

Los correos definitivos de Franco y Valentín se actualizaron mediante la API
administrativa de Auth sobre sus mismas identidades. Los destinos estaban libres;
ambos usuarios estaban sin confirmar y sin inicios de sesión. Se enviaron nuevas
invitaciones a `/activar-cuenta` en el dominio productivo; ambas solicitudes
recibieron HTTP 200. No se generaron contraseñas ni se consumieron enlaces.

Las seis identidades, todos los perfiles, roles y asociaciones permanecieron
iguales. Se actualizó el inventario privado de aprovisionamiento, conservando su
copia anterior fuera de Git. Una ficha de cliente y cinco notificaciones con las
direcciones anteriores se preservaron como registros históricos, sin utilizarlas
para la identidad del personal. La confirmación, contraseña, recepción efectiva
y primer acceso corresponden a los titulares; no confundir aceptación SMTP con
activación de la cuenta.

## Validaciones de esta entrega

- 54 pruebas de reservas/turnos manuales y 58 de disponibilidad/reservas públicas.
- Base PostgreSQL efímera, sin red: permisos originales, migración, solicitudes
  manipuladas por nombre/UUID, PayWay y beneficio sin seña, solo Franco disponible,
  conservación de datos, acceso interno de los tres roles y reversión ADMIN.
- Confirmación sintética de un pago anterior a la exclusión, sin contactar PayWay.
- 12 escenarios visuales: 360/768/1440 px, claro/oscuro, disponibilidad normal y
  disponibilidad únicamente del profesional oculto; sin escrituras reales.
- Build y Wrangler dry-run satisfactorios. El recibo de producción registra aparte
  los resultados efectivos de CI, migración, despliegue y comprobaciones remotas.

Aplicar exclusivamente la migración nueva y desplegar desde la rama recuperada.
No ejecutar `db push` ni integrar `main`: su reconciliación histórica de
`compatible_services` sigue documentada por separado y no pertenece a este cambio.
