# Reserva V4 — laboratorio Payway

`/reserva-v4` reutiliza la presentación compacta de cuatro pasos (Servicio, Barbero,
Fecha/Hora y Datos con resumen económico). El callback de pago es optativo: las
rutas anteriores conservan Mercado Pago y no pasan por Payway.

## Estado de esta entrega

**No se pueden ejecutar cobros todavía.** La ruta y sus estados de pago pueden
evaluarse, pero el entorno desplegado devuelve “pago no habilitado” antes de
solicitar una tarjeta o crear un turno. Faltan credenciales Sandbox (solicitud
Payway `03832836`) y autorización para una persistencia separada de intentos.
Configurar las claves por sí solo **no** habilita cobros. No existe modo mock
activable por URL/variable ni selección de producción.

Los flujos de tokenización, procesamiento y confirmación se verifican con tests
aislados que inyectan un registro simulado y respuestas HTTP sintéticas. No son
pruebas transaccionales Sandbox ni certificación PCI.

## Integración preparada

- Frontend: contrato REST oficial `POST /api/v2/tokens` directamente a Payway.
  PAN/CVV permanecen en inputs no controlados y en esa petición; no se almacenan,
  envían al Worker ni incluyen en errores. Se limpian al terminar cada intento.
  Se utiliza el `id` y `bin` de la respuesta documentada, no el ejemplo ambiguo
  `token` del README JavaScript. No se instala ningún SDK Node.
- Backend: funciones POST de TanStack Start `preparePaywayCheckoutFn` y
  `payPaywayDepositFn`, con validación estricta. El adaptador HTTP usa únicamente
  `POST /api/v2/payments` con clave privada, JSON y `redirect: error`.
- Únicos destinos permitidos: los dos hosts Sandbox publicados por Payway,
  `https://developers-ventasonline.payway.com.ar/api/v2` y
  `https://developers.decidir.com/api/v2`. El operador debe seleccionar el vigente;
  ningún valor enviado por el navegador elige el destino del Worker.
- El backend convierte el importe del appointment guardado a centavos (ejemplo:
  $5.000 → 500000), compara el snapshot del intento y el precio del servicio.
  El input del navegador no admite un importe, estado, URL ni datos de tarjeta.
- Identificador comercial: `KANI` + UUID del intento sin guiones (36 caracteres
  alfanuméricos). Su relación con el appointment debe guardarse en el registro
  durable, sin depender de nombres/contactos ni concatenar dos UUID completos.
- Sólo respuesta servidor-servidor `approved`, con ID, referencia, comercio,
  importe y moneda coincidentes, permite invocar la confirmación atómica.
  Un turno vencido/cancelado o una colisión no deben confirmarse aunque se cobró.
- Rechazo explícito `rejected`: estado UX y contrato cubierto por fixture
  sintética; confirmar el esquema exacto de rechazos/envelopes con Payway al
  habilitar Sandbox. Cualquier respuesta que no coincida íntegramente con el
  contrato queda indeterminada y no habilita un nuevo cobro automático.
- Timeout, respuesta incompleta, error de red o fallo al persistir/confirmar:
  resultado indeterminado, sin reintentos HTTP y sin confirmación ficticia.
  La pantalla impide volver a pagar y pide contactar al estudio.
- Un rechazo consume el intento; se requiere uno nuevo autorizado por servidor.
  Doble click se bloquea con refs antes de cualquier `await`; la protección entre
  sesiones/Workers depende del claim durable, nunca de un `Map` en memoria.
- No se implementó webhook ni se reutilizó el de Mercado Pago. La reconciliación
  automática queda pendiente de las respuestas oficiales sobre timeout y
  visibilidad de consultas. No se presupone idempotencia de Payway.

## Configuración necesaria (sin valores secretos)

`PAYWAY_ENVIRONMENT=sandbox`, `PAYWAY_API_BASE_URL`, `PAYWAY_PUBLIC_API_KEY`,
`PAYWAY_PRIVATE_API_KEY`, `PAYWAY_SITE_ID`, `PAYWAY_PAYMENT_METHODS`.
La última es un array JSON de `{id, label}` de medios oficialmente habilitados
para Kani; no se supone que todas las tarjetas usan el mismo ID.
El servidor exige `SUPABASE_URL` del proyecto de pruebas autorizado.
La privada será exclusivamente secret del Worker; la respuesta pública incluye
sólo la pública y los datos necesarios del checkout. No se usan prefijos `VITE_`
para estas credenciales. `PAYWAY_TEMPLATE_ID` no se utiliza hasta aclaración.

## Persistencia mínima propuesta — pendiente de aprobación

