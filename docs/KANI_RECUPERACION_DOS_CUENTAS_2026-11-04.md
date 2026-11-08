# Recuperación de KANI Jefe y Lautaro

## Envíos ejecutados

| Cuenta | Estado previo | Enlace enviado | Resultado Auth | Confirmación posterior |
| --- | --- | --- | --- | --- |
| KANI Jefe | Confirmado, MANAGER activo; acceso anterior registrado | Recuperación de contraseña | HTTP 200; `recovery_sent_at` registrado | Sigue confirmado |
| Lautaro | Confirmado, BARBER activo; barbero asociado | Recuperación de contraseña | HTTP 200; `recovery_sent_at` registrado | Sigue confirmado |

No correspondía otra invitación a KANI Jefe: el primer enlace ya había confirmado
la identidad. Se enviaron dos solicitudes de recuperación, una por cuenta.
Supabase registró los envíos el 5 de noviembre a las 01:42:49 y 01:42:50 UTC,
respectivamente, noche del 4 de noviembre en Argentina.

Los UUID devueltos en el inventario posterior coinciden con los anteriores.
Todos los perfiles conservan exactamente sus campos originales, incluidos roles,
estado activo y asociaciones. No se crearon ni eliminaron identidades ni se
cambiaron contraseñas manualmente. No se alteraron turnos, cobros o integraciones.
Los comprobantes privados se conservaron fuera de Git, sin enlaces ni tokens.

## Página y redirección verificadas antes del envío

- Site URL: `https://www.kanibarber.com`.
- Redirect permitido expresamente: `https://www.kanibarber.com/activar-cuenta`.
- Plantilla de recuperación: usa `ConfirmationURL`, sin otro host fijado.
- La página productiva responde HTTP 200 y su implementación coincide con la
  versión revisada. No fue necesario cambiar ni desplegar la aplicación.
- El cliente usa la detección de sesión desde URL de Supabase. Ocho pruebas del
  formulario fueron satisfactorias. Dos nuevas usan el SDK real con un servidor
  HTTP Auth sintético: procesan `PASSWORD_RECOVERY`, guardan mediante `updateUser`
  antes de navegar al panel y permiten corregir la contraseña si Auth la rechaza.
  Las otras cubren enlaces inválidos, sesión ajena, errores y confirmación distinta.
- Solo se probaron contraseñas sintéticas fuera de producción; no se consumieron
  enlaces de las dos personas ni se iniciaron sesiones en su nombre.

## Entrega y pendientes

La aceptación de Supabase y los registros `recovery_sent_at` están comprobados.
Los accesos disponibles no permiten leer el estado de estos mensajes en Resend:
la contraseña SMTP es de escritura solamente y no hay una sesión de lectura del
proveedor conectada. Los registros de notificaciones de reservas no acreditan
la entrega de correos Auth. Se solicitó al titular el estado de ambos mensajes
en Resend → Emails, sin contenido, tokens ni enlaces.

Después de los envíos, el titular confirmó en este chat: **“Llegaron perfecto.”**
La recepción de ambos correos queda confirmada por el usuario; no se atribuye
esa confirmación a una lectura directa del estado `Delivered` en Resend.
Ambos correos estaban confirmados antes y permanecen así; esto no demuestra
que la nueva recuperación haya sido completada. Cada titular debe abrir su
correo más reciente y guardar su contraseña propia.

No se ejecutaron migraciones ni despliegues productivos. La incidencia histórica
`compatible_services` sigue separada de esta operación y sin modificaciones.
