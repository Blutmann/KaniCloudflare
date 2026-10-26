# Reserva V4 — infraestructura Payway Sandbox

`/reserva-v4` utiliza el mismo `Booking variant="v3"` y CSS de V3:
Servicio → Barbero → Fecha → Horario → Datos. V3 permanece sin cambios;
V4 sólo sustituye el callback y diálogo de pago.

**No se pueden ejecutar cobros todavía.** Faltan credenciales Sandbox (solicitud
Payway `03832836`). Sin configuración devuelve «Pago de prueba todavía no
disponible» antes de crear un turno o solicitar tarjeta. Configurar claves por
sí solo no habilita pagos: requiere además `PAYWAY_SANDBOX_ENABLED=true`.

## Migración verificada

Única base inspeccionada/modificada: `iockpxtkflyjfagkvgnr`, Kani Barber (Pruebas).
Las 60 versiones/nombres locales coincidían con el ledger remoto y Git.
No se ejecutó repair/reset ni se borraron registros. CLI 2.122.0 disponible,
checkout sin vínculo (`ProjectRefNotLinkedError`); se aplicó/verificó mediante el
conector autenticado Supabase. No hay una inconsistencia del ledger.

Migración aplicada: `supabase/migrations/20261026192743_kani_payment_attempts.sql`.
El archivo local coincide con la versión/nombre generados remotamente.

`payment_attempts` es independiente de appointments y service_payments:

- `id` UUID PK; `appointment_id` FK con DELETE RESTRICT, sin unicidad global.
- `provider` PAYWAY/MERCADO_PAGO; MP conserva su ledger existente.
- `site_transaction_id` único por proveedor: `KANI` + UUID sin guiones
  (36 caracteres), sin datos personales. `provider_transaction_id` nullable,
  único por proveedor; `provider_site_id` snapshot del comercio.
- `amount_ars` numeric(12,2), `amount_minor_units` bigint, `currency=ARS` y
  constraint de conversión exacta ×100. La seña proviene del servidor/configuración.
- Estados internos, `provider_status`, `provider_code`, `confirmation_status`,
  creación/actualización/inicio de procesamiento y expiración explícitos.
- Índice histórico e índice único parcial por appointment para
  CREATED/PROCESSING/UNKNOWN/APPROVED. REJECTED/CANCELLED permiten otro intento.
- Sin PAN/CVV, tokens de pago, credenciales, autenticación, payloads ni metadata JSON.

RLS activa: anon sin acceso; authenticated sólo SELECT si `is_admin()`.
BARBER no obtiene capacidades financieras nuevas. service_role puede
leer/insertar/actualizar. RPCs sensibles ejecutables sólo por service_role;
search_path vacío, referencias calificadas. El cliente no puede insertar,
aprobar, cambiar importe/estado ni identificadores.

## Atomicidad y propiedad

`prepare_payway_attempt` utiliza request_appointment existente y crea el intento
en la misma transacción: ambos se guardan o ambos revierten. Obtiene la seña real
y el precio de servicio, reutiliza CREATED vigente y rechaza intentos inciertos
u órdenes MP existentes.

La propiedad se verifica mediante cookie AES-GCM, HttpOnly, Secure, SameSite
Strict y prefijo __Host-, con expiración. Appointment y capacidad aleatoria sólo
viven cifrados en la cookie; no se guardan datos de autenticación en payment_attempts.
Un UUID conocido no basta para cobrar. El navegador no selecciona amount,
estado, host ni entorno. PAN/CVV van directamente a la tokenización REST Payway,
nunca al Worker; el token tampoco se persiste.

`claim_payway_attempt` realiza CREATED → PROCESSING con locks transaccionales de
agenda, appointment e intento. Doble click/replay no adquieren dos veces;
no depende de memoria del Worker. Transiciones controladas:

`CREATED → PROCESSING → APPROVED / REJECTED / UNKNOWN`

`CREATED → CANCELLED` invalida un intento no enviado. UNKNOWN bloquea otro intento
y no provoca confirmación, rechazo ni cancelación. Timeout, respuesta ilegible,
red o evidencia discordante persisten UNKNOWN; si la base falla, PROCESSING
sigue bloqueando cobros. Sin retries HTTP ni éxito ficticio.

Sólo aprobación servidor-servidor con ID, referencia, comercio, importe y moneda
coincidentes permite APPROVED y confirm_payway_attempt. La confirmación usa
`confirm_verified_appointment_payment`, núcleo extraído con las mismas protecciones
de cancelación, pago tardío, intervalo ocupado, idempotencia y outbox.
La firma MP `confirm_appointment_from_payment` sigue siendo compatible mediante
wrapper. Un trigger evita iniciar MP sobre un intento Payway activo.
Orders API/Checkout Pro/webhook/HMAC/expiración y JS de MP no cambian.
Una aprobación tardía o con colisión queda para revisión, sin confirmar el turno.

