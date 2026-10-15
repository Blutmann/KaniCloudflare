# Pruebas RLS de KANI — Fase 1

## Estado

No se agregan usuarios Auth ni contraseñas a la migración. Por esa razón, las pruebas de aislamiento BARBER/ADMIN requieren un proyecto Supabase con las cuatro cuentas internas provisionadas y sus cuatro filas en `public.staff_profiles`.

El entorno de inspección no tiene Supabase CLI, PostgreSQL ni pgTAP disponibles, por lo que no se ejecutaron pruebas remotas en esta fase.

## Pruebas automatizables después del provisionamiento

Con el proyecto enlazado y pgTAP disponible:

```sh
supabase test db
```

Deben cubrirse como mínimo estos casos:

1. BARBER A puede leer sus propias reservas.
2. BARBER A no puede leer reservas de BARBER B.
3. BARBER A puede modificar su disponibilidad.
4. BARBER A no puede modificar disponibilidad de BARBER B.
5. ADMIN puede leer reservas de los tres barberos.
6. ADMIN puede modificar disponibilidad de los tres barberos.
7. `anon` no puede leer `appointments`.
8. `anon` no puede leer `clients`.
9. `anon` no puede leer `staff_profiles`.
10. `anon` no puede leer `internal_note`.
11. La vista pública no devuelve `internal_note`.
12. La vista pública no devuelve slots de barberos inactivos.

## Verificaciones manuales reproducibles

Hasta que se agreguen fixtures de Auth al entorno de pruebas, ejecutar estas comprobaciones con dos sesiones autenticadas distintas y una sesión anónima:

### BARBER A

- Consultar `appointments`: solo deben aparecer filas cuyo `barber_id` sea el del perfil de A.
- Intentar actualizar o eliminar un slot cuyo `barber_id` sea el de B: debe afectar cero filas o devolver error.
- Consultar `barber_availability_slots`: no debe aparecer la agenda de B.

### ADMIN

- Consultar `appointments`: debe ver las agendas de A, B y C.
- Actualizar un slot de cualquiera de los tres barberos: debe permitirse.
- Consultar la tabla base de disponibilidad: puede ver `internal_note`.

### ANON

- Consultar `barbers`: solo barberos `active = true`.
- Consultar `services`: solo servicios `active = true`.
- Consultar `available_barber_slots`: solo slots `AVAILABLE` de barberos activos y solo las seis columnas públicas.
- Intentar seleccionar `internal_note` desde `barber_availability_slots`: debe fallar por privilegios.
- Intentar consultar `appointments`, `clients` o `staff_profiles`: debe devolver cero filas o error de permisos.

## Nota sobre doble reserva

La protección contra solapamientos no forma parte de estas pruebas de Fase 1. Se implementará en Fase 2 mediante una operación transaccional y la estrategia de locking/exclusion constraint que se defina al conectar `/reservar`.
