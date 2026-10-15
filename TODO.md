# TODO — Mantenimiento en Preview

## Implementar la sección Mantenimiento protegida por ADMIN

Agregar una ruta y sección `Mantenimiento` visible exclusivamente para usuarios autenticados con perfil activo `ADMIN`; los usuarios `BARBER` y no autenticados no deben verla ni acceder a ella mediante URL o llamada directa. Mantener el diseño actual, temas claro/oscuro, tipografía Zen Antique, navegación y flujo normal de reservas.

## Implementar selección, reautenticación y confirmación irreversible

Permitir seleccionar individualmente `PENDING`, `CONFIRMED`, `COMPLETED` y `CANCELLED`, uno, varios o todos; impedir la ejecución sin estados seleccionados; explicar el alcance y las entidades que se conservarán; solicitar la contraseña actual del administrador sin almacenarla ni enviarla a servicios propios; volver a verificar sesión y perfil ADMIN; mostrar una confirmación final explícita; cancelar cualquier paso sin modificar datos; usar la etiqueta `Eliminar registros`.

## Implementar RPC transaccional y auditoría append-only en Preview

Crear exclusivamente en el proyecto Supabase Preview `iockpxtkflyjfagkvgnr` una función controlada `admin_cleanup_appointment_records` que verifique `auth.uid()`, perfil activo ADMIN y rechace BARBER/no autenticados incluso por invocación directa; revocar ejecución a PUBLIC y anon y concederla solo a authenticated; usar `SECURITY DEFINER` con `search_path` seguro, lock de concurrencia y rollback completo ante errores; eliminar solo los estados recibidos, sus notificaciones administrativas vinculadas y sus eventos de email; conservar clientes, Auth, perfiles, roles, barberos, servicios, disponibilidad y notas, datos de transferencia, notificaciones de disponibilidad, secuencia, configuración, RLS, triggers y funciones existentes; no usar TRUNCATE ni reiniciar la secuencia; registrar actor, fechas, estados, resultado y cantidades sin datos personales en una tabla protegida contra cambios desde el cliente.

## Actualizar tipos, rutas y manifest sin alterar reservas

Agregar los tipos Supabase de la tabla y RPC, integrar la sección en el panel ADMIN, declarar `/admin/mantenimiento` en `public/manus-routes.json` y no modificar `/reservar`, el envío de emails ni la configuración de Production.

## Validar exclusivamente en Preview

Probar con datos sintéticos controlados en `iockpxtkflyjfagkvgnr`: acceso ADMIN, rechazo BARBER/no autenticado, contraseña incorrecta, cancelación, selección individual/múltiple/todos, eliminación de notificaciones y eventos relacionados, preservación de entidades maestras y disponibilidad, secuencia no reiniciada, rollback ante errores, exclusión mutua, auditoría sin PII y ausencia de envíos reales; no publicar Production ni ejecutar migraciones allí.


## Implementar historial de disponibilidad independiente

Agregar en `/admin/mantenimiento` una sección titulada `Historial de disponibilidad` con el texto `Eliminá las notificaciones históricas de horarios bloqueados y liberados. Esta acción no modifica la disponibilidad actual de los barberos`, contador actualizado, botón `Eliminar notificaciones de disponibilidad`, confirmación con cantidad e irreversibilidad, resultado de cantidad eliminada o error, y estado vacío con botón deshabilitado cuando el contador es cero. La acción solo podrá ejecutarse tras confirmación explícita de un ADMIN; no se ejecutará automáticamente.

Crear en Preview una operación backend transaccional y protegida que verifique perfil ADMIN activo, rechace anónimos/BARBER, utilice `SECURITY DEFINER`, `search_path` seguro, privilegios explícitos y lock de concurrencia, y elimine únicamente eventos `AVAILABILITY_UNAVAILABLE` y `AVAILABILITY_AVAILABLE`. Mantener intactos horarios reales, reservas, clientes, usuarios, perfiles, barberos, servicios, transferencias, notificaciones de turnos, secuencias, RLS ajenas, funciones ajenas y Resend. Registrar únicamente metadatos mínimos de la operación. No usar `TRUNCATE`, no borrar la tabla completa, no modificar Production ni publicar.


## Dashboard visual de demanda y estadísticas

Implementar exclusivamente en Preview un dashboard visual, moderno y útil dentro del panel ADMIN, sin publicar ni desplegar a Production ni activar publicación automática.

