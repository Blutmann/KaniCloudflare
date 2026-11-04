# KANI: cinco cuentas — validación del 4 de noviembre de 2026

Trabajo sobre `codex/kani-five-accounts-recovery`, continuando el original
`84a57a44f1a9166f2804517266a16d4849a65730`. Se conserva su historial.

Los commits `7e54e5d`, `700be99` y `0a667bd` se publicaron tras habilitar el
alcance `workflow` de GitHub. La ejecución remota de GitHub Actions
`41894549398` pasó instalación, 61 pruebas, SQL aislado y build. El preview de
Pages también pasó; producción conservó su despliegue anterior.

**Estado: implementación y pruebas en desarrollo. No se aplicaron migraciones,
no se enviaron invitaciones y no se desplegó producción**, conforme a la última
indicación del usuario. No se creó infraestructura permanente adicional.

## Funcionalidad implementada

| Capacidad | BARBER | MANAGER / KANI Jefe | ADMIN existente |
| --- | --- | --- | --- |
| Turnos y horarios | Propios | Todos | Todos |
| Registrar y editar cobros, descuentos e importe final | Propios | Todos | Todos |
| Baja lógica de cobros y clientes | No | Sí, auditada | Sí, auditada |
| Clientes | Fichas relacionadas, compartidas entre sus barberos | Todos | Todos |
| Estadísticas | Propias | Generales y por barbero | Generales y por barbero |
| Descuentos comerciales | Sin acceso | Solo lectura, incluyendo usos | Conserva administración |
| Mantenimiento y diagnósticos | Sin acceso | Sin acceso | Conserva acceso |

Los cobros usan Corte, Corte y barba, Barba, Otro y Anulado; admiten descuentos
fijos o porcentuales y conservan el descuento al cambiar servicio. Anulado tiene
importe cero y se excluye de ventas. Las señas se obtienen del turno: no pueden
forjarse, reducirse ni anularse desde el libro de cobros. La baja lógica es distinta
de la clasificación Anulado; ninguna de las dos ejecuta reembolsos externos.

RLS y RPC verifican identidad activa y barbero por UUID. Las relaciones duraderas
de clientes no conceden acceso a los cobros o turnos de otros barberos. Se agrega
auditoría protegida de operaciones. Se cierran accesos heredados a callbacks
internos y a la creación arbitraria de notificaciones. PayWay, Resend, Pontiun y
las credenciales de ADMIN se conservan; no hubo operaciones reales con proveedores.

## Evidencia técnica

- `pnpm install --frozen-lockfile --ignore-scripts`: satisfactorio.
- `pnpm run test:staff`: 61 pruebas satisfactorias, ocho archivos. Incluye
  permisos, cálculos, invitaciones, lecturas, formularios y límites del Worker.
- `pnpm run test:staff:sql`: satisfactorio. Aplica las tres migraciones en orden,
  cada una dentro de su propia transacción. PostgreSQL 17 temporal, datos
  sintéticos, sin red ni puertos; el contenedor se elimina al finalizar.
- SQL verifica cuatro barberos, MANAGER y ADMIN, denegaciones cruzadas,
  señas, descuentos, anulaciones, horarios, clientes compartidos, auditoría,
  vista pública sin datos privados y capacidades de notificación.
- `pnpm run build` y `wrangler deploy --dry-run` sobre la configuración generada:
  satisfactorios. El dry-run no publica el Worker.
- Suite general comparada con `84a57a4`: conserva exactamente los mismos
  **74 fallos preexistentes**, sin fallos adicionales. La ejecución comparada
  tuvo 1295 pruebas satisfactorias y 74 fallidas; después se agregaron otras
  13 pruebas satisfactorias del límite HTTP. No se declara la suite general verde.
- El chequeo TypeScript global conserva errores heredados; build satisfactorio
  no equivale a un chequeo global de tipos satisfactorio.

La recuperación del respaldo y sus propietarios/ACL ya estaba verificada:
31 roles, 25 membresías y privilegios de 165 objetos sin diferencias. No se
repitió esa investigación. Su evidencia y los dumps permanecen fuera de Git.

