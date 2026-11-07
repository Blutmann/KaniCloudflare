# Resultado productivo — 5 de noviembre de 2026

- Código publicado: `2dac8b4`, rama `codex/kani-five-accounts-recovery`.
  [GitHub Actions satisfactorio](https://github.com/Blutmann/KaniCloudflare/actions/runs/41986434286),
  Cloudflare Worker Preview y Pages satisfactorios. `main` conservó `4beb151`.
- Migración aplicada y registrada una sola vez:
  `20261105072253_kani_public_booking_visibility.sql`. El nombre generado localmente
  antes de la ejecución se alineó con el registro remoto; no hubo una segunda aplicación.
- Worker productivo: versión `094d0fdf-180e-4d95-b1d6-86585cad61f2`, despliegue
  `267f35f9-966a-419e-aaba-05f94459f8ec`, tráfico 100 %. Nombres/tipos de bindings,
  valores de configuración y referencias a secretos preservados.

## Comprobaciones efectivas

Franco está activo, con `public_booking_enabled=false`. Los otros tres barberos
siguen activos y ofrecidos al público. La lista, tabla pública, RPC y vista
excluyen a Franco. La comparación completa, con paginación, conserva exactamente
los resultados de disponibilidad de los otros profesionales: 796 inicios y
16.134 segmentos públicos después de excluirlo.

Una solicitud pública directa de reserva con Franco fue rechazada con
`BARBER_NOT_PUBLICLY_BOOKABLE`, SQLSTATE `42501`, HTTP 401 para el visitante anónimo.
No creó una reserva. Ese estado HTTP corresponde a la
[traducción documentada de PostgREST](https://docs.postgrest.org/en/v14/references/errors.html#http-status-codes)
para un rechazo de permisos sin sesión de usuario.

Las comprobaciones de permisos sobre las identidades reales, dentro de una
transacción revertida, conservaron el acceso interno de Franco BARBER, MANAGER y
ADMIN, y restringieron la configuración comercial a ADMIN. No se usaron sus
contraseñas, sesiones ni enlaces. `internal_note` sigue inaccesible para `anon`
y sin concesiones de SELECT a `PUBLIC`; la vista mantiene `security_invoker=true`.

La comparación privada anterior/posterior conservó todas las filas y campos
anteriores de los datos operativos: 88 turnos, 3.456 horarios, 11 cobros,
44 intentos de pago, 11 órdenes, 20 clientes, 22 asociaciones cliente/barbero,
8 códigos, 4 barberos y 6 perfiles. Solo se agregó la configuración comercial.

El sitio productivo respondió HTTP 200 y se verificó con las API públicas reales
en 360 px/claro y 1440 px/oscuro. Selección inicial y «Elegir más adelante» ofrecen
únicamente a los profesionales habilitados; no hubo reservas ni pagos de prueba.
Se conservaron capturas locales y recibos privados fuera de los archivos publicados.

Los asesores posteriores no informaron errores. La nueva RPC pública de lectura
agrega el aviso genérico de función `SECURITY DEFINER` ejecutable; su salida está
filtrada explícitamente por actividad y habilitación comercial, con search_path
fijado y sin acceso a datos internos. Los demás avisos anteriores permanecen
independientes de esta entrega.

## Cuentas

Los correos definitivos de Franco y Valentín están asignados a sus identidades
originales y coinciden con sus identidades de email. No hay duplicados; los seis
UUID, roles BARBER y asociaciones se conservaron. Supabase aceptó ambas nuevas
invitaciones con HTTP 200 y redirección a `https://www.kanibarber.com/activar-cuenta`.

Ambas cuentas siguen sin confirmar y sin primer inicio de sesión. La recepción
en el buzón, la confirmación y la elección de contraseña quedan pendientes de
los titulares; no se consumieron enlaces ni se establecieron contraseñas.

No se modificaron DNS, PayWay, Resend, Pontiun ni los permisos de ADMIN/MANAGER.
La reconciliación histórica de `compatible_services` sigue separada; no se ejecutó
la cola de migraciones de `main`.