- Mostrar tarjetas dependientes del período seleccionado para turnos solicitados, confirmados, pendientes, cancelados y tasa de confirmación.
- Definir y documentar la tasa de confirmación de forma consistente; evitar porcentajes engañosos cuando el denominador sea cero y mostrar estado sin dato cuando corresponda.
- Mostrar comparación con el período anterior equivalente únicamente cuando existan datos suficientes.
- Implementar un gráfico de barras por día de la semana, de lunes a sábado, diferenciando turnos solicitados y confirmados con etiquetas, valores, leyenda y tooltips; no inventar datos.
- Agregar filtros Esta semana, Últimos 30 días, Este mes y rango personalizado compatible con la estructura existente; actualizar indicadores y visualizaciones de forma coherente.
- Permitir desglose por barbero cuando corresponda, respetando que un BARBER solo vea sus propios datos y que un ADMIN pueda ver los barberos autorizados.
- Agregar una visualización secundaria por día y franja horaria que distinga turnos confirmados, pendientes, horarios disponibles y horarios bloqueados.
- No contar disponibilidad como reserva ni interpretar automáticamente un horario bloqueado como falta de demanda; las oportunidades comerciales deben presentarse como potenciales, sin descuentos automáticos ni cambios de precios.
- Utilizar datos reales de Supabase, respetar las fuentes existentes, fechas y zonas horarias, evitar duplicados y no exponer nombres, emails ni teléfonos de clientes en gráficos agregados.
- Mantener RLS, autenticación, permisos administrativos, lógica de reservas, disponibilidad, depósitos, notificaciones y Resend sin cambios.
- Verificar totales contra los registros de origen, filtros, estados vacíos, desktop/mobile y rechazo de acceso administrativo para usuarios sin permisos.
- Ejecutar TypeScript, tests y build; dejar identificado cualquier caso que no pueda probarse por falta de datos reales.


## Coordinar Header, NavBar y Footer en desktop

Implementar exclusivamente en Preview una composición donde Header, NavBar y Footer estén coordinados: Header fijo arriba; contenido con scroll normal; NavBar de reservas fija a ancho completo; Footer fijo inmediatamente debajo de la NavBar, sin solapamientos ni pérdidas de accesibilidad. Mantener la NavBar en `position: fixed`, sus botones y lógica sin cambios, conservar fondo opaco y temas claro/oscuro, evitar que el contenido principal quede oculto y preservar mobile. Verificar los seis pasos, desplazamiento, footer completo, enlaces, alturas variables y ausencia de cambios en reservas, disponibilidad, Supabase, autenticación o Resend. No publicar Production ni activar publicación automática.


## Simplificar y equilibrar el footer

Modificar exclusivamente el diseño y la distribución del footer. En desktop mostrar en el bloque izquierdo únicamente `San Isidro Labrador 7, Martínez, Provincia de Buenos Aires` y `Lunes a sábados de 10:00 a 20:00 hs`, preferentemente cada uno en un solo renglón cuando el ancho lo permita. En el bloque derecho mantener Contacto hacia `https://kanibarber.com/estudio`, Ver ubicación hacia el enlace exacto de Google Maps existente, Instagram hacia `https://www.instagram.com/kanibarberstudio/` y `© 2026 Kani Barber Studio`; preferir los tres enlaces en una sola fila y el copyright debajo, permitiendo wrapping seguro si el ancho no alcanza. Mantener dos columnas equilibradas, tipografía, colores, enlaces funcionales e identidad visual; no agregar información nueva. En mobile adaptar las columnas sin superposición ni scroll horizontal y mantener todos los enlaces accesibles. Verificar visualmente desktop/mobile, temas claro/oscuro, enlaces, TypeScript, tests y build. No modificar Header, NavBar, reservas, panel, Supabase, Auth, disponibilidad, notificaciones ni Resend. Publicar solo este cambio si todas las validaciones son satisfactorias.


## Panel móvil de gestión de turnos — Preview

Crear una ruta independiente para el panel móvil, accesible únicamente a usuarios autenticados y autorizados, sin modificar ni reemplazar el panel administrativo actual, `/reservar`, Supabase, RLS, autenticación, disponibilidad, notificaciones ni Resend; no duplicar tablas, reservas ni lógica de negocio.

- La interfaz debe ser mobile-first, de una sola columna, con desplazamiento exclusivamente vertical, sin scroll horizontal, tipografía legible, jerarquía clara y controles cómodos para usar con una mano.
- Mostrar la agenda del día, la fecha seleccionada y un resumen de turnos por estado.
- Permitir consultar y filtrar Pendientes, Confirmados, Cancelados y Completados; los cancelados deben permanecer visibles en el historial.
- Cada tarjeta debe mostrar horario, cliente, servicio y duración, estado y acciones correspondientes; teléfono, email y notas solo deben aparecer al abrir el detalle.
- Incluir selector de fecha y filtro por estado; el filtro por barbero solo debe estar disponible para ADMIN.
- Pendiente: permitir confirmar o cancelar/rechazar respetando las transiciones existentes. Confirmado: permitir consultar, marcar como completado y cancelar según las reglas actuales. Cancelado y Completado: permitir consultar el detalle sin acciones que reactiven o alteren accidentalmente el historial.
- Reutilizar la fuente de datos y operaciones existentes; los cambios deben reflejarse en el panel actual sin duplicar registros y sin agregar emails ni notificaciones nuevas.
- BARBER solo puede consultar y gestionar turnos de su propio `barber_id`, incluidos los cancelados. ADMIN puede consultar y gestionar los tres barberos. La separación debe depender de la autenticación/RLS además de los filtros visuales.
- Verificar en Preview el panel actual, autenticación, roles, cuatro estados, cancelados, acciones, fuente compartida y responsive en iPhone/Android; no crear datos destructivos o ficticios.


