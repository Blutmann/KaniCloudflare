# Auditoría de Mercado Pago — 25/10/2026

## Base y alcance

- Base auditada: `16f649e2cfa1fec2b9e8f66258f8af5b6b8f2738`, tip de `origin/main` al iniciar; contiene `4cc38f3` y el fix de hidratación `db88bda`.
- Trabajo local anterior preservado en `/workspace/KaniCloudflare`, sin publicarlo encima de cambios posteriores.
- Sólo Worker Preview `kanibarberstudio-cloudflare`. No se ejecutaron pagos reales ni escrituras en Supabase remoto. Ningún cambio en Cloudflare/Supabase Production.
- La API Cloudflare informó versión activa `8f554ab2-6cc7-4185-828c-433ea2b2126d` al iniciar. Sus metadatos no incluían SHA Git: esto confirma el despliegue observado, pero no prueba por sí solo correspondencia binaria con `16f649e`.

## Fuentes y herramientas realmente disponibles

No hay Plugin/MCP de Mercado Pago registrado entre las herramientas de esta sesión, ni una herramienta para conectar dinámicamente un MCP remoto u obtener OAuth. No se utilizó ni simuló su uso. El plugin Mercado Pago tampoco figura entre los plugins instalables ofrecidos por esta sesión.

El proxy bloqueó con CONNECT 403 el sitio oficial y `https://mcp.mercadopago.com/mcp`. Se guardó un borrador de red que conserva los destinos existentes y añade:

- `www.mercadopago.com.ar`
- `api.mercadopago.com`
- `mcp.mercadopago.com`
- `kanibarberstudio-cloudflare.kanibarber.workers.dev`

Revisar/guardar/publicar el entorno aplica estos permisos; guardar el borrador no los activa. No se eludió el bloqueo.

Sí se consultó el repositorio oficial `mercadopago/sdk-nodejs`, snapshot `bf920b9415ba19986b7ffdbf83a5aa21b589a6e0`:

