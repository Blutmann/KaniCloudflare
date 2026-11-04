# Corrección independiente de disponibilidad

La migración `20261104212939_kani_anonymous_availability_columns.sql` se puede
aplicar sobre el esquema productivo actual, sin las tres migraciones de cinco
cuentas y sin desplegar otro Worker. Solo ajusta permisos de lectura de
`barber_availability_slots`; no altera filas, políticas RLS, funciones, vistas,
usuarios, cobros ni integraciones.

La reserva pública usa `read_valid_availability_starts(uuid,date,date)`, una
función `STABLE SECURITY DEFINER` existente que no devuelve notas. La vista
actual publica únicamente seis columnas. Ambas definiciones se conservaron
íntegras en la prueba de compatibilidad, sin migrar a MANAGER ni clientes compartidos.

| Acceso | Antes, producción consultada | Después, prueba independiente |
| --- | --- | --- |
| anon: SELECT de toda la tabla / nota | Permitido | Denegado |
| anon: seis columnas públicas | Permitido | Permitido, con RLS |
| authenticated: lectura del personal | Permitido, con RLS | Sin cambios |
| PUBLIC: lectura de tabla / nota | Sin concesión | Sin concesión |
| RPC y vista de disponibilidad | Operativas | Resultados idénticos |

Se prueban además concesiones amplias por PUBLIC y permisos directos sobre la
nota, y una segunda aplicación de la misma migración. En todos los casos se
elimina el acceso anónimo, se conservan las filas y ADMIN sigue viendo sus datos.

Pasos para aplicar:

1. Confirmar el CI del commit que contiene el archivo y conservar el registro
   previo de ACL. Aplicar **solo esta migración**, dentro de una transacción y
   mediante el registro de migraciones. No usar un `db push` general: hay otras
   migraciones pendientes y esta no las necesita.
2. Comprobar `has_column_privilege('anon', 'public.barber_availability_slots',
   'internal_note', 'SELECT') = false`, ausencia de SELECT amplio para anon/PUBLIC
   y conservación de permisos authenticated y políticas RLS.
3. Comprobar con el cliente anónimo que el campo interno y `select=*` se deniegan,
   pero los seis campos públicos, la RPC y la vista funcionan. Verificar ADMIN.
4. Al retomar cinco cuentas, seleccionar las tres migraciones revisadas, teniendo
   en cuenta que la corrección puede figurar ya en el historial con una versión
   posterior. La secuencia completa también se prueba; no requiere revertir el parche.

El bloqueo de 5 segundos evita mantener una espera de locks indefinida; la
comprobación final aborta toda la transacción si otro permiso heredado permite
leer la nota. Reabrir el permiso anónimo amplio no es una vía de recuperación
recomendada. Los permisos anteriores quedan documentados para diagnóstico.
