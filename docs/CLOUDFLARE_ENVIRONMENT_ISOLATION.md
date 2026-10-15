# Cloudflare: aislamiento DEV/PREVIEW vs producción

## Objetivo

- `https://kanibarber.com`: reservas reales, en la base de datos de producción.
- URL `workers.dev` de Cloudflare: reservas de prueba, en una base de datos DEV separada.
- Ambos entornos envían notificaciones por Resend. Los asuntos de DEV/PREVIEW llevan el prefijo `[DEV/PREVIEW]`.

## Regla crítica: no compartir la base de datos

Cambiar el nombre del entorno o el asunto del email **no aísla** las reservas. Para que las pruebas no aparezcan en el panel online ni bloqueen horarios reales, Cloudflare Preview debe usar un **proyecto Supabase distinto** del de producción.

Crear un proyecto Supabase DEV e instalar en él las migraciones SQL de este repositorio antes de probar reservas. No reutilizar la URL ni la clave pública de producción en Preview.

## Variables de Cloudflare

Configurar valores separados en los ámbitos Production y Preview, tanto en variables de build como en variables y secretos de runtime cuando corresponda.

### Build — necesarias para el cliente web

| Variable | Production | Preview |
|---|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase PROD | URL del proyecto Supabase DEV |
| `VITE_SUPABASE_ANON_KEY` | Clave pública/publishable de PROD | Clave pública/publishable de DEV |

### Runtime — necesarias para las funciones del servidor

| Variable | Production | Preview |
|---|---|---|
| `SUPABASE_URL` | URL Supabase PROD | URL Supabase DEV |
| `VITE_SUPABASE_URL` | URL Supabase PROD | URL Supabase DEV |
| `VITE_SUPABASE_ANON_KEY` | Clave pública/publishable de PROD | Clave pública/publishable de DEV |
| `RESEND_API_KEY` | Secreto de Resend | Secreto de Resend |
| `RESEND_FROM_EMAIL` | `turnos@kanibarber.com` | `turnos@kanibarber.com` |
| `KANI_ENVIRONMENT` | `PRODUCTION` | `DEV/PREVIEW` |

No guardar ni commitear claves secretas en el repositorio. Las claves Supabase de cliente deben ser publicables/anon, nunca una `service_role` ni una clave secreta.

## Validación antes de darlo por terminado

1. Crear una reserva de prueba desde la URL Preview.
2. Verificar que la fila aparece únicamente en el proyecto Supabase DEV y que llega el email con asunto `[DEV/PREVIEW]`.
3. Verificar que la reserva no aparece en el panel online y que no bloquea el horario en producción.
4. Crear una reserva controlada en producción y comprobar que llega sin prefijo DEV y aparece únicamente en Supabase PROD.
5. No promover una versión a producción hasta terminar estas pruebas.

## Notificaciones en Cloudflare

Las funciones del servidor leen secretos desde los bindings de runtime de Cloudflare, con fallback a `process.env` para entornos compatibles. Esto evita depender exclusivamente de que Cloudflare copie los bindings a `process.env`.
