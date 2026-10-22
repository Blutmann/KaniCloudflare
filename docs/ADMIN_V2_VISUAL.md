# Admin V2 — dirección visual de Kani

Esta pasada conserva la arquitectura y el funcionamiento de V2. La referencia
principal es V1; el flujo público de reservas aporta el tratamiento translúcido
de superficies. No se modifican componentes ni estilos compartidos de V1.

## Referencias reutilizadas

- `--font-sans` / Zen Antique, `--gold`, `--primary`, `--success`, variables de
  botones, gráficos y radios del sitio.
- La cápsula `admin-section-nav`, sus enlaces, selección y control de refresco.
- Las clases `action-confirm`, `action-reject` y `action-mail` de los turnos V1.
- Superficies `#ffffff29` en claro y `#1818189c` en oscuro, con blur sutil.
  Las áreas con texto prolongado recuperan `--surface` de V1 para proteger la
  lectura sobre la imagen de fondo. Inputs y diálogos también tienen respaldo.

## Composición

La barra lateral y la marca duplicada desaparecen. Desktop y Mobile usan la
misma navegación horizontal de seis secciones, con acceso a comparar con V1.
Los módulos recuperan tipografía, espaciados y controles de Kani.

Inicio agrupa las cifras secundarias y prioriza horario, cliente y acción del
próximo turno. Las cards de Turnos recuperan los botones de V1. Pagos conserva
el formulario breve y las acciones secundarias. Clientes, Datos, filtros,
gráficos, estados vacíos y diálogos comparten los mismos tokens. Horarios sigue
reutilizando su componente autorizado existente, sin modificarlo.

Los controles principales mantienen objetivos táctiles de al menos 44px; los
diálogos V2 incluyen un cierre de 44px. Hover, focus, active y disabled tienen
tratamientos explícitos. La apariencia se limita a V2 y sus portales.

## Verificación

- Pruebas funcionales de V2 y correo: 35 correctas.
- Suite completa: 282/285 correctas; continúan los tres fallos conocidos en
  expectativas antiguas de grilla, límite de semana y comparación LF/CRLF.
- Build cliente/Worker correcto.
- Revisión de los seis módulos con datos controlados en Light/Dark y anchos
  360, 375, 390, 430, 768, 1024, 1280 y 1440. Roles ADMIN/BARBER con el mismo
  alcance que antes. Referencias de V1 capturadas en el navegador local.
- No se cambian rutas, consultas, filtros, cálculos, permisos, RLS, pagos,
  Mercado Pago, migraciones ni el código de `/reservar`.

## Ajuste independiente solicitado: `[PRUEBA]`

El formateador del asunto identifica el proyecto de pruebas
`iockpxtkflyjfagkvgnr`, aun si falta `KANI_ENVIRONMENT`, y aplica `[PRUEBA]`.
También normaliza a ese prefijo los entornos de desarrollo/pruebas conocidos.
Los asuntos de producción conservan su comportamiento. No se cambian cuerpos,
destinatarios, proveedores ni disparadores de notificación.

La publicación se limita al Worker de pruebas ya verificado. No se cambian
variables, dominios ni configuración de Cloudflare; tampoco Supabase Production.
