# Navegación y barra de Clientes — 5 de noviembre de 2026

## Alcance

- Navegación V2: cuadrícula exterior con grupo flexible de cinco columnas iguales,
  divisor existente y columna fija de 44 px para actualizar. Las pestañas se
  estiran dentro de su columna, con dimensiones independientes del estado activo.
  Se conservan colores, alturas, radios, márgenes exteriores y funciones.
- Clientes, desde 768 px: el contenedor común existente presenta buscador flexible,
  selector de 180 px con etiqueta superior y botón según contenido, en una fila.
  Controles de 44 px alineados abajo; fondo sólido claro/oscuro, borde, radio,
  sombra y padding de 10 x 14 px del sistema de filtros existente.
- Móvil de Clientes: mismas dos filas, sin marco ni padding nuevos.

Solo se cambió CSS localizado y un comentario del componente. No se modificaron
permisos, consultas, endpoints, búsqueda, ordenamiento ni guardado. No hay
migraciones ni cambios de credenciales, usuarios, datos o integraciones.

## Verificación

- Edge sobre el Worker compilado localmente: 24 combinaciones (360, 768, 1024 y
  1440 px; ADMIN, MANAGER y BARBER; claro y oscuro). 120 selecciones de pestaña:
  anchos iguales y estables, contenido centrado, divisor y actualizar a la derecha,
  cápsula de ancho completo y ningún desbordamiento horizontal.
- Escritorio de Clientes: una fila, etiqueta superior, mismo borde inferior y
  altura de controles, sin superposición. Búsqueda por email, ambos órdenes
  alfabéticos y creación probadas con respuestas sintéticas, sin escrituras reales.
- Dimensiones y estilos de la barra móvil comparados con la versión productiva
  anterior: idénticos en los casos de referencia de 360 px.
- 12 pruebas de navegación, fondo del buscador y ordenamiento satisfactorias;
  otras 10 pruebas focalizadas de Clientes y estructura responsive satisfactorias.
  Build y Wrangler dry-run correctos.
- Una comprobación histórica de diagnóstico de email en Turnos sigue fallando
  fuera del alcance de estos cambios; no se alteró esa sección ni su prueba.

Las capturas utilizan clientes ficticios para conservar la privacidad. La
verificación de navegador intercepta Auth, Supabase y llamadas de servidor;
no utiliza contraseñas o sesiones de personas reales ni proveedores externos.

La publicación se realiza en el Worker existente desde la rama recuperada,
sin enviar `main` ni reactivar la cola histórica de migraciones de Supabase.
