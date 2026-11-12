# KANI — Flujo de Integración y Previews Sin Regresiones

Este documento define el protocolo obligatorio para acumular mejoras aprobadas y evitar que un deployment experimental o de nueva funcionalidad reemplace correcciones previas.

## 1. Arquitectura de ramas

- `main`: versión estable actualmente en producción (`www.kanibarber.com`). No desarrollar directamente sobre `main`.
- `integration/stable-preview`: rama acumulativa de integración con **todas** las mejoras y correcciones aprobadas listas para convivir en un mismo Preview antes de pasar a `main`.
- `feat/*` / `fix/*`: ramas aisladas para una tarea puntual. **Deben crearse desde `integration/stable-preview`** (o incorporar sus cambios antes de publicar una Preview).

## 2. Regla anti-regresión antes de empezar cualquier tarea

1. Confirmar el commit base actual de `main` y de `integration/stable-preview`:
   ```bash
   git checkout integration/stable-preview
   git pull --ff-only # si aplica
   git rev-parse --short HEAD
   ```
2. Crear la nueva rama desde `integration/stable-preview`:
   ```bash
   git checkout -b feat/mi-funcionalidad integration/stable-preview
   ```
3. Si ya existía una rama creada desde `main` antiguo, integrar `integration/stable-preview` antes de compilar o subir Preview (resolviendo conflictos preservando ambas mejoras):
   ```bash
   git merge integration/stable-preview
   ```

## 3. Verificación obligatoria previa a cada `wrangler versions upload`

Antes de publicar una Preview:

1. Ejecutar el chequeo de integridad de base:
   ```bash
   node scripts/verify-integration-base.mjs
   ```
2. Ejecutar las suites de pruebas críticas:
   - Black Card: `npx vitest run src/test/kani-black-card-restoration.test.tsx`
   - Reservas: `npm run test:booking` y `npx vitest run src/lib/kani-booking-slots.test.ts src/test/kani-booking-ux-v2-slots-recovery.test.tsx`
3. Compilar (`npm run build`) y validar rutas críticas en navegador headless:
   - Black Card (`/membresia/01e736df8280409e92d2ba8d219fcac04a24297061e24918`): frente `VIP CLIENT`, reverso `PRIVATE PASS`, giro 3D, sellos kanji, historial y modal QR decodificable.
   - Reservas (`/reservar-turno` y `/reservar-turno-mercadopago`): franjas `Mañana` / `Tarde`, grilla responsive y recuperación `"Ese horario ya no está disponible"`.
   - Panel Admin (`/panel-administracion/*`) sin regresiones.
4. Registrar el Preview publicado en la tabla inferior con su **Commit** y **Worker Version ID**.

## 4. Registro de Previews y Versiones

| Fecha | Rama | Commit | Worker Version ID | Alias / URL Preview | Notas |
| --- | --- | --- | --- | --- | --- |
| 2026-11-11 | `main` (prod) | `e37b8e1` | `f74baba9-9698-4256-be8d-096885c19eed` | `www.kanibarber.com` | Baseline estable de producción |
| 2026-11-12 | `fix/restore-black-card` | `1e3fe4e` | `54deb27c-dd10-4d80-b5f8-efc0a9f696cd` | `restore-black-card` | Restauración aprobada de Black Card 3D + QR |
| 2026-11-12 | `feat/booking-slots-recovery` | `69f1cea` | `57a337d7-746d-4a0b-a205-d09943fa4e08` | `reserva-ux` | UX V2 horarios y recuperación (base `main`, sin `1e3fe4e`) |
| 2026-11-12 | `integration/stable-preview` | Ver historial git | Ver `wrangler versions list` | `stable-preview` | Integración de `69f1cea` + `1e3fe4e` |
