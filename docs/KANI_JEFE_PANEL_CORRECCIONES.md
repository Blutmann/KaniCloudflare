# Correcciones del panel KANI Jefe

## Cambios

- Horarios: MANAGER y ADMIN pueden seleccionar las cuatro agendas existentes,
  incluida la agenda del diálogo de alta. Las lecturas, altas y bloqueos usan el
  UUID seleccionado. BARBER conserva exclusivamente su barbero. Se descartan
  respuestas tardías al cambiar de barbero o fecha, incluso tras un bloqueo pendiente.
- Navegación principal: cinco pestañas, Turnos, Horarios, Pagos, Clientes y Datos.
  La cuadrícula vuelve a tener cinco columnas y conserva el botón de actualizar.
  Las URLs existentes, incluida la de Inicio, siguen disponibles según permisos.
- Códigos: acceso de MANAGER desde el menú superior, sin sexta pestaña. BARBER no
  ve la opción ni puede abrir la pantalla o invocar su RPC. ADMIN conserva la
  administración desde Mantenimiento. Se conserva la URL anterior de descuentos.
- Tarjetas de lectura con superficies, bordes, tipografía y espaciado de
  Mantenimiento; tipo/valor, estado traducido, fechas argentinas, modalidad, usos
  y clientes/turnos en un detalle desplegable. Sin controles de modificación.
- La identidad del menú se refresca al abrirlo y cambiar de ruta. Se evita que
  una lectura anónima anterior o de otra sesión oculte o conserve opciones ajenas.
  El cierre de sesión usa el navegador del router correctamente.

## Validación

- 106 pruebas de personal/permisos, 50 de reservas y 28 relacionadas con Horarios
  y Mantenimiento satisfactorias. Pruebas SQL aisladas, build y Wrangler dry-run correctos.
- Navegador Edge local con respuestas Auth/SQL completamente sintéticas, bloqueando
  accesos reales: 360 y 1440 px, temas claro y oscuro; cinco columnas iguales,
  ancho del documento igual al viewport y ningún error de página. Se comprobó
  selección de los cuatro barberos, menú de MANAGER, URL denegada a BARBER y
  Mantenimiento disponible únicamente para ADMIN.
- Supabase productivo: prueba transaccional con los seis UUID reales, luego
  ROLLBACK. MANAGER creó/bloqueó/habilitó disponibilidad para los cuatro barberos.
  BARBER modificó su disponibilidad y recibió denegación al operar sobre otra;
  no pudo leer códigos. MANAGER leyó códigos pero no pudo crearlos ni modificarlos.
  ADMIN mantuvo acceso general. Los horarios de prueba no persistieron.
- Huellas de disponibilidad y códigos, y cantidad de utilizaciones, idénticas
  antes/después. No hacen falta migraciones ni cambios de políticas.
- La comprobación global de tipos conserva errores heredados ajenos a estos cambios;
  se corrigieron los diagnósticos nuevos de la implementación y pruebas añadidas.

No se modificaron reservas públicas, PayWay, Pontiun, Resend, credenciales,
usuarios ni registros históricos. Las pruebas de navegador no utilizaron
sesiones reales ni generaron reservas o cobros.

## Publicación

Cambios conservados en `codex/kani-five-accounts-recovery`: implementación
`692f3bd` y ajuste de fechas `e85db0b`.
[GitHub Actions de la versión publicada](https://github.com/Blutmann/KaniCloudflare/actions/runs/41954433330),
Cloudflare Preview y Pages finalizaron correctamente.

Se publicó manualmente el Worker existente desde esa rama, sin enviar `main`
ni reactivar la cola histórica de migraciones de Supabase. Versión productiva
`aa5d6c64-bf47-40d8-83f3-948a4cafd10c`, despliegue
`20f619fc-b97f-41d8-a872-5c5ef4309fcd`, activo al 100 %.
Nombres/tipos de bindings y todas las variables de texto coinciden con la copia
previa al despliegue; no se reemplazaron secretos ni credenciales.

Después de publicar se volvió a verificar el artefacto servido por
`www.kanibarber.com` en los mismos cinco escenarios de navegador con datos
sintéticos, bloqueando accesos de esos fixtures a la base y a proveedores reales.
No hubo desbordamientos ni errores de página. Inicio, reserva pública, Horarios
y Códigos responden HTTP 200; un endpoint administrativo sin sesión responde 401.

La comprobación final de Supabase conserva exactamente las huellas iniciales:
3.456 filas de disponibilidad, códigos y sus siete utilizaciones asociadas.
Siguen existiendo cuatro barberos y seis perfiles. No se aplicaron migraciones;
la corrección de disponibilidad anterior sigue registrada una sola vez.
El servidor local de validación quedó detenido.