## Ajustes de navegación y UI del panel móvil — Preview

- Agregar en el panel ADMIN existente un acceso visible con texto `Panel móvil de turnos` hacia `/admin/movil`, únicamente para perfiles ADMIN; conservar el guard de autenticación existente y no reemplazar el panel actual.
- Reducir moderadamente padding, altura y espacios internos de las tarjetas Pendientes, Confirmados, Cancelados y Completados; conservar contadores, colores, jerarquía, legibilidad y responsive sin alterar cálculos.
- Alinear visualmente el calendario de Fecha y las flechas de Estado/Barbero; agregar espaciado interno adecuado en los controles sin cambiar opciones, lógica ni componentes.
- Mantener el alcance exclusivamente en Preview; no modificar autenticación, Supabase, RLS, estados, operaciones de negocio, reservas públicas, Resend ni notificaciones; no publicar Production.
- Validar acceso ADMIN, ausencia del enlace para perfiles no ADMIN, filtros intactos, menor ocupación visual, responsive y ausencia de scroll horizontal; ejecutar TypeScript, tests y build.


## Corregir turnos faltantes en el panel móvil — Preview

- Comparar consultas, tablas, filtros por fecha/estado/barbero, estados, zona horaria, permisos y postfiltrado entre `/admin` y `/admin/movil`, sin modificar la base sin evidencia.
- Corregir la causa exacta para que la fecha inicial no oculte turnos legítimos: una fecha vacía representa ausencia de filtro; el selector debe seguir permitiendo acotar por fecha.
- Mantener visibles los cuatro estados (`PENDING`, `CONFIRMED`, `CANCELLED`, `COMPLETED`), los filtros de estado y barbero y el aislamiento de BARBER por `barber_id` frente al acceso ADMIN.
- Añadir pruebas autónomas para múltiples fechas, los cuatro estados, filtro ADMIN por barbero y aislamiento BARBER; no crear ni modificar datos de Preview.
- Verificar TypeScript, tests, build, rutas y Preview; no publicar Production ni modificar reservas, autenticación, RLS, disponibilidad, Resend o notificaciones.


## Selector rápido de fechas del panel móvil — Preview

Implementar exclusivamente en `/admin/movil` y Preview un selector integrado con seis opciones: `Todos los días`, `Hoy`, `Mañana`, `Próximos 10 días`, `Esta semana` y `Fecha específica` mediante el calendario existente. `Todos los días` será la opción predeterminada, mostrará todos los turnos permitidos de cualquier fecha —incluidos anteriores si corresponden a los demás filtros— y conservará Estado y Barbero. `Hoy` y `Mañana` serán días calendario; `Próximos 10 días` incluirá hoy y los nueve días siguientes, incluidos fines de semana y cruces de semana; `Esta semana` será lunes a domingo inclusive incluso si hoy es sábado o domingo; `Fecha específica` mostrará exclusivamente el día elegido. El rango relativo se recalculará al cambiar el día mientras el panel permanece abierto y deberá usar la zona horaria del negocio (`America/Argentina/Buenos_Aires`) sin conversiones UTC incorrectas.

Presentar el selector de fechas dentro de un contenedor continuo, con indicador de despliegue integrado, más ancho que Estado y Barbero, sin etiquetas cortadas, superposición ni scroll horizontal. El calendario y el selector rápido compartirán un único estado: elegir una opción rápida abandonará la fecha puntual; elegir una fecha activará claramente `Fecha específica`; volver a `Todos los días` quitará la restricción. Combinar fecha, Estado y Barbero sin alterar los permisos: ADMIN ve los tres barberos y BARBER solo su `barber_id`. Mantener intactos `/admin`, `/reservar`, Supabase, RLS, autenticación, disponibilidad, estados, notificaciones, Resend y datos reales; no crear, modificar ni eliminar turnos. Agregar pruebas de rangos, sábado/domingo, diez fechas inclusivas, filtros combinados y ausencia de restricciones contradictorias. Ejecutar TypeScript, tests, build y validaciones de Preview; no publicar Production.

## Gestiona tus horarios — Preview

Implementar exclusivamente en Preview una sección independiente `/admin/horarios`, sin eliminar ni desactivar `/admin`, `/admin/movil` ni `/admin/disponibilidad`, sin publicar Production y sin modificar reservas existentes.