## Configuración Preview/Test

Worker autorizado: `kanibarberstudio-cloudflare`; URL Test:
https://kanibarberstudio-cloudflare.kanibarber.workers.dev/reserva-v4
Cloudflare llama “production” al slot main de ese Worker de pruebas;
no es la producción real kanibarber.com. No configurar otros Workers/proyectos.

| Variable | Configuración |
|---|---|
| PAYWAY_SANDBOX_ENABLED | `false` hasta habilitación deliberada |
| PAYWAY_ENVIRONMENT | `sandbox` obligatorio |
| PAYWAY_API_BASE_URL | Host Sandbox oficial confirmado por Payway, con /api/v2 |
| PAYWAY_PUBLIC_API_KEY | Pendiente; entregada sólo al checkout habilitado |
| PAYWAY_SITE_ID | Pendiente, comercio Sandbox |
| PAYWAY_PAYMENT_METHODS | JSON de `{id,label}` oficialmente habilitados |

Secrets backend: `PAYWAY_PRIVATE_API_KEY` y `PAYWAY_CHECKOUT_SECRET` (mínimo 32
caracteres aleatorios). Pendientes de carga segura. No usar prefijos VITE_, Git,
logs ni respuestas públicas para privados. `.env.example` tiene nombres vacíos.
No se utiliza PAYWAY_TEMPLATE_ID hasta aclaración oficial.

El backend exige SUPABASE_URL exacta del Test autorizado; admite sólo los hosts
Sandbox documentados developers-ventasonline.payway.com.ar/api/v2 y
developers.decidir.com/api/v2. No existe modo Producción seleccionable por cliente.
Configuración ausente o bandera distinta de `true` bloquea antes de usar la base.
Las cuatro variables no secretas se guardaron en el Worker Test y su base de
previews. `wrangler.jsonc` fija ese destino y replica los defaults bloqueados;
`keep_vars=true` conserva otras variables remotas al desplegar. Las claves
permanecen pendientes. Ningún secret se incorpora al archivo.
El mismo archivo fija SUPABASE_URL a Test también en runtime, sin depender de
que las variables de build del panel se propaguen como bindings del Worker.

## Validación y pendientes

`supabase/tests/payment-attempts.sql` prueba preparación/importe dinámico, claim
único, múltiples intentos, UNKNOWN, referencias únicas, inmutabilidad,
RLS/permisos, confirmación idempotente/outbox, contrato MP, cancelación y colisión.
Todos los fixtures/eventos revierten con ROLLBACK. Sin dispatcher ni HTTP de pago.
Unitarios cubren manipulación de importe/estado, doble click, timeout, ausencia
de credenciales/bandera, secretos, adaptador durable, cifrado/expiración/propiedad.
Pruebas visuales: cinco pasos, Mobile/Desktop, Light/Dark, lecturas sintéticas y
escrituras bloqueadas. Preview utiliza la función real para verificar el bloqueo.

No hubo transacciones ni credenciales de Producción. Faltan credenciales Sandbox,
confirmar CORS, medios/vertical, PCI/Cybersource/3DS, rechazos/envelopes, TTL de
token, consulta tras timeout y conciliación/webhook. El rechazo plano está
cubierto con fixture; requiere certificación con el comercio. No suponer
idempotencia del proveedor ni agregar reintentos automáticos.

Typecheck global y cuatro tests tenían errores previos ajenos a esta entrega:
estadísticas, estilos de turnos manuales, expectativa RLS y enlace Maps.
Los logs locales documentan la ejecución final.
Build correcto; 106 pruebas específicas/de regresión aprobadas. Suite completa:
481 aprobadas y esos cuatro fallos previos. Sin errores TypeScript en los archivos
Payway. Validación visual local: 80 combinaciones (cinco pasos × dos temas × ocho
anchos), sin escrituras ni peticiones Payway. Roles comprobados con RLS real;
el perfil BARBER se simuló sólo dentro de la transacción revertida, porque Test
no dispone de una cuenta BARBER activa. ADMIN original quedó restaurado.

## Fuentes oficiales de Fase A

- [Tokenización REST](https://documentacion-ventasonline.payway.com.ar/docs/gateway/kwjgnhga0lvam-solicitud-de-token-de-pago).
- [Pago simple REST](https://documentacion-ventasonline.payway.com.ar/docs/gateway/kvgxym8hia78m-ejecucion-del-pago).
- [SDK y Anexo A HTTP](https://documentacion-ventasonline.payway.com.ar/docs/sdk-s/ddw69qltg92u5-1-introduccion).
- [Listado por referencia](https://documentacion-ventasonline.payway.com.ar/docs/gateway/gg5j8yphig0pp-listado-de-pagos).
- [Headers y timeout](https://documentacion-ventasonline.payway.com.ar/docs/gateway/itrpj3n8p8t27-glosario-general).