- [Create Order, tipos](https://github.com/mercadopago/sdk-nodejs/blob/bf920b9415ba19986b7ffdbf83a5aa21b589a6e0/src/clients/order/create/types.ts)
- [Checkout Pro, ejemplo de prueba del SDK](https://github.com/mercadopago/sdk-nodejs/blob/bf920b9415ba19986b7ffdbf83a5aa21b589a6e0/src/clients/order/create/create.spec.ts)
- [Order y transacciones, tipos de respuesta](https://github.com/mercadopago/sdk-nodejs/blob/bf920b9415ba19986b7ffdbf83a5aa21b589a6e0/src/clients/order/commonTypes.ts)
- [Guía oficial de Webhooks](https://github.com/mercadopago/sdk-nodejs/blob/bf920b9415ba19986b7ffdbf83a5aa21b589a6e0/docs/webhooks.md)
- [Validador oficial de firma](https://github.com/mercadopago/sdk-nodejs/blob/bf920b9415ba19986b7ffdbf83a5aa21b589a6e0/src/utils/webhook/index.ts)
- [Idempotencia y reintentos](https://github.com/mercadopago/sdk-nodejs/blob/bf920b9415ba19986b7ffdbf83a5aa21b589a6e0/docs/request-options.md)

El SDK es evidencia oficial adicional, pero sus tipos opcionales NO demuestran todos los campos obligatorios, defaults o límites del contrato HTTP. Queda pendiente contrastar la referencia REST/Markdown del sitio solicitado y la configuración real de la aplicación. No se ejecutó quality_evaluation.

## Hallazgos y correcciones

| Área | Código anterior | Corrección |
| --- | --- | --- |
| Confirmación SQL | SECURITY DEFINER ejecutable por anon/authenticated; ignoraba Order e importe | Nueva migración restringe a service_role y exige Order registrada e importe esperado |
| Importe | Creación aceptaba precio/barbero/cliente enviados por el navegador; confirmación no pasaba importe esperado | Datos comerciales leídos del turno por servidor, seña 5000 ARS, registro persistente antes de crear Order |
| Moneda/estado | Moneda opcional; aceptaba estados generales y estructura de pagos distinta; podía sustituir importe pagado por total nominal | Exige Orders online processed/accredited, currency ARS, total y cobro efectivos 5000 y transacciones acreditadas sin devolución |
| Identidad | external_reference comprobada, sin vínculo persistente Order–turno | Tabla con Order única; respuesta API debe coincidir con ID solicitado, referencia y vínculo guardado; IDs cruzados rechazados |
| Callback | notification_url raíz, ausente del tipo Orders del SDK | config.online.callback_url según SDK oficial |
| Expiración | Calculaba fecha pero no enviaba expiración | expiration_time ISO 8601 PT10M; pendiente comprobar límites del contrato REST argentino |
| Checkout | Fabricaba un redirect cuando faltaba URL en la respuesta | Exige una URL devuelta por Mercado Pago; no inventa un checkout válido |
| Webhook | Permitía omitir firma si faltaba secret; devolvía 200 incluso tras errores devueltos por API/RPC | Falta de configuración falla cerrada; firma obligatoria; fallos transitorios devuelven 503 |
| Notificaciones | Confirmación invocaba función puente TanStack desde Webhook crudo | Dispatcher server-only invocable desde Worker sin depender de contexto TanStack |
| Pago tardío | Evitaba solapamiento confirmado, pero sin registro financiero para revisión | Persiste PAID_LATE_REVIEW/PAID_CANCELLED_REVIEW; no pisa otra reserva ni asigna horario pasado |

**La migración no fue aplicada remotamente.** El acceso de esta sesión a Supabase DEV devolvió HTTP 401. La vulnerabilidad de permisos en una base que conserve la migración anterior NO queda cerrada sólo por desplegar JavaScript.

## Payload y retorno

Se mantiene `POST /v1/orders`; no se agregó `/checkout/preferences`.

`4cc38f3` SÍ incluye `processing_mode: "manual"`, aunque el informe anterior lo omitía. Se conserva: coincide con el ejemplo Checkout Pro oficial del SDK. No se afirma un default u obligatoriedad REST que no pudo consultarse.

Payload corregido: type online, processing_mode manual, total_amount decimal "5000.00", currency ARS, external_reference UUID del turno, payer.email del turno, un item cantidad 1 por 5000, expiration_time PT10M, callback y retornos dentro de config.online. El código anterior recibía name/phone pero no los enviaba; no se inventaron estructuras de payer adicionales.

El SDK confirma success_url/failure_url/pending_url y auto_return all. Preview utiliza `/pago/exito`, `/pago/error`, `/pago/pendiente` bajo `https://kanibarberstudio-cloudflare.kanibarber.workers.dev`, con referencia del turno. `KANI_APP_URL` y `MERCADOPAGO_NOTIFICATION_URL` permiten configurar después Production, pero no se modificaron a kanibarber.com.

Los estados de query NO certifican cobros. La resolución desde /pago/exito utiliza GET autenticado de la Order registrada, valida identidad/referencia/moneda/importe/cobro y sólo después llama la RPC privada. El fallback payment además debe pertenecer a esa misma Order y turno. Se mantiene el patrón de consulta server-side, coherente con consultar el recurso como fuente de verdad; no se afirma una certificación oficial específica de esta arquitectura.

## Webhook y ejecución Cloudflare

- Endpoint: `/api/webhook/mercadopago`.
- Handler atiende type `order` y `payment`; no adivina el recurso probando endpoints sucesivos. Confirmación del nombre exacto del evento Orders en el panel/documentación REST sigue pendiente.
- ID firmado de query `data.id`, único; ID del body debe coincidir. No se usa body.id como sustituto ambiguo.
- Firma `ts=...,v1=...`, HMAC-SHA256, comparación timingSafeEqual, manifiesto `id:{data.id};request-id:{x-request-id};ts:{ts};`. Tolerancia 300 segundos conforme al validador del SDK consultado; campos de firma malformados se rechazan.
- Secret obligatorio. HTTP 401 ante firma inválida; 400 ante IDs inconsistentes; 503 ante configuración/API/DB no disponible.
- Se espera todo el procesamiento antes de HTTP 200, incluidas las llamadas de notificación. No hay trabajo crítico tras el return ni promesa abandonada que requiera waitUntil.
- No es un ACK inmediato: latencia externa puede provocar reintentos del proveedor, para los que se necesita idempotencia persistente. Una cola duradera podría mejorar latencia/recuperación en una etapa posterior.

## Garantía persistente e idempotencia

No se encontró `recentWebhookEvents` en el código actual. No se añadió caché de isolates.

La nueva tabla registra appointment_id único, Order única, UUID de operación estable y seña esperada. La RPC usa advisory lock por barbero/fecha, bloqueo de fila, comparación de Order/importe y transición atómica. Devuelve CONFIRMED únicamente en la transición efectiva; ALREADY_CONFIRMED no vuelve a despachar. El evento de notificación existente tiene unique(appointment_id, notification_type) y claim persistente.

La key estable corresponde a una operación, no se genera otra por timeout. La UI reutiliza el mismo turno pendiente durante diez minutos; una reserva nueva tiene otra operación. No se implementó rotación automática de key sobre el mismo turno al caducar/rechazarse la Order: requiere reconciliar/cerrar la anterior y verificar contrato de reintentos. No se debe resolver generando keys nuevas a ciegas, con riesgo de doble cobro. Órdenes previas a esta migración requieren reconciliación y vinculación verificadas antes de admitirlas.

## Pruebas y límites

| Caso | Resultado comprobado | Mercado Pago real de prueba |
| --- | --- | --- |
| Approved | Unitario con respuesta Orders del contrato SDK: valida y confirma | No ejecutado |
| Pending | Unitario: no confirma | No ejecutado |
| Rejected/cancelled | Unitario: no confirma | No ejecutado |
| URL manipulada | Unitario y Chromium local: no confirma con flags approved | No ejecutado en Preview remoto |
| IDs cruzados | Unitario y PostgreSQL local: rechazo | No ejecutado |
| Duplicado/refresh | Unitario: no reenvía; SQL real local: ALREADY_CONFIRMED | No ejecutado |
| Concurrencia | PostgreSQL 17 local real: una transición/un evento, tanto mismo turno como horarios competidores | No ejecutado contra Supabase DEV |
| Pago tardío/cancelado | SQL local: no sobrescribe y registra revisión; sin reembolso automático | No ejecutado |
| WhatsApp/email | Invocación única con mocks + evento SQL único | Entrega real no demostrada |

Suite completa: 380 aprobadas, 2 fallos preexistentes ajenos al pago (rangos de estadísticas y proporción de columnas de turnos manuales). 59 pruebas focalizadas de Mercado Pago aprobadas; build aprobado.

Prueba PostgreSQL reproducible: contenedor desechable `kani-mp-audit-db` con postgres:17-alpine y DB vacía; ejecutar `python supabase/tests/payment-confirmation-audit.py`. El fixture mínimo sustituye el emisor de notificaciones por un contador único: demuestra transacción/locks/permisos, no entrega de proveedores ni toda la instalación Supabase.

Chromium sobre build Cloudflare local: 360, 390 y 1440 px en Light/Dark; Servicio→Continuar→Barbero→Fecha/Hora→Datos, navegación stepper, conservación de datos, menú, enlace WhatsApp y botón Pagar seña habilitado. 28 assets JS/CSS HTTP 200 por caso, sin errores de página. No se efectuó un cobro. Revisión del bundle cliente: sin nombres de secretos revisados, node:crypto ni createHmac. La validación HTTP del Preview remoto sigue bloqueada por red.

## Configuración y cuenta receptora

| Variable | Evidencia Preview |
| --- | --- |
| MERCADOPAGO_ACCESS_TOKEN | Secret binding presente; valor, ambiente y titular no inspeccionables con estas herramientas |
| MERCADOPAGO_WEBHOOK_SECRET | Secret binding presente; coherencia con aplicación MP no verificada |
| MERCADOPAGO_PUBLIC_KEY | No binding; no utilizado por redirect Checkout Pro actual, no necesario para este flujo |
| SUPABASE_SERVICE_ROLE_KEY | Faltante en Worker; nueva confirmación requiere esta credencial privada DEV |
| SUPABASE_URL | Configurar URL DEV en runtime; build tiene VITE_SUPABASE_URL público |
| VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY | Presentes en entorno de build; solicitud DEV con esa configuración devolvió 401 |
| KANI_APP_URL / MERCADOPAGO_NOTIFICATION_URL | Sin binding; código usa defaults Preview |
| RESEND_API_KEY | Secret binding presente |
| RESEND_FROM_EMAIL | Sin binding runtime; se admite fallback de build, cuya operatividad debe comprobarse o configurar explícitamente |
| PONTIUN_API_KEY | Sin binding: no puede enviar WhatsApp Pontiun desde este Worker |
| PONTIUN_WHATSAPP_PHONE_NUMBER_ID | Sin binding; también admite PONTIUN_PHONE_NUMBER_ID/PONTIUN_PAGE_ID |
| PONTIUN_WHATSAPP_CONFIRMATION_TEMPLATE / PONTIUN_WHATSAPP_TEMPLATE_LANGUAGE | Defaults del código, pendientes validar plantilla aprobada |
| PONTIUN_WEBHOOK_SECRET | Secret binding presente; NO sustituye la API key de envío |

No se consultaron ni modificaron credenciales Production. No se puede clasificar como TEST/PRODUCTION un secret sólo por su nombre o por estar en un Worker workers.dev.

**¿Quién recibe los $5000?** La cuenta vendedora dueña de las credenciales/aplicación productivas que se configuren. La URL de retorno, Supabase y el teléfono de Pontiun no determinan el destinatario del dinero. No se verificó el titular/ID de esa cuenta: debe cotejarse en la aplicación de Mercado Pago o mediante OAuth/API autenticada oficial, sin realizar un cobro para descubrirlo.

Pontiun se conserva y sólo se invoca para el evento CONFIRMED; Resend utiliza el ID persistente del evento como Idempotency-Key. Pontiun envía una key por turno-confirmado, pero no se pudo verificar externamente la garantía del proveedor. El lock/claim evita que dos Workers despachen simultáneamente. No equivale a entrega exactamente una vez ante caídas entre envío y registro: no hay recuperación automática completa por canal, y fallos/omisiones WhatsApp se registran en logs pero no impiden marcar el evento email como SENT. Con ambas integraciones WhatsApp (Meta y Pontiun) activas, se ejecutarían ambas; actualmente no se observaron los bindings de envío. La entrega y recuperación independiente por canal sigue pendiente antes de declarar circuito comercial completo.

## Acciones manuales para destrabar DEV (sin secretos por chat)

1. Revisar/guardar el borrador de red del entorno y publicar el entorno. Reanudar consulta de Markdown/REST oficial, MCP y Preview remoto.
2. En Supabase, seleccionar exclusivamente el proyecto DEV `iockpxtkflyjfagkvgnr`. Verificar su identidad antes de abrir SQL Editor. Aplicar `supabase/migrations/20261025000100_kani_secure_payment_confirmation.sql` allí; no en Production. El archivo se valida localmente pero necesita la instalación base existente. Revisar órdenes previas no vinculadas.
3. En Cloudflare → Worker `kanibarberstudio-cloudflare` → Settings → Variables and Secrets, añadir `SUPABASE_SERVICE_ROLE_KEY` como secret con la credencial privada DEL PROYECTO DEV y `SUPABASE_URL` como variable con su URL. No usar credenciales de Production ni prefijo VITE_ para el secret. Configurar también remitente Resend y datos de envío Pontiun, desde sus paneles, sin pegarlos en el chat.
4. En Mercado Pago Developers → Tus integraciones → aplicación usada para estas pruebas → Webhooks, verificar URL `https://kanibarberstudio-cloudflare.kanibarber.workers.dev/api/webhook/mercadopago`, ambiente y el evento de Orders indicado por la documentación actual. Comprobar que la firma secreta coincide con el secret del Worker; no revelarla. Estos valores NO se pudieron consultar/configurar desde esta sesión.
5. Habilitar un mecanismo oficial MCP/OAuth si el cliente lo ofrece: endpoint `https://mcp.mercadopago.com/mcp`. Esta sesión no puede registrar ese servidor ni iniciar OAuth por herramienta. No proporcionar Access Tokens por chat.
6. Usar vendedor/comprador de prueba y medios oficiales de prueba. Ejecutar approved, pending→approved y rejected de punta a punta, comprobar notificaciones/recepción y reintentos concurrentes, y volver a auditar el HTTP de los assets del Preview desplegado. No usar dinero real.

## Puerta de producción (posterior; NO ejecutada)

- [ ] Contrato REST y evento/firma exactos comprobados en documentación oficial actual.
- [ ] Migración y permisos verificados en DEV; privacidad del RPC público get_appointment_payment_details revisada separadamente (se preservó para no romper sus consumidores existentes).
- [ ] Pruebas oficiales de pago completas; recuperación de Order expirada y notificaciones por canal resueltas/verificadas.
- [ ] Cuenta vendedora e ID receptor productivos identificados explícitamente.
- [ ] Credenciales productivas y Webhook/secret propios, separados de DEV.
- [ ] Return URLs y callback bajo https://kanibarber.com; dominio y assets verificados.
- [ ] Política de dinero recibido con turno cancelado/ocupado: hoy requiere revisión, no devuelve dinero automáticamente.
- [ ] Primera transacción real controlada autorizada por el usuario, conciliada en la cuenta correcta.
- [ ] Quality evaluation oficial, cuando esté disponible; si exige pago productivo, esperar autorización para esa transacción.

**NO LISTO PARA PASAR A LA ETAPA DE PRODUCCIÓN**