- Reutilizar `public.barber_availability_slots` como fuente única; no crear un sistema paralelo. Mantener sus ventanas de cobertura dentro del rango operativo 10:00–20:00, ofrecer únicamente los inicios comerciales fijos `10:00, 10:45, 11:30, 12:15, 13:00, 13:45, 14:30, 15:15, 16:00, 16:45, 17:30, 18:15 y 19:00`, usar duraciones de 45/45/30 minutos para Corte/Corte + barba/Barba, excluir domingos y conservar las reglas existentes de reservas y solapamientos.
- Usar la zona horaria `America/Argentina/Buenos_Aires` y reutilizar la lógica existente de períodos: Todos los días, Hoy, Mañana, Próximos 10 días, Esta semana y Fecha específica. Todos los días será el valor inicial; los rangos serán inclusivos y no habrá errores en límites de fecha.
- Mostrar una interfaz mobile-first vertical, compacta y sin desplazamiento horizontal; mantener el estilo visual del panel móvil existente, controles táctiles grandes y estados disponibles/no disponibles reconocibles.
- Antes de iniciar sesión, el menú debe mostrar Solicitar turno, Contacto y Administración. Con una sesión interna válida en Administración, debe mostrar Solicitar turno, Contacto, Panel móvil hacia `/admin/movil` y Gestiona tus horarios hacia `/admin/horarios`. No mostrar opciones administrativas sin sesión válida.
- BARBER debe consultar, habilitar, deshabilitar, comentar y agregar horarios únicamente en su propia agenda real; no debe poder consultar o mutar otra agenda por URL, estado frontend ni llamada directa.
- ADMIN debe consultar todos los barberos, filtrar por Todos/Lautaro/Gonzalo/Valentín usando los registros reales de la base y elegir claramente la agenda al agregar disponibilidad; el alta debe ofrecer únicamente los inicios comerciales fijos.
- Cada horario debe mostrar fecha cuando corresponda, hora de inicio y fin, barbero cuando ADMIN consulte varias agendas, estado, comentario interno si existe y una acción persistente para habilitar o deshabilitar. Ordenar cronológicamente y agrupar por fecha.
- Permitir crear, editar y eliminar comentarios internos. Los comentarios deben permanecer fuera del flujo público y de `available_barber_slots`.
- Permitir `+ Agregar horario` con fecha y uno de los inicios comerciales fijos entre 10:00 y 19:00; cada ventana debe terminar como máximo a las 20:00. Rechazar inicios intermedios como 10:15, 11:00 o 12:10 tanto en la interfaz como en las RPC.
- Validar fecha, hora, domingo cerrado, horario operativo, duplicados, solapamientos con disponibilidad existente, reservas no canceladas y agenda autorizada. No sobrescribir ni borrar horarios existentes para resolver conflictos. Mostrar errores comprensibles y conservar el formulario cuando sea posible.
- Después de guardar, confirmar brevemente, actualizar la lista sin recarga manual, conservar filtros y evitar duplicados visuales.
- Implementar las mutaciones mediante RPCs protegidas con `SECURITY DEFINER`, `search_path` seguro, validación de `auth.uid()`, rol y agenda, bloqueo transaccional y privilegios explícitos. Revocar las mutaciones directas innecesarias en Preview; mantener intactas las consultas SELECT existentes y no debilitar RLS.
- Ajustar únicamente el layout de `/admin/movil` para que Período y Fecha tengan exactamente el mismo ancho, queden dentro del viewport y no generen scroll horizontal. Mostrar `Todos` en lugar de `Todos los barberos` solo cuando esa opción esté seleccionada; conservar opciones y valores internos.
- Verificar TypeScript, tests, build, rutas, responsive 390×844/desktop, filtro de fechas, aislamiento BARBER/ADMIN, persistencia de estados/notas, compatibilidad del flujo público y ausencia de operaciones sobre reservas reales. Si no puede realizarse una prueba autenticada autónoma, documentarla como pendiente sin presentarla como validada.
- No modificar Resend, notificaciones, autenticación, precios, servicios, reservas reales, datos existentes, Production ni la publicación automática.

## Eliminar el panel de administración antiguo — Preview

