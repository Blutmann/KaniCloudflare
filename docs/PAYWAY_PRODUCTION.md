# Payway: operación en producción

La integración admite producción con el endpoint oficial
`https://ventasonline.payway.com.ar/api/v2`, publicado en el
[SDK oficial de Payway](https://github.com/payway-ar/sdk-javascript-ventaonline#ambientes).
Las referencias a un laboratorio exclusivamente Sandbox en `PAYWAY_V4.md`
documentan la etapa anterior.

## Configuración del Worker

El Worker existente `kanibarberstudio-cloudflare` sirve el sitio conectado.
El repositorio declara estas variables de runtime para evitar que un próximo
despliegue restaure Sandbox:

| Variable | Valor de producción |
| --- | --- |
| `PAYWAY_ENVIRONMENT` | `production` |
| `PAYWAY_PRODUCTION_ENABLED` | `true` |
| `PAYWAY_SANDBOX_ENABLED` | `false` |
| `PAYWAY_API_BASE_URL` | `https://ventasonline.payway.com.ar/api/v2` |

Configurar en Cloudflare como secretos `PAYWAY_PUBLIC_API_KEY`,
`PAYWAY_PRIVATE_API_KEY` y `PAYWAY_SITE_ID`, con los valores de **Credenciales de
Producción** del portal Payway. Configurar también `PAYWAY_CHECKOUT_SECRET`
con al menos 32 caracteres aleatorios. En producción no se admite el fallback
de sesión de Sandbox. No copiar valores secretos al repositorio ni a los logs.

`PAYWAY_PAYMENT_METHODS` conserva los medios configurados. El alta efectiva de
cada medio depende del comercio Payway; una configuración local no lo habilita
en el proveedor. El Template ID no interviene en la tokenización directa.

## Alcance y aislamiento

El cambio de entorno de Payway conserva la base existente
`iockpxtkflyjfagkvgnr`. **No migra Supabase ni convierte esa base de pruebas en
una infraestructura de producción separada.** El proyecto y los prefijos de
notificaciones mantienen su configuración actual.

El adaptador comprueba `provider_site_id` al cobrar o consultar un intento.
La conciliación programada también descarta intentos cuyo comercio no coincide
con el configurado, incluso al recuperar aprobaciones pendientes de confirmar.
Así, las credenciales productivas no se usan para consultar ni confirmar
intentos históricos del comercio Sandbox. Los intentos anteriores permanecen
en el registro para revisión; no se borran ni se recobran automáticamente.

## Verificación

Las pruebas automatizadas usan respuestas simuladas y comprueban los gates,
los endpoints, los importes, la exclusión por comercio y los cobros duplicados.
La compilación valida los bundles de servidor y navegador. Una consulta GET al
proveedor permite verificar autenticación sin cobrar; no acredita aprobación
de tarjetas ni certifica el flujo financiero completo. Un cobro real de prueba
debe realizarlo el titular desde el checkout y verificarse después en Payway y
en el turno correspondiente.

## Desactivar nuevos cobros

Establecer `PAYWAY_PRODUCTION_ENABLED=false` en el runtime y mantenerlo también
en el repositorio antes del siguiente build. No apuntar a Sandbox con claves
productivas. Antes de cambiar de comercio, revisar los pagos pendientes.
