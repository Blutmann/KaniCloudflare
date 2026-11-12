# KANI — Flujo de Integración y Previews Sin Regresiones

Este documento define el protocolo obligatorio para acumular mejoras aprobadas y evitar que un deployment experimental o de nueva funcionalidad reemplace correcciones previas.

## 1. Arquitectura de ramas

- `main`: versión estable actualmente en producción (`www.kanibarber.com`). No desarrollar directamente sobre `main`.
- `integration/kani-consolidated`: rama acumulativa oficial con **todas** las mejoras aprobadas (Black Card 3D + Panel V2 3+3 + Reservas UX V2) listas para convivir antes de promover a `main`.
- `feat/*` / `fix/*`: ramas aisladas para una tarea puntual. **Deben crearse desde `integration/kani-consolidated`** (o incorporar sus cambios antes de publicar una Preview).

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
| 2026-11-12 | `feature/kani-panel-v2` | `112c2e1` | `e57c74f1-4fa1-4e3a-a649-662dfddba0d2` | `feature-kani-panel-v2` | Panel V2 3+3 + card Membresías restaurada |
| 2026-11-12 | `feat/booking-slots-recovery` | `69f1cea` | `57a337d7-746d-4a0b-a205-d09943fa4e08` | `reserva-ux` | UX V2 horarios y recuperación (base `main`, sin `1e3fe4e` ni `112c2e1`) |
| 2026-11-12 | `integration/kani-consolidated` | `3ea366e` | `d0b332b6-025b-47f5-8e1e-aa559b382846` | `kani-integrated` | Consolidación de `1e3fe4e` + `112c2e1` + `69f1cea` |
| 2026-11-12 | `main` (prod) | `a17bca3` | `d0b332b6-025b-47f5-8e1e-aa559b382846` | `www.kanibarber.com` | Despliegue definitivo consolidado (rollback anterior: `f74baba9` / `60943f5c`) |
| 2026-11-12 | `main` (prod) | `4044956` | Cloudflare Build | `www.kanibarber.com` | Exclusión pública de Franco y eliminación de barra contextual en paso Horarios |
| 2026-11-12 | `main` (prod) | `372d52e` | Cloudflare Build | `www.kanibarber.com` | Eliminación de checkmark en horario seleccionado y fondo sólido (#ffffff / #242424) en horarios disponibles |
| 2026-11-12 | `main` (prod) | `7036c01` | Cloudflare Build | `www.kanibarber.com` | Banderas SVG de alta resolución en selector y listado de país (compatible multiplataforma) |
| 2026-11-12 | `main` (prod) | `e8b9f4d` | `377eaa12-4618-42ec-b6ae-37f0c71ae099` | `www.kanibarber.com` | Baseline previo a Liquid Glass V4 (disponible para rollback) |
| 2026-11-12 | `feat/booking-liquid-glass` | `91a8b48` | `fd27acbf-5969-4ec4-8eca-c259f4cbb97c` | `feat-booking-liquid-glass` Preview | Liquid Glass V4 (`/reservar-turno-liquid`) |
| 2026-11-12 | `main` (prod) | `ddff21b` | `4f6a5aeb-327d-495e-9472-d1d7f3a348ba` | `www.kanibarber.com/reservar-turno-liquid` | Integración Liquid Glass V4 en `main` (ruta independiente `/reservar-turno-liquid`; rutas tradicionales, Black Card, Panel V2 y pagos intactos; `verify-integration-base.mjs` 5/5 + `pnpm build` OK) |