- Mantener íntegramente la nueva gestión de turnos y el panel móvil, con sus estados, filtros, acciones, permisos y lógica actuales, sin reconstruirlos ni cambiar su diseño/UX writing/comportamiento.
- Conservar `/admin` como entrada autenticada de la nueva gestión responsive y conservar `/admin/movil` y `/admin/horarios`.
- Eliminar únicamente el panel legacy de tablas/dashboard y sus rutas `/admin/pendientes`, `/admin/cancelados` y `/admin/disponibilidad`, incluidos accesos y enlaces legacy, después de verificar que no tengan dependencias activas.
- Conservar el layout/guard de `/admin`, `AdminAccess`, `AdminMobileAppointments`, `AdminScheduleManager`, la gestión ADMIN de Mantenimiento, los helpers de reservas/disponibilidad, las RPCs, RLS, notificaciones, Auth, Supabase y Resend que sigan siendo necesarios.
- Mantener la funcionalidad de novedades administrativas integrándola en la experiencia nueva; actualizar sus destinos a `/admin/movil` y `/admin/horarios` sin cambiar los eventos persistidos ni el envío de emails.
- Eliminar componentes legacy sin consumidores: `src/components/kani/admin.tsx`, `admin-demand-dashboard.tsx` y `availability-admin.tsx`; retirar solo CSS exclusivo no utilizado.
- Verificar escritorio y mobile, login/guard, visualización de turnos, confirmación, cancelación/rechazo, disponibilidad, mantenimiento ADMIN y aislamiento BARBER/ADMIN; comprobar que no queden rutas huérfanas, enlaces rotos ni errores de compilación.
- No eliminar información de Production, no ejecutar migraciones destructivas, no cambiar datos, roles, políticas RLS, funciones RPC, autenticación, notificaciones ni Resend.
- Ejecutar TypeScript, tests, build, rutas y Preview. Crear checkpoint solo después de una verificación satisfactoria; publicar únicamente tras autorización/validación según el alcance vigente.


## Rediseño del Panel Móvil y corrección de disponibilidad

- Rediseñar las tarjetas PENDIENTE, CONFIRMADO, CANCELADO y COMPLETADO para que sean compactas, con padding, altura y espacios reducidos; mostrar `TODOS` como quinta opción; mantener todos los estados en una fila cuando el ancho lo permita; `TODOS` debe mostrar todos los turnos de los filtros activos sin importar estado; cada estado debe mostrar exclusivamente su estado; conservar cantidades e indicador visual seleccionado; evitar scroll horizontal en pantallas estrechas.
- Compactar Período, Estado y Barbero, e integrar un acceso de calendario compacto a la derecha cuando sea viable; en móviles estrechos adaptar sin desbordamientos; el calendario debe abrirse desde el control, respetar el viewport y permitir filtrar fechas.
- Eliminar `Ver detalle` de las tarjetas. Mostrar directamente fecha, inicio y finalización, cliente, servicio, barbero, celular, email, observaciones si existen y estado; priorizar fecha/horario, luego cliente/servicio, luego datos secundarios compactos y finalmente estado/acciones; conservar legibilidad, wrapping y áreas táctiles adecuadas.
- Mostrar Confirmar y Cancelar solo cuando correspondan al estado y permisos actuales; mantener ADMIN/BARBER y evitar que BARBER gestione otra agenda; conservar notificaciones, reglas de cancelación y actualización coherente de disponibilidad.
- Incorporar un botón flotante pequeño con flecha hacia arriba, oculto al inicio y visible tras desplazamiento suficiente; al tocarlo volver al inicio sin tapar controles, tarjetas o acciones y respetando safe areas.
- Rediseñar Gestiona tus horarios para reutilizar cápsulas visuales del flujo público; agrupar por fecha, mostrar cápsulas en grid que continúe en filas, usar el espacio necesario, adaptar al dispositivo, conservar barbero/fecha, diferenciar habilitado, deshabilitado y ocupado y agregar leyenda.
- Al habilitar o deshabilitar una cápsula, persistir el cambio efectivo para reservas públicas mediante RPC; respetar turnos existentes, no cancelarlos ni desplazarlos automáticamente, marcar ocupado sin confundirlo con libre y no invalidar reservas silenciosamente.
- El selector manual debe listar únicamente `10:00, 10:45, 11:30, 12:15, 13:00, 13:45, 14:30, 15:15, 16:00, 16:45, 17:30, 18:15 y 19:00`; esta política no debe ampliar automáticamente el horario público.
- Mantener la disponibilidad pública basada en configuración válida, servicio activo, duración real de Supabase, agenda y reservas; los valores oficiales son Corte 45, Corte + barba 45 y Barba 30.
- Garantizar que `end = start + duration`, que el solapamiento sea `new_start < existing_end AND new_end > existing_start`, que los intervalos contiguos estén permitidos, que CANCELLED no bloquee, que los estados activos bloqueen según regla vigente y que la operación sea atómica ante solicitudes simultáneas.
- No alterar turnos existentes, no ejecutar migraciones destructivas, no tocar Production y verificar antes de publicar panel mobile/desktop, filtros, acciones, cápsulas, flujo público, reservas de 30/45/60 minutos, concurrencia, roles, notificaciones, emails, TypeScript, tests y build.


## Iteración UX/UI de panel, horarios y reservas — Preview

