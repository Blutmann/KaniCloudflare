# Activación final: diagnóstico SMTP

## Resultado comprobado

Supabase Auth ya utiliza Resend. La configuración leída es compatible con la
[configuración oficial de Resend para Supabase](https://resend.com/docs/send-with-supabase-smtp):

| Parámetro | Resultado |
| --- | --- |
| Servidor | `smtp.resend.com` |
| Puerto | `465`, TLS implícito con certificado verificado |
| Usuario | `resend` |
| Autenticación | El servidor anuncia `PLAIN` y `LOGIN`; prueba directa con `PLAIN` |
| Credencial actual | Rechazada por el servidor con **535**; no tiene el formato de una API key de Resend |
| Remitente | Del dominio `kanibarber.com`, nombre configurado |
| Site URL | `https://www.kanibarber.com` |
| Activación autorizada | `https://www.kanibarber.com/activar-cuenta` |
| Confirmación automática | Deshabilitada, conservada |

La prueba directa abrió TLS, negoció SMTP e intentó autenticación una vez; no
ejecutó `MAIL FROM`, `RCPT TO` ni `DATA`. Por tanto, no envió mensajes. No se
modificó ninguna configuración productiva durante este diagnóstico.

La causa demostrada del bloqueo es la credencial SMTP rechazada por Resend;
la conexión, el puerto y TLS funcionan. Resend requiere una API key como
contraseña SMTP. No se dispone localmente de una válida; el secreto ya existente
del Worker no puede recuperarse mediante la API de Cloudflare. No se publicó
ningún mecanismo para extraer secretos.

## Dominio y siguiente paso

Las consultas DNS públicas no devolvieron TXT para
`resend._domainkey.kanibarber.com` ni `send.kanibarber.com`. Esto no determina
por sí solo el estado de verificación registrado en Resend, que debe comprobarse
allí junto con el dominio permitido por la API key. No se modificaron DNS.

Se solicitó cargar una API key de envío válida para el dominio de KANI en el campo
Password de SMTP de Supabase, sin compartirla en el chat. Conservar servidor,
puerto y usuario. Tras esa actualización corresponde:

1. Comprobar autenticación SMTP y autorización/verificación del dominio remitente.
2. Revalidar los cuatro UUID, roles y relaciones existentes; no crear usuarios.
3. Reenviar las invitaciones a Gonzalo, Valentín, Franco y KANI Jefe. Verificar
   aceptación del envío y, cuando el acceso al proveedor lo permita, entrega.
4. Los titulares deben abrir sus invitaciones y establecer contraseñas propias.
   No consumir sus enlaces, confirmar sus correos ni elegir contraseñas por ellos.
5. Verificar confirmación, cambio de contraseña realizado por el titular y registro
   de acceso; completar la validación interactiva BARBER/MANAGER con sus titulares.

Un hash de contraseña no acredita esa activación: al crear un usuario sin enviar
contraseña, [Supabase genera un valor aleatorio interno](https://github.com/supabase/auth/blob/master/internal/api/admin.go).
Las cuatro cuentas tienen ese campo, pero siguen sin confirmar y sin accesos
registrados. No se eligieron ni compartieron contraseñas para ellas.

Las cuatro identidades permanecen sin confirmar. En esta revisión no se
reenviaron invitaciones porque SMTP sigue rechazando la autenticación.
Los permisos RLS de las seis identidades ya fueron comprobados en la entrega
anterior; no sustituyen el inicio de sesión real pendiente de los cuatro titulares.

ADMIN, Lautaro, PayWay, Pontiun y las reservas no se modificaron. No se ejecutaron
migraciones ni despliegues productivos. La incidencia histórica se documenta separadamente
en [la estrategia de reconciliación](KANI_MIGRACIONES_HISTORICAS_RECONCILIACION.md).
