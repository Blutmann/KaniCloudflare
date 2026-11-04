# KANI: resultado productivo del 4 de noviembre de 2026

## Ejecutado

- Publicado `99b9e85`; revisión y activación corregidas en `7a4b9db`.
- Integrado `4beb151` en `main` por avance directo, sin reescribir historia.
  GitHub Actions, Worker Preview, Worker productivo y Cloudflare Pages satisfactorios.
  [Validación de la versión desplegada](https://github.com/Blutmann/KaniCloudflare/actions/runs/41928637220).
- Tres migraciones aplicadas y registradas, en este orden:
  `20261104224853_kani_manager_role`,
  `20261104224855_kani_operational_permissions`,
  `20261104224857_kani_complete_staff_payments_and_permissions`.
  Los archivos locales coinciden con esas versiones del historial.
- La corrección `20261104223457_kani_anonymous_availability_columns` se conservó;
  no se ejecutó otra vez. Se verificó primero en las pruebas de compatibilidad.
- Worker productivo activo al 100 %: versión `b3b7c9e0-dcaf-4d59-8ff2-785ac1fef54e`,
  despliegue `fcc7af24-93bd-4324-ab98-a9a2a44be65c`, 22:52:51 UTC.
- Identidades: Lautaro conserva su cuenta confirmada y asociación BARBER.
  Gonzalo, Valentín y Franco fueron creados como BARBER y asociados a sus UUID
  existentes; KANI Jefe, como MANAGER sin barbero. Estas cuatro cuentas nuevas
  permanecen sin confirmar y sin contraseña, pendientes de invitación.
  ADMIN y Lautaro conservan íntegros sus perfiles originales. Total: seis perfiles,
  incluidos ADMIN, cuatro barberos y un MANAGER; ningún barbero duplicado.

## Comprobaciones reales

- Esquema y RLS validados antes de aplicar las migraciones; respaldo privado
  adicional previo a la operación conservado fuera de Git.
- Comparación posterior: los campos originales de 88 reservas, 20 clientes,
  11 cobros, cuatro barberos, tres servicios, ocho descuentos y los dos perfiles
  anteriores no cambiaron. Solo se agregaron cuatro identidades y perfiles.
- La única vista pública, `available_barber_slots`, usa `security_invoker=true`.
  Todas las tablas públicas tienen RLS. La RPC y vista públicas responden;
  `anon` no puede leer `internal_note` ni usar `SELECT *` sobre disponibilidad.
- Pruebas en la base productiva con los seis UUID reales y rol `authenticated`:
  alcance propio de BARBER en reservas, disponibilidad y finanzas; clientes
  compartidos sin exposición de cobros ajenos; creación/edición, descuentos,
  importe final y anulación mediante RPC; MANAGER con descuentos de solo lectura;
  separación ADMIN/MANAGER; rechazo de elevación de rol y escritura financiera
  directa. Toda la transacción de prueba fue revertida, sin pagos externos.
- HTTP productivo: inicio, reservas, panel y activación responden 200. Ocho
  endpoints protegidos del Worker rechazan consultas sin sesión con 401.
- Configuración y nombres de bindings del Worker conservados. No se modificaron
  DNS, contraseñas, claves existentes ni las integraciones PayWay, Resend o Pontiun.
- Se conservaron las validaciones previas de reservas y turnos manuales
  (50 pruebas), pruebas específicas, SQL aislado, build y Wrangler dry-run.
  El ajuste del aprovisionamiento pasó sus 16 pruebas locales, incluidas seis
  nuevas sobre preparación sin correo, reanudación y prevención de duplicados.

## Pendiente y bloqueo acotado

1. **Invitaciones:** los cuatro envíos intentados fallaron. Auth registra el error
   SMTP **535: Authentication credentials invalid**. La configuración canónica y
   la redirección exacta a `/activar-cuenta` están verificadas, pero SMTP no es
   operativo. No se cambió su credencial ni se repitieron envíos tras diagnosticar
   el rechazo. No se envió una invitación a la cuenta ya confirmada de Lautaro.
   Debe revisarse SMTP en Supabase/Resend, sin compartir secretos. Después,
   ejecutar `scripts/invite-kani-staff.mjs <roster-privado> --send`: reutiliza
   las cuatro identidades pendientes y conserva las confirmadas. `--prepare`
   permite preparar sin correos ni contraseñas; el modo inicial solo consulta.
   Faltan la entrega de las invitaciones y la activación/login de sus titulares.
   La comprobación de permisos anterior es de base de datos, no un login humano.
2. **Automatización Supabase:** el check de `main` falla en la migración histórica
   `20261102140000_kani_rename_corte_to_corte_de_cabello.sql`: intenta actualizar
   `barber_availability_slots.compatible_services`, columna inexistente
   (`SQLSTATE 42703`, sentencia 2). Las tres migraciones actuales sí figuran en
   producción y el panel está desplegado. No se volvió a ejecutar esa cola ni se
   alteró artificialmente el historial. Antes de otro cambio de `main` que dispare
   migraciones automáticas hay que reconciliar esa cola histórica con el esquema
   real y verificar sus efectos; corregir solo la columna no valida el resto.

No se declara verde la suite histórica completa. Las verificaciones funcionales
seleccionadas no detectaron otro bloqueo de esta entrega; los dos pendientes
anteriores permanecen abiertos.