- Mostrar solo `Todos`, `Pendientes`, `Confirmados` y `Cancelados` como accesos rápidos; conservar `COMPLETED` en Estado.
- Mantener cantidades reales, filtros de Período/Estado/Barbero/Calendario, aislamiento BARBER por `barber_id` y selección ADMIN de las tres agendas.
- Usar cápsulas compactas para horarios con Disponible, No disponible y Con reserva; no alterar slots ocupados.
- Permitir alta administrativa desde 00:00 hasta 23:55 cada 5 minutos y fechas futuras más allá de 21 días, manteniendo domingos cerrados y sin ampliar el horario público 10:00–20:00.
- Mantener servicios, duraciones y precios configurados en Supabase; no inventar datos ni alterar pasos públicos.
- Centralizar paletas claro/oscuro, conservar Zen Antique, foco visible, etiquetas accesibles, áreas táctiles y sin scroll horizontal.
- Trabajar solo en Preview con `auto_publish: false`; no publicar Production, crear reservas, enviar emails, tocar credenciales, Auth, RLS ni eliminar datos.


## Simplificación de Turnos y notificaciones — Production

`/admin` es la entrada visible de Turnos y, tras autenticarse, muestra directamente la agenda sin panel intermedio. No se muestran `Panel completo` ni `Agenda móvil`; el menú autenticado muestra `Turnos`.

Turnos inicia en Hoy, usa `America/Argentina/Buenos_Aires` y ofrece únicamente Hoy, Mañana, Próximos 10 días, Esta semana y Fecha específica.

PENDING: Confirmar, Rechazar y Reenviar notificación. CONFIRMED: Cancelar turno y Reenviar notificación. CANCELLED: Reenviar notificación. COMPLETED: sin acción nueva.

Confirmación y cancelación incluyen fecha DD/MM/AAAA, horario, barbero responsable, dirección San Isidro Labrador 7, Martínez, Provincia de Buenos Aires y Google Maps.

Mantener aislamiento ADMIN/BARBER, RLS, RPCs, `/reservar`, reservas, credenciales y datos sin cambios.


## Logo transparente y fondo de modo claro — Preview

El logo transparente suministrado reemplaza el logo anterior del header y de la pantalla de acceso administrativo, y se muestra en modo claro y oscuro. El fondo japonés suministrado se utiliza únicamente en modo claro; el modo oscuro no debe mostrarlo. El modo claro es el estado inicial, salvo una preferencia oscura guardada por el usuario. No modificar flujo de reservas, autenticación, datos, Supabase, Resend ni Production.


## Fondo claro desktop

En modo claro y desde 1024px se utiliza el fondo panorámico desktop suministrado. Mobile conserva el fondo vertical existente. El modo oscuro permanece sin imagen de fondo. No modificar funciones ni publicar sin autorización específica.


## Fondos del modo oscuro

En modo oscuro, mobile utiliza el fondo vertical suministrado y desktop desde 1024px utiliza el fondo panorámico suministrado. El modo claro conserva sus fondos correspondientes. El logo se mantiene en ambos temas. No modificar funcionalidades ni publicar sin autorización específica.


## Navegación administrativa y disponibilidad pública

- Mostrar una navegación secundaria común inmediatamente debajo del header en las rutas administrativas, con solo “Turnos” (`/admin`) y “Gestioná tus horarios” (`/admin/horarios`), protegidas por el guard existente.
- Ocultar del flujo público los horarios `UNAVAILABLE` y los horarios ya ocupados, sin crear ni modificar datos.
- En mobile, mantener dos cápsulas por fila, altura uniforme, hora, intervalo y estado legibles, sin superposición ni scroll horizontal.
- No modificar servicios, precios, duraciones, reservas, credenciales ni reglas ajenas a este ajuste.


## Reemplazo de fondos WEBP

- Reemplazar los cuatro fondos anteriores por los nuevos WEBP suministrados: claro desktop, claro mobile, oscuro desktop y oscuro mobile.
- Mantener la selección correcta por modo claro/oscuro y breakpoint desktop/mobile usando las rutas existentes.
- No modificar logo, layout, navegación, flujo de reservas, panel administrativo, Supabase, autenticación, reservas, disponibilidad, notificaciones ni Resend.
- Validar que los cuatro assets se sirvan en Preview y que no haya regresiones visuales ni desbordamiento.


## Reemplazo de fondos WEBP — 2026-10-11

- Reemplazar los fondos claro/oscuro de desktop y mobile por los cuatro WEBP suministrados.
- Mantener las rutas estables `kani-fondo-claro-desktop.webp`, `kani-fondo-claro-mobile.webp`, `kani-fondo-oscuro-desktop.webp` y `kani-fondo-oscuro-mobile.webp`.
- Conservar el mapeo actual por tema y breakpoint, sin modificar lógica, navegación, reservas, disponibilidad, Supabase, Resend ni autenticación.
- Validar en Preview y publicar únicamente si TypeScript, tests, build, rutas y assets pasan correctamente.


## Símbolo de Kani en login administrativo — Preview