## CI y Cloudflare

Se fija `pnpm@12.14.0`, Node `24.20.0` y Wrangler `4.157.0`, junto con el lockfile.
El workflow `staff-validation.yml` valida instalación congelada, pruebas de
aplicación/SQL y build. No tiene pasos de despliegue ni secretos productivos.

El registro real del build `4ccb9de8-f6f9-4ec6-a7b3-96bd1d15fedd`, facilitado
por el usuario, confirma `ERR_PNPM_IGNORED_BUILDS` al instalar dependencias:
faltaba autorizar los scripts de `esbuild@0.28.2` y `workerd@1.20261103.1`.
La aplicación aún no había comenzado a compilar. Se autorizan únicamente esas
versiones en `pnpm-workspace.yaml` mediante `allowBuilds`. Se conserva la política
estricta para los demás paquetes.

El CI anterior usaba `--ignore-scripts` y por eso no detectó esta diferencia con
Cloudflare. Se elimina ese flag: ambos validarán `pnpm install --frozen-lockfile`.
La corrección se verifica mediante una nueva ejecución remota.
Referencia: [configuración oficial de pnpm](https://github.com/pnpm/pnpm/blob/main/pnpm/docs/settings/build.md).

El commit `1fa0cb5` confirmó en GitHub Actions que los dos scripts terminan
correctamente en Linux, y pasaron las 61 pruebas, SQL y build. El siguiente
registro real de Cloudflare (`84907e31-9912-4a52-a6f1-622dcbb6b841`) confirmó
también que el build pasó, pero `npx wrangler preview` rechazó la configuración
generada por no tener `previews`. Se añade un bloque vacío en `wrangler.jsonc`,
conservando los ajustes productivos y sin copiar variables de integraciones.
El workflow comprueba que Nitro conserve el bloque en su configuración generada.
Referencia: [configuración de Previews](https://developers.cloudflare.com/workers/previews/configuration/).

La configuración de Builds revisada por el usuario separa `main` (producción,
`pnpm run build`, `npx wrangler deploy`) de previews (`bun run build`,
`npx wrangler preview`). Conviene reemplazar **solo** el build de previews por
`pnpm run build`. No se modificó esa configuración desde esta sesión.

El fallo original `024eb004-9ac2-48c4-8923-706bfd676f70` sigue sin causa exacta
confirmada: la API de Builds rechaza el OAuth local y faltan las últimas líneas
del log solicitadas al usuario. `bun run build` invoca el mismo script; su presencia
no demuestra por sí sola la causa. La versión fijada de Wrangler admite `preview`.

Cloudflare documenta [previews por rama](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
y el uso de [packageManager para fijar herramientas](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/).
Una URL preview no demuestra aislamiento de Supabase ni de proveedores: no se
deben realizar reservas, cobros ni envíos reales desde ella para validar esta rama.

## Activación pendiente

El inventario de solo lectura encontró a Lautaro ya activo como BARBER con su
barbero correcto, y una cuenta ADMIN activa. Las otras cuatro identidades todavía
no se crearon. El script `scripts/invite-kani-staff.mjs` preserva identidades,
requiere los UUID existentes y un roster privado fuera de Git; su modo inicial
solo planifica. `--send` verifica migraciones, URL canónica, redirect permitido
y SMTP antes de enviar invitaciones individuales. No establece contraseñas comunes.

La activación `/activar-cuenta` permite a cada invitado definir su contraseña.
Las invitaciones se deben enviar después de publicar esa ruta y completar las
migraciones. Nunca guardar roster, contraseñas o claves privilegiadas en Git.

Para la entrega productiva posterior se debe coordinar el cambio de esquema y
el Worker compatible: las nuevas restricciones revocan escrituras directas del
libro de cobros. No aplicar solamente las migraciones dejando la interfaz antigua.
Quedan pendientes la activación real de cuentas y las comprobaciones funcionales
productivas; esta etapa se limita a implementación, preservación y validación.
