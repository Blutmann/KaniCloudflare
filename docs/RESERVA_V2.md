# Experimento de reserva en cuatro pasos

Ruta experimental: `/reserva-v2`. `/` y `/reservar` conservan el flujo original de seis pasos, sin redirecciones ni cambios de backend.

## Composición

La variante opt-in `combinedDateTime` reutiliza el estado y las operaciones de `Booking`:

1. Servicio.
2. Barbero.
3. Fecha y horario (label mobile: `Fecha/Hora`).
4. Datos: formulario de contacto, resumen único de turno e importes y CTA explícito `Pagar seña`.

Fecha y horario siguen separados en el payload. Continuar requiere una fecha y un horario válidos y, cuando corresponde, resolver el barbero diferido. Se eliminó el texto secundario de fecha y cantidad de horarios, incluido su espacio asociado.

El último paso muestra servicio, duración, barbero, fecha, horario, total, seña configurada y saldo restante desde el estado existente. No duplica los datos personales ni introduce una confirmación adicional. En mobile usa filas compactas debajo del formulario y scroll vertical; desde 1024 px distribuye formulario y revisión en dos columnas. Las superficies importantes Light reutilizan los tokens reforzados; no cambia las superficies Dark.

El stepper permite editar selecciones y conserva el contacto ingresado. El formulario no inicia el pago al pulsar Enter: hace falta el CTA explícito. Antes del pago se comprueban los campos, teléfono normalizado y disponibilidad con las operaciones existentes. Se conservan la creación de reserva, la orden de pago, el reintento de una reserva pendiente y la redirección al checkout; no cambian Mercado Pago, Supabase ni emails.

Los estilos nuevos se limitan a `.booking-v2`. Se conserva la presentación recuperada del stepper adaptada a cuatro pasos. El objeto `cc5805fb` no está disponible localmente para contrastarlo directamente.

## Validación

- Build Cloudflare correcto.
- Pruebas de interacción con reserva/orden/checkout simulados: igualdad de payloads V1/V2, campos incompletos, envío del formulario sin pago, horario vencido, barbero diferido, cambio de fecha, edición de servicio/barbero/fecha/horario, revisión actualizada y persistencia del contacto.
- Chromium con disponibilidad simulada: 360, 375, 390, 430, 1024, 1280, 1440 y 1920 px, alto 800, Light y Dark. Cuatro pasos, CTA único, revisión integrada y navegación sin overflow horizontal.
- `/reservar`: seis pasos, mismos payloads; capturas de horario a 360/1440 px en ambos temas sin diferencias respecto de la referencia anterior a esta fusión.
- La suite mantiene dos fallos previos ajenos al experimento: rangos de estadísticas y columnas de turnos manuales.

No se creó una reserva ni un cobro real para validar esta modificación. La prueba de inicio de pago usa servicios simulados; no acredita integración real con Mercado Pago.

## Publicación

Destino autorizado exclusivamente Preview/Test: `https://kanibarberstudio-cloudflare.kanibarber.workers.dev/reserva-v2`. No desplegar a Production ni reutilizar Supabase PROD para pruebas.

## Ajuste de contraste y ancho

En Light, las cápsulas neutrales y los avisos importantes de V2 usan `--kani-surface-critical: #ffffffcc` (80%). Hover conserva el tinte existente; seleccionado, foco y deshabilitado mantienen sus tratamientos. No se cambia el token compartido ni `/reservar`, los importes o las cards generales. Las superficies Dark y los fondos se conservan. Desde 1024 px, calendario y horarios ocupan el mismo ancho útil del stepper; los siete días se distribuyen en todo el ancho sin aumentar su altura. En mobile se mantiene el ancho y cuatro horarios por fila; desktop conserva cinco. La línea de fecha/cantidad de horarios ya no existe en el render ni tiene contenedor o estilos residuales; cada fecha conserva su nombre accesible y selección, y la sección de horarios conserva `aria-busy`.

## Compactación y ancho consistente

Se elimina el título visual «Elegí un horario»; el grupo de cápsulas conserva el nombre accesible «Horarios disponibles». «¿Quién te va a atender?» reutiliza exactamente la tipografía anterior de ese título: 20 px, peso 400, interlineado 26 px y márgenes 0/0/14 px. Se elimina el borde superior y padding del bloque de barberos. Los barberos diferidos neutrales Light usan el token crítico al 80%, con tinte de hover y estados seleccionados preservados; Dark conserva sus superficies.

El encabezado del calendario reduce su margen inferior a 4 px y conserva navegación con targets de 44 × 44 px. No cambia el tamaño del texto del mes. Medición con disponibilidad simulada: unos 43 px menos a 360 × 800 y 59 px menos en desktop, incluyendo la sección de barbero diferido.

Se eliminan los límites particulares de 1080 px de Fecha/Hora y Datos: los cuatro pasos heredan el contenedor original de Servicio/Barbero (`min(1184px, calc(100% - 80px))` en desktop y los gutters mobile existentes). Medidos los cuatro pasos y stepper con 328 px a 360 y 1184 px a 1440, sin saltos. Se mantienen cuatro horarios por fila en mobile, cinco en desktop y calendario completo de siete columnas. Validado en los ocho anchos solicitados, Light/Dark; `/reservar` sin diferencias de píxeles en 360/1440, ambos temas.

## Resumen único en Datos

El paso final presenta una única card con los ocho conceptos: servicio, barbero, fecha, horario, duración, precio total, seña y saldo. Horario y duración comparten una fila, conservando pares `dt`/`dd` y orden de lectura. No hay títulos visuales «Tu turno» ni «Pago», ni una card económica independiente. Los importes siguen derivándose del servicio y de la seña configurada. El aviso V2 dice exactamente «Tu turno se confirma únicamente cuando abonas la seña», mantiene el 80% Light y su superficie Dark. El CTA y las validaciones no cambian.

Las máscaras de iconos de servicios Dark no seleccionados usan `var(--gold)` en el componente compartido por V1/V2. Light, iconos seleccionados, textos, precios y superficies no cambian. `/reservar` conserva su estructura, resumen y mensaje originales.