- Reemplazar únicamente el logo completo del login de `/admin` por el símbolo transparente suministrado, manteniendo el texto alternativo de marca y una escala responsive legible.
- No modificar autenticación, sesiones, roles, Supabase, reservas ni navegación.
- Verificar el login visualmente en desktop y mobile, ejecutar TypeScript, tests y build, y mantener los cuatro fondos WEBP ya publicados en Production.
- Dejar el símbolo en Preview hasta contar con autorización específica para publicar este cambio.


## Fondos del menú desplegable y corrección de altura mobile — Preview
- Incorporar los cuatro WEBP suministrados exclusivamente como fondo del menú desplegable: claro mobile, claro desktop, oscuro mobile y oscuro desktop.
- Mantener la selección por tema `light`/`dark` y por breakpoint responsive, sin modificar la navegación ni los destinos existentes.
- En mobile, extender la superficie visual del menú hasta el borde inferior del viewport (`bottom: 0`), evitando que el fondo sólido se detenga antes del final.
- Mantener `Volver a la solicitud` por encima del fondo del menú mediante una capa superior, sin modificar su acción ni el flujo de reservas.
- Reservar espacio de scroll dentro del menú para que los últimos enlaces no queden debajo del botón de regreso ni del área segura del dispositivo.
- Verificar los cuatro assets en Preview, desktop/mobile y claro/oscuro; ejecutar TypeScript, tests y build; publicar solo la versión validada según la autorización vigente.


## Correcciones visuales y de interacción — Preview

Trabajar únicamente en Preview. No publicar en Production, no crear checkpoint, no modificar la base de datos ni la lógica de reservas.

- Aumentar los íconos actuales de servicios de 34×34 px a 44×44 px, manteniendo los archivos y diseño existentes, sin deformaciones ni recortes; comprobar legibilidad en 360 px.
- En modo claro, las tarjetas no seleccionadas de servicios y barberos deben tener fondo blanco (`var(--card)`), borde gris existente (`var(--border)`), sin dorado ni crema y tipografía regular/medium. Las seleccionadas deben tener fondo bordó muy sutil y translúcido, borde bordó visible, círculo bordó con tilde blanca y sin relleno bordó intenso. Mantener jerarquía moderada entre nombre, duración y precio. No alterar datos ni lógica.
- En modo claro, restaurar el stepper con una línea gris fina de recorrido completo y una línea de progreso bordó más gruesa superpuesta, iniciada en el primer indicador y terminada exactamente en el indicador del paso activo, sin invadir el siguiente ni crear una segunda línea blanca.
- En modo claro, igualar exactamente la altura de Volver y Continuar con el botón `Volver a la solicitud` del menú, reutilizando el valor de 48 px (`h-12`), distribuir aproximadamente 30/70, conservar flecha dorada y estados habilitado/deshabilitado. No alterar el comportamiento.
- No modificar el modo oscuro ni estilos fuera de este alcance. Validar a 360×800 y desktop: íconos, tarjetas activas/inactivas, stepper en distintos pasos, alturas, Continuar habilitado/deshabilitado. Ejecutar TypeScript, tests y build; adjuntar capturas reales de Preview.


## Reparación prioritaria de regresiones visuales — Preview

Trabajar únicamente en Preview, sin publicar, crear checkpoint, modificar Supabase ni modificar datos. Reparar exclusivamente la estructura de tarjetas, colores tipográficos, botones y cálculo visual del stepper.

- Tarjetas de servicios: dos filas; nombre alineado a la izquierda en la primera; duración a la izquierda y precio a la derecha en la segunda, centrados verticalmente; mantener ícono a la izquierda e indicador de selección a la derecha; no usar tres columnas ni apilar el precio debajo de la duración; conservar altura compacta.
- Tarjetas activas de servicios y barberos: nombres, duraciones, precios, Instagram y textos secundarios oscuros/grises legibles; nunca aplicar blanco a todos los descendientes. Mantener fondo bordó muy sutil y translúcido, borde bordó visible y círculo bordó con tilde blanca.
- Volver: fondo blanco, borde gris, color de texto actual y flecha del mismo color; no bordó. Continuar habilitado: bordó suave, borde bordó y texto blanco. Continuar deshabilitado: apagado/translúcido, borde gris y texto gris. Ambos deben medir 48 px, conservar radio y distribución aproximada 30/70; no cambiar Volver a la solicitud.
- Stepper: medir la geometría real de sus seis pasos y hacer que el progreso bordó termine en el separador correspondiente al paso activo; mantener línea base gris fina y progreso bordó grueso visible desde Servicio, sin sobrepasar el paso siguiente.
- Conservar íconos 44×44, modo oscuro, tarjetas compactas, textos, precios, duraciones, disponibilidad y persistencia. No reescribir styles.css completo ni sobrescribir cambios ajenos. Validar 360×800 y desktop, estados Servicio/Fecha/Resumen, modo oscuro, TypeScript, tests, build y `git diff --check`.

