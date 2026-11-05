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

- 104 pruebas de personal/permisos, 50 de reservas y 28 relacionadas con Horarios
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

Cambios conservados en `codex/kani-five-accounts-recovery`. La publicación del
Worker se realiza desde esa rama, tras validar CI, sobre el Worker existente.
No se envía `main` para evitar reactivar la cola histórica de migraciones de
Supabase pendiente de reconciliación. El despliegue no incluye migraciones.