El modelo actual `appointment_payment_orders` admite una sola orden por turno y
la confirmación actual valida contra esa orden de Mercado Pago. No se reutiliza
ni modifica para Payway. Tampoco se guardan intentos en notas del turno.

Se propone una tabla independiente `payway_payment_attempts` con:

- `id` UUID PK, `appointment_id` FK, `site_transaction_id` único;
- `checkout_capability_hash` (secreto aleatorio de alta entropía, nunca el valor
  público en claro), expiración y vínculo a la sesión de reserva;
- importe esperado en centavos, moneda, Site ID, fechas;
- estado `PREPARED/PROCESSING/APPROVED/REJECTED/UNKNOWN`, ID Payway único, resultado
  de confirmación, sin PAN/CVV/token de pago ni cuerpos crudos del proveedor;
- índice único parcial por appointment para excluir intentos activos,
  indeterminados o aprobados hasta resolución explícita;
- acceso sólo backend (RLS y sin permisos anon/authenticated);
- RPCs atómicas de preparación/claim/finalización/confirmación. La confirmación
  vuelve a comprobar disponibilidad, expiración y pago vinculado, bloquea las
  filas y coordina con los pagos existentes para evitar doble confirmación o
  cobros simultáneos de distintos proveedores. Crear notificación sólo en una
  transición real, sin cambiar contratos de Mercado Pago.

La preparación debe resolver servicio/barbero e importe desde datos reales,
crear/reutilizar el appointment bajo exclusión de concurrencia y entregar una
capacidad de checkout limitada. Un `appointmentId` conocido no basta como permiso.
El registro debe permitir recuperar el mismo estado tras recarga/desconexión;
no habilitar otro intento si hay uno indeterminado. Un rechazo sí puede admitir
un nuevo intento, preservando su historial y el appointment.

`PaywayStore` expresa este contrato; `runtimePaywayService()` deja `store: null`
deliberadamente. Hay que implementar y verificar ese adaptador **después** de
aprobar/aplicar el modelo. No se crearon ni ejecutaron migraciones en esta entrega.
No presentar la integración como lista para cobrar sólo agregando credenciales.

## Pendientes antes de una transacción Sandbox

1. Autorizar el modelo, implementar el adaptador y probar concurrencia real y
   coexistencia con Mercado Pago; aprobar migración por separado.
2. Recibir credenciales Sandbox, confirmar host/CORS, vertical, medios,
   requisitos PCI/Cybersource/3DS y esquema de rechazos del comercio.
3. Confirmar TTL/consumo del token, duplicados de `site_transaction_id`, consulta
   tras timeout y políticas de reconciliación/webhook. No agregar reintentos a ciegas.
4. Verificar escenarios transaccionales oficiales: aprobado, rechazado,
   desafío si corresponde, timeout y recuperación, turno vencido y concurrencia.

## Verificación de esta entrega

Build verificado. Pruebas específicas de tokenización, importe, aislamiento,
doble click, concurrencia simulada, aprobación, rechazo y timeout; regresión de
Mercado Pago y V2/V3. La revisión visual cubrió los cuatro pasos en Light/Dark a
360, 375, 390, 430, 1024, 1280, 1440 y 1920px (64 combinaciones), con datos
interceptados, sin mutaciones ni llamadas transaccionales. No se encontró el
nombre del secret privado Payway ni el valor privado ficticio de tests en el
bundle público.

La suite completa encontró cuatro fallos preexistentes, reproducidos exportando
el `main` base a un directorio aislado: estadísticas, estilos de turnos manuales,
expectativa de política RLS y enlace Google Maps. La comprobación TypeScript
global también tiene errores previos; los archivos nuevos no agregan errores.

## Fuentes oficiales de Fase A

- [Tokenización REST](https://documentacion-ventasonline.payway.com.ar/docs/gateway/kwjgnhga0lvam-solicitud-de-token-de-pago).
- [Pago simple REST](https://documentacion-ventasonline.payway.com.ar/docs/gateway/kvgxym8hia78m-ejecucion-del-pago).
- [PHP vigente y Anexo A HTTP](https://documentacion-ventasonline.payway.com.ar/docs/sdk-s/ddw69qltg92u5-1-introduccion).
- [Listado por referencia](https://documentacion-ventasonline.payway.com.ar/docs/gateway/gg5j8yphig0pp-listado-de-pagos).
- [Headers y timeout](https://documentacion-ventasonline.payway.com.ar/docs/gateway/itrpj3n8p8t27-glosario-general).

No se realizaron transacciones ni se modificaron Mercado Pago, V1/V2/V3,
Supabase, importes, emails ni credenciales reales. El entorno de prueba se
identifica por su Worker/Supabase, no por el nombre “production” que Cloudflare
puede usar para la rama principal de ese Worker de pruebas.
