# Experimento de reserva en cuatro pasos

Ruta experimental: `/reserva-v2`. `/` y `/reservar` conservan el flujo original de seis pasos, sin redirecciones ni cambios de backend.

## Composición

La variante opt-in `combinedDateTime` reutiliza el estado y las operaciones de `Booking`:

1. Servicio.
2. Barbero.
3. Fecha y horario (label mobile: `Fecha/Hora`).
4. Datos: formulario de contacto, Tu turno, Pago y CTA explícito `Pagar seña`.

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