## Ajustes finales puntuales — Preview

No modificar la estructura actual de las tarjetas ni rehacerla. No publicar, no crear checkpoint, no modificar Supabase ni datos.

- Centrar verticalmente el precio del servicio respecto del indicador de selección/checkmark, manteniendo posiciones horizontales, ícono, bloque de texto y altura general; validar tarjetas activas e inactivas.
- Corregir únicamente el origen geométrico del progreso del stepper: la línea gris fina y el progreso bordó deben comenzar en el borde izquierdo común del contenido, tarjetas y botón Volver; el progreso debe seguir terminando en el separador exacto del paso activo sin invadir el siguiente.
- Hacer que las tarjetas de servicios inactivas reutilicen exactamente el mismo token de fondo blanco de botones, menú y calendario no seleccionado, conservando bordes grises y selección bordó translúcida.
- No modificar modo oscuro, textos, íconos, disposición de tarjetas, botones, menú ni comportamiento de reservas. Validar Preview a 360×800 y desktop; ejecutar verificaciones técnicas y revisar el diff limitado a estos puntos.

## Fondos claros cercanos al blanco — Preview

Aplicar exclusivamente en modo claro, sin publicar ni modificar la lógica:

- Fondo de la aplicación: `WEBPDesktopClaroBlanco3840x2160.webp` en desktop y `WEBPMobileClaroBlanco1440x3200.webp` en mobile.
- Fondo del menú desplegable: `WEBPMenuDesktopClaroBlanco3840x2160.webp` en desktop y `WEBPMenuMobileClaroBlanco1440x3200.webp` en mobile.
- Mantener intactos los fondos oscuros y la estructura responsive existente.
- Mantener continuidad visual durante el scroll, sin superposiciones que oculten el contenido ni alterar botones, reservas, Supabase o Production.
- Validar Preview en desktop/mobile y ambos fondos claros; ejecutar TypeScript, tests y build. No crear checkpoint ni publicar sin autorización posterior.

## Fondos claros casi blancos — Preview

Reemplazar exclusivamente en modo claro los fondos existentes por los cuatro WEBP suministrados: aplicación desktop `WEBPDesktopClaroBlanco3840x2160.webp`, aplicación mobile `WEBPMobileClaroBlanco1440x3200.webp`, menú desktop `WEBPMenuDesktopClaroBlanco3840x2160.webp` y menú mobile `WEBPMenuMobileClaroBlanco1440x3200.webp`. Mantener intactos los fondos oscuros, la lógica, rutas, Supabase, Resend y Production. Validar continuidad responsive, menú desplegable, formato/HTTP, TypeScript, tests y build; no crear checkpoint ni publicar.

## Fondos claros casi blancos — Preview

Reemplazar exclusivamente en modo claro los cuatro WEBP suministrados para aplicación y menú; mantener intactos los fondos oscuros, lógica, rutas, Supabase, Resend y Production. Validar responsive, HTTP, TypeScript, tests y build; no crear checkpoint ni publicar.

## Fondos de controles del header — Preview

En modo claro, aplicar exclusivamente a los dos controles del header —hamburguesa y alternancia claro/oscuro— el mismo token de fondo que las cards de servicios y barberos no seleccionadas (`var(--card)`). No modificar iconos, textos, funcionalidad, bordes, radios, dimensiones, sombras, otros elementos del header ni el modo oscuro. Validar visualmente ambos fondos contra una card inactiva en Preview, sin checkpoint, publicación, Supabase ni datos.

## Rediseño cromático del modo oscuro — Preview

Trabajar exclusivamente en Preview. No crear checkpoint, no publicar en Production, no modificar Supabase, datos, lógica, componentes estructurales ni fondos oscuros existentes.

- Mantener exactamente la estructura, distribución, dimensiones, espaciados, tipografías, jerarquías, comportamiento, flujo de reservas, navegación, formularios, calendario, horarios y panel administrativo del modo claro actual.
- No cambiar bajo ninguna circunstancia los fondos oscuros: colores, imágenes, posiciones, tamaños, escalas, efectos ni responsive.
- Adaptar únicamente los colores de componentes del modo oscuro con la paleta negro, bordó principal, dorado acento, blanco para textos principales y grises para secundarios, bordes, separadores, disabled y errores.
- Usar bordó para acciones principales, progreso y activos; dorado solo como acento moderado; texto oscuro únicamente sobre fondos dorados cuando corresponda.
- Revisar header, menú, tarjetas, botones, calendario, horarios, stepper, formularios, mensajes, resumen y panel administrativo, conservando diferencias entre activo, inactivo, hover, focus, disabled y error.
- No modificar la apariencia del modo claro. Ejecutar TypeScript, tests y build; revisar el flujo completo, panel ADMIN/BARBER y capturas reales desktop/mobile; detenerse ante cualquier regresión.
