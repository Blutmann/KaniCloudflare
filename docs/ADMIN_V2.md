# Admin V2 — primera evaluación

## Alcance

Rutas independientes: `/admin-v2` redirige a `/admin-v2/inicio`, con Inicio,
Turnos, Horarios, Pagos, Clientes y Datos. Las rutas actuales y `/reservar` no
se reemplazan. Solo se aplican los tres ajustes visuales solicitados al Admin
anterior: encabezados de Datos/Pagos y alineación monetaria.

La V2 se habilita únicamente cuando el cliente apunta a Supabase
`iockpxtkflyjfagkvgnr` y se abre desde el Worker de pruebas o localhost.
Esto es una protección adicional de interfaz; los permisos reales siguen
dependiendo de Supabase Auth, RLS y las funciones autorizadas existentes.

## Información y operaciones existentes

- Se reutilizan autenticación de personal, consultas de turnos, servicios,
  pagos, directorio `clients`, formato argentino y zona horaria del negocio.
- Turnos utiliza las RPC y notificaciones existentes, con confirmación antes
  de confirmar/cancelar. No se agrega gestión nueva de inasistencias.
- Horarios reutiliza el componente autorizado existente, incluyendo filtros,
  indicador circular y horarios extraordinarios. No se modifica ese componente.
- Pagos utiliza exclusivamente `record_service_payment`, sin insertar por otra
  vía después de un error. La RPC toma la fecha/hora del servidor y evita
  duplicar un cobro asociado al mismo turno. No se confunde el saldo cobrado
  en el local con el importe del servicio o una seña anterior.
- Datos compara períodos completos de igual longitud. No se generan porcentajes
  con base cero ni se presenta un heatmap de ocupación sin un historial adecuado.

## Clientes: funcional y propuesto

Las fichas reales se consultan bajo RLS. El historial se relaciona únicamente
por `appointments.client_id` y `service_payments.appointment_id`, nunca por
coincidencia de nombre. Las visitas no se duplican al tener tanto turno
completado como cobro. El gasto mostrado es el valor de cobros vinculados,
no una estimación de todos los servicios históricos.

Alta, edición y archivo son una propuesta en memoria identificada en la UI.
No se escriben en Supabase. Los borradores no se ofrecen como clientes
persistentes en Pagos. Los cobros sin turno pueden guardar nombre/contacto,
pero todavía no crean una relación permanente con `clients`.

BARBER consulta fichas relacionadas con sus atenciones mediante la política
existente. Las métricas de su ficha usan únicamente su historial autorizado.
No se ofrece eliminación definitiva. El archivo local conserva los turnos.

## Hallazgos del entorno de pruebas, sin reparar

El 22/10/2026 se verificó que las 57 versiones del ledger coinciden con los
archivos locales. Eso **no demuestra que el esquema coincida**: una consulta
de `information_schema.columns` encontró que `appointments` solo conserva las
columnas base y `request_number`; faltan, entre otras, `deposit_paid`,
`deposit_amount_ars` y las extensiones de atención que espera el código.

La V2 detecta si puede consultar la seña. Si falta esa información, muestra
«Sin dato verificable» y bloquea el cobro con turno. No considera una seña
desconocida como no pagada. El precio sugerido procede del catálogo actual,
ya que `appointments` no contiene un snapshot histórico del precio.

Esta entrega no modifica el ledger ni aplica migraciones para resolverlo.
La compatibilidad del esquema debe resolverse en la tarea independiente
antes de probar operaciones que dependan de las columnas ausentes.

## Siguiente etapa de modelo, sin ejecutar

1. Conservar `clients` como entidad global de Kani. No crear `customers` en
   paralelo. Mantener `appointments.client_id`.
2. Agregar `service_payments.client_id` nullable con FK a `clients` e índice.
   Rellenar solo desde `appointment_id → appointments.client_id`. Los pagos
   anónimos quedan en null; no vincular por nombre ni por teléfono ambiguo.
3. Agregar archivo (`archived_at`, `archived_by`) y, si corresponde,
   `created_by_user_id` para autorizar clientes creados sin historial. Definir
   reglas de relación por atención o creación antes de habilitar edición BARBER.
4. Diseñar RPC de alta/edición autorizada y normalización de teléfonos con
   `libphonenumber-js`. Buscar coincidencias y pedir resolución de ambigüedades;
   no imponer unicidad de teléfono sin revisar números compartidos.
5. Una futura fusión debe ser transaccional, ADMIN, auditable y conservar pagos
   y turnos. Proteger relaciones con restricciones apropiadas; evitar borrados
   en cascada del historial financiero.
6. Guardar snapshots de precio, descuento y duración al reservar, para no
   reconstruir precios históricos con el catálogo actual. Registrar actor y
   motivo de cancelación como hechos nuevos, sin inventarlos para el pasado.
7. Consultar capacidades reales de los estados antes de habilitar cambios
   nuevos de NO_SHOW. No se agrega ningún valor de enum en esta entrega.
8. Métricas derivadas en consultas/vistas autorizadas: no almacenar visitas,
   frecuencia, gasto o barbero habitual en la ficha. Incorporar paginación
   explícita antes de crecer más allá de los límites de respuesta de PostgREST.

## Publicación

### Verificación local

- Build de cliente y Worker: correcto.
- 22 pruebas nuevas: aislamiento Preview, alcance de roles, cálculo de cobros,
  relaciones de clientes, bloqueo de seña desconocida, errores de cobro y rutas
  paralelas. Todas correctas.
- Suite completa: 278 correctas de 281. Los mismos tres fallos se reproducen en
  un archivo limpio del commit base: expectativa de grilla manual, límite de
  semana en estadísticas y comparación literal LF/CRLF de una política SQL.
- El chequeo de tipos del proyecto tiene errores anteriores. Se reparó un
  cierre de llave faltante en los tipos Supabase para poder ejecutarlo; no se
  amplió esta tarea a corregir tipos de componentes antiguos.
- Navegador local con respuestas controladas, sin escribir en Supabase:
  seis módulos × dos roles × cinco anchos (360, 375, 390, 430, 1280), sin
  overflow horizontal. Esto valida la interfaz y no sustituye una sesión
  autenticada real BARBER contra el backend.
- Políticas RLS actuales de `appointments`, `clients`, `service_payments` y
  disponibilidad inspeccionadas en el proyecto de pruebas. No se cambiaron.
- `/reservar` y los componentes de turnos/disponibilidad anteriores no se
  modifican. El Admin mantiene sus rutas y funcionalidades existentes.

No asumir que un push a `main` es inocuo: GitHub registra Workers Builds para
`kanibarberstudio-cloudflare`, pero todavía hay que revisar en Cloudflare:

- repositorio y rama de despliegue;
- comando de build/deploy y Worker objetivo;
- dominios/rutas: exclusivamente la URL de pruebas, sin `kanibarber.com`;
- variables de build y runtime: Supabase Pruebas y `KANI_ENVIRONMENT=DEV/PREVIEW`;
- comportamiento de las otras ramas y de los previews.

Hasta verificar esos puntos, no publicar ni hacer push a una rama que pueda
activar un despliegue. La ausencia de GitHub Actions no implica ausencia de
automatización: la integración de Cloudflare funciona como aplicación GitHub.
