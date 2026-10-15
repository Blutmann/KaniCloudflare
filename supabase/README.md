# KANI — Supabase Fase 1

Esta carpeta contiene la configuración versionada de la infraestructura de datos de KANI Barber Studio.

## Incluido en esta fase

- PostgreSQL con tablas de barberos, perfiles internos, servicios, clientes, reservas y disponibilidad individual.
- Supabase Auth como identidad de usuarios internos.
- Roles `BARBER` y `ADMIN`.
- RLS para separar las agendas de cada barbero.
- Vista pública de slots disponibles sin exponer notas internas ni barberos inactivos.
- Panel administrativo conectado a `barber_availability_slots` para leer y actualizar disponibilidad real por fecha, hora y nota interna.
- Datos iniciales de los tres barberos y los tres servicios oficiales.
- Grilla individual de horarios estándar para los próximos 21 días al ejecutar la migración.
- Funciones de autorización basadas exclusivamente en `auth.uid()` y `staff_profiles`.

## No incluido todavía

- Creación pública de reservas reales.
- Protección transaccional final contra doble reserva.
- Emails.
- Cancelación pública.
- Reservas reales desde el panel y desde `/reservar`.

Esos elementos quedan para la Fase 2.

## Aplicar la migración

Con Supabase CLI y el proyecto enlazado:

```sh
supabase db push
```

La migración está en:

```text
supabase/migrations/20261006000100_kani_phase1_schema.sql
```

Para corregir el alcance de lectura de `barbers` después de una aplicación previa de Fase 1, también debe aplicarse:

```text
supabase/migrations/20261006000200_kani_barber_rls_isolation.sql
```

Esta migración deja la lectura pública de `barbers` exclusivamente en `anon`; los usuarios `authenticated` quedan sujetos a `staff_can_read_barbers`, que limita a BARBER a su propio `barber_id` y permite a ADMIN ver los tres.

No ejecutar cambios manuales equivalentes desde el dashboard: el repositorio debe seguir siendo la fuente reproducible del esquema.

## Variables de entorno

El frontend solo debe recibir:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

El cliente también acepta `VITE_SUPABASE_PUBLISHABLE_KEY` como alias compatible con el nuevo nombre de claves de Supabase. Si se usan ambos, tiene prioridad `VITE_SUPABASE_ANON_KEY`.

La service role key nunca debe comenzar con `VITE_`, nunca debe importarse desde componentes React y nunca debe enviarse al navegador.

No se agregan credenciales al repositorio. El archivo `.env` local debe permanecer fuera de control de versiones.

## Provisionamiento de usuarios internos

La migración **no crea usuarios Auth**, no contiene contraseñas y no tiene un trigger sobre `auth.users`.

Primero se crean explícitamente mediante Supabase Auth estas cuatro cuentas:

- Lautaro — `BARBER`.
- Gonzalo — `BARBER`.
- Valentín — `BARBER`.
- KANI Admin — `ADMIN`.

Después de crear cada cuenta, un proceso administrativo server-side debe insertar el perfil correspondiente en `public.staff_profiles` usando el UUID real de `auth.users` y el UUID real del barbero.

Ejemplo conceptual para un barbero, ejecutado únicamente en un contexto administrativo confiable:

```sql
insert into public.staff_profiles (user_id, role, barber_id, display_name)
values (
  '<UUID_AUTH_DE_LAUTARO>',
  'BARBER',
  (select id from public.barbers where name = 'Lautaro'),
  'Lautaro'
);
```

Ejemplo conceptual para ADMIN:

```sql
insert into public.staff_profiles (user_id, role, barber_id, display_name)
values ('<UUID_AUTH_DEL_ADMIN>', 'ADMIN', null, 'KANI Admin');
```

Los valores entre `<...>` son placeholders y no deben ejecutarse literalmente. No usar `raw_user_meta_data` como fuente de autorización. El rol efectivo siempre proviene de `staff_profiles`.

## RLS

- Un usuario `BARBER` solo puede leer o modificar sus propias disponibilidades y sus propias reservas.
- Un usuario `BARBER` solo puede leer su propio registro de `barbers`; ADMIN puede leer los tres.
- Un usuario `ADMIN` puede operar sobre los tres barberos, todas las disponibilidades y todas las reservas.
- Los visitantes pueden consultar barberos activos, servicios activos y la vista `available_barber_slots`.
- `internal_note` solo se encuentra en la tabla protegida y no forma parte de la vista pública.
- El rol `anon` recibe privilegios de lectura únicamente sobre las columnas públicas necesarias de disponibilidad; no puede leer `internal_note`.

## Vista pública

`available_barber_slots` utiliza `security_invoker = true`, filtra slots `AVAILABLE`, une únicamente barberos activos y expone solo:

```text
id, barber_id, slot_date, start_time, end_time, status
```

La tabla base revoca el `SELECT` completo para `anon` y otorga solo privilegios por columna pública. `internal_note` no está disponible para el usuario público.

## Verificación recomendada

Después de aplicar la migración y provisionar las cuentas:

1. Confirmar que existen tres filas en `public.barbers`.
2. Confirmar los servicios y sus valores: Corte 60/$25.000, Corte + barba 60/$30.000, Barba 30/$10.000.
3. Confirmar que existen cuatro filas explícitas en `public.staff_profiles`.
4. Probar una consulta con un usuario BARBER sobre el `barber_id` de otro barbero: debe devolver cero filas o rechazar la operación según la acción.
5. Probar la misma consulta con ADMIN: debe permitir las tres agendas.
6. Confirmar que `anon` puede consultar la vista pública, pero no `internal_note` ni las tablas sensibles.
7. Confirmar que la vista no devuelve slots de barberos con `active = false`.

La lista detallada de pruebas RLS se encuentra en `supabase/tests/README.md`.
