# Experimento de reserva en cinco pasos

Ruta experimental: `/reserva-v2`. `/` y `/reservar` continúan usando el flujo original de seis pasos; no hay redirecciones ni cambios de backend.

La variante opt-in `combinedDateTime` reutiliza el estado, consultas, calendario, reglas de disponibilidad, formulario, resumen y operaciones de reserva/pago de `Booking`. Mantiene separados fecha y horario en el payload. Las etapas internas originales se conservan; solo se agrupan las pantallas y se adapta la navegación. Los estilos nuevos están limitados a `.booking-v2`.

En mobile, el calendario aparece sobre una grilla de cápsulas de 48 px de alto mínimo. Al elegir una fecha se revela la sección de horarios cuando queda fuera del área visible, conservando parte del contexto del calendario y sin mover el foco. Se respeta `prefers-reduced-motion`. Desde 1024 px, las dos secciones usan columnas. El stepper conserva la presentación restaurada en `main`, adaptada a cinco pasos. `cc5805fb` no está disponible como objeto local ni como referencia remota; no se pudo verificar esa referencia específica.

La fecha elegida se anuncia junto a los horarios. Las cápsulas mantienen `aria-pressed`, foco visible y navegación por teclado. Cambiar de fecha limpia horario y, cuando corresponde, barbero diferido; volver desde Datos conserva las selecciones válidas. Continuar requiere fecha, horario y barbero válidos, incluyendo la selección diferida. Los errores de disponibilidad al enviar vuelven al paso combinado.

## Validación local

- Chromium con disponibilidad y configuración públicas interceptadas mediante fixtures, sin conexión a una base real: 360, 375, 390, 430, 1024, 1280, 1440 y 1920 px, a 800 px de alto, en light y dark. Las 16 combinaciones pasaron selección, cambio de fecha, volver, continuar, resumen, ausencia de overflow horizontal y visibilidad de navegación inferior.
- `/reservar` comparado contra `56b9fc1411926f500485e2cbf710be054ecf9b32`: 16 capturas de servicio, fecha, horario y resumen en 360/1440 px y ambos temas, sin diferencias de píxeles detectadas. Conserva seis etapas y pantallas separadas de fecha/horario.
- Tests de interacción: igualdad de payloads V1/V2 para crear turno y orden de pago; redirección a checkout simulada; elección diferida de barbero; selección incompleta; estado sin fecha; volver; stepper; horario vencido. Los servicios externos están mockeados.
- Build de Cloudflare correcto. La suite completa ejecutó 306 pruebas: 304 aprobadas y los dos fallos previos: expectativas de rangos de estadísticas y proporciones de columnas en turnos manuales.
- Teclado: Enter conserva el foco en el calendario; Tab avanza desde la última fecha habilitada a las cápsulas y Espacio selecciona un horario. Axe sobre el paso combinado y el stepper, en 360/1440 px y ambos temas: sin infracciones automáticas detectadas; las comprobaciones de contraste sobre fondos con imágenes requieren revisión manual. No se ejecutó una prueba con lector de pantalla real.
- Typecheck: el `main` original ya presenta 175 diagnósticos. La variante mantiene el mismo número; no se corrigieron errores ajenos al experimento.

Los resultados, scripts locales de navegador y capturas se conservaron en `.validation/reserva-v2/` (ignorado por Git).

## Pendiente de integración

No se creó una reserva real ni se acreditó una seña ni se verificó el envío real de emails: faltan los bindings de Supabase DEV y credenciales de prueba correspondientes. No usar producción para esta validación.

No se desplegó a Cloudflare: Wrangler no está autenticado y falta identificar el Worker Preview/Test de destino. La configuración generada toma por defecto el nombre del repositorio, que no debe asumirse como un destino de prueba. La URL exacta de Preview/Test se podrá informar después de un despliegue autenticado al Worker correcto; agregar `/reserva-v2` a ese origen. No se ejecutó ningún despliegue a Production.
