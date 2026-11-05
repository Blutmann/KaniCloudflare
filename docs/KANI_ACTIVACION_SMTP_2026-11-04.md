# Activación final: SMTP operativo e invitaciones enviadas

Actualización posterior a que el titular reemplazó la contraseña SMTP en
Supabase por una API key de Resend con permisos de envío.

## Resultado real

| Cuenta | Rol conservado | Reenvío mediante Supabase Auth |
| --- | --- | --- |
| Gonzalo | BARBER | Correcto, HTTP 200 |
| Valentín | BARBER | Correcto, HTTP 200 |
| Franco | BARBER | Correcto, HTTP 200 |
| KANI Jefe | MANAGER | Correcto, HTTP 200 |

Se comprobó primero el envío a Gonzalo; al ser satisfactorio se continuó con los
otros tres. Supabase registra `invited_at` para los cuatro. Esto confirma que la
nueva configuración permite enviar mediante Auth; no acredita por sí solo la
ubicación en bandeja de entrada ni la apertura por cada destinatario.

Todos los usuarios existían antes de los reenvíos. Los UUID devueltos por Auth
coinciden con los originales. La comparación anterior/posterior conserva todos
los perfiles íntegros: roles, estado activo, asociaciones y demás campos.
Se mantienen seis identidades y perfiles, cuatro barberos y cero asociaciones
duplicadas. ADMIN y Lautaro no fueron invitados ni modificados.

## Configuración conservada y corrección del diagnóstico

Se conservaron `smtp.resend.com`, puerto `465`, usuario `resend`, remitente,
nombre del remitente, confirmación automática deshabilitada y redirecciones:
`https://www.kanibarber.com` y `/activar-cuenta` expresamente permitido.
La conexión TLS con certificado verificado fue satisfactoria.

El rechazo 535 original registrado por **Auth** fue real. El cambio de la
credencial realizado por el titular resolvió los envíos. Debe corregirse, sin
embargo, una conclusión del diagnóstico posterior: el campo de contraseña leído
por la API de configuración es una representación protegida, no la clave real.
Intentar SMTP con ese valor no es una prueba válida de la credencial guardada;
su formato tampoco permite concluir que se configuró un tipo incorrecto de clave.
El código oficial de [Supabase Studio](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/Auth/SmtpForm/SmtpForm.tsx)
documenta que la contraseña SMTP es de escritura solamente. La comprobación
válida en esta ejecución fueron los cuatro envíos satisfactorios desde Auth.

No se recuperó ni expuso la nueva API key. El registro detallado del envío se
conservó privadamente fuera de Git, sin enlaces de activación ni contraseñas.
No se cambiaron DNS, PayWay, Pontiun, Resend del Worker, reservas, roles ni
asociaciones. No se ejecutaron migraciones ni despliegues productivos.

## Pendiente de los titulares

Después del envío, las cuatro cuentas todavía figuran sin confirmar y sin
inicio de sesión registrado. Cada titular debe abrir su invitación y establecer
su contraseña. No se consumieron enlaces ni se eligieron contraseñas por ellos.

Un hash en Auth no demuestra que alguien haya elegido su contraseña:
[Supabase genera un valor aleatorio interno al crear sin contraseña](https://github.com/supabase/auth/blob/master/internal/api/admin.go).
La activación y la comprobación interactiva de permisos quedan pendientes de sus
titulares. Se conservan las comprobaciones RLS anteriores con las seis identidades.

La incidencia `compatible_services` sigue siendo independiente; no se alteró
ninguna migración aplicada. Consultar [la estrategia de reconciliación](KANI_MIGRACIONES_HISTORICAS_RECONCILIACION.md).
