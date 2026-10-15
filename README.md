# Kani Barber Studio - Reservar turno

Quiero diseñar el MVP de una aplicación web responsive para una barbería premium llamada KANI Barber Studio.

IMPORTANTE:
En esta primera etapa NO quiero que implementes backend, autenticación, base de datos, emails ni lógica de producción.

Quiero que construyas únicamente un prototipo funcional de la interfaz y los principales flujos de usuario utilizando datos ficticios/mock data.

El objetivo de esta primera etapa es validar UX, arquitectura de información y UI antes de implementar la lógica real.

==================================================
CONTEXTO DEL NEGOCIO
==================================================

KANI Barber Studio es una barbería premium ubicada en Zona Norte de Buenos Aires.

Actualmente funciona principalmente por orden de llegada, pero quiere incorporar un sistema de reservas online sin eliminar la posibilidad de atender clientes que llegan sin turno.

La aplicación debe complementar el funcionamiento actual de la barbería, no reemplazarlo.

Los principales objetivos son:

1. Organizar mejor la agenda de los barberos.
2. Garantizar cierto nivel de ingresos mediante reservas.
3. Identificar horarios de menor demanda.
4. Reducir la incertidumbre del cliente respecto del tiempo de espera.
5. Mejorar la experiencia general del cliente.

Un problema importante actualmente es que un cliente puede llegar esperando estar aproximadamente una hora en la barbería y terminar esperando mucho más tiempo debido a la cantidad de personas que están esperando para ser atendidas.

La reserva debe aportar principalmente PREVISIBILIDAD.

==================================================
PÚBLICO
==================================================

La clientela es principalmente de Zona Norte de Buenos Aires.

Hay dos grandes grupos:

- Adolescentes de 14 a 18 años.
- Adultos jóvenes de 19 a 30 años.

El público tiene un poder adquisitivo medio-alto/alto.

Los adolescentes tienen un perfil más social y relajado.

Los adultos tienen un perfil más serio.

La interfaz debe funcionar para ambos grupos.

NO quiero una estética adolescente ni una estética de barbería vintage.

Debe sentirse:

- premium
- moderna
- sobria
- masculina
- contemporánea
- cuidada
- simple

==================================================
IDENTIDAD VISUAL
==================================================

La marca utiliza principalmente:

- Negro como color predominante.
- Bordó/rojo como color secundario.
- Dorado como color de acento.

La identidad visual debe inspirarse en el local físico de KANI:

- interior predominantemente negro
- mobiliario oscuro
- iluminación geométrica y moderna
- detalles metálicos
- estética industrial contemporánea
- sensación premium

Utilizar el logo de KANI Barber Studio proporcionado como referencia visual.

NO convertir el diseño en una barbería vintage, retro, hipster o excesivamente ornamentada.

La interfaz debe tener suficiente espacio en blanco/espacio visual, jerarquía clara y buena legibilidad.

El dorado debe utilizarse como acento, NO como color dominante.

==================================================
SERVICIOS
==================================================

Actualmente existen estos servicios:

1. Corte
Precio: $25.000
Duración: 45 minutos

2. Corte + barba
Precio: $30.000
Duración: 60 minutos

3. Barba
Precio: $10.000
Duración: 30 minutos

Los tres servicios pueden ser realizados por cualquiera de estos tres barberos:

- Lautaro
- Gonzalo
- Valentín

Existe un servicio adicional llamado Color, realizado únicamente por Gonzalo, pero NO debe incluirse en esta primera versión del prototipo.

==================================================
HORARIOS
==================================================

La barbería funciona:

Lunes a sábado
10:00 a 20:00

Los tres barberos tienen inicialmente el mismo horario.

==================================================
FLUJO PRINCIPAL DEL CLIENTE
==================================================

El cliente NO necesita crear una cuenta para reservar.

El flujo principal debe ser:

1. Seleccionar servicio.
2. Seleccionar barbero.
3. Seleccionar fecha.
4. Seleccionar horario disponible.
5. Completar:
   - nombre
   - email
   - celular
6. Revisar los datos.
7. Solicitar turno.
8. Mostrar una pantalla de confirmación indicando que la solicitud quedó pendiente de confirmación.

IMPORTANTE:

El cliente selecciona SIEMPRE al barbero.

Esto es importante porque muchos clientes tienen un barbero habitual.

==================================================
ESTADOS DEL TURNO
==================================================

Un turno puede encontrarse en:

- Pendiente
- Confirmado
- Cancelado

Una solicitud pendiente debe bloquear temporalmente ese horario para evitar que otro cliente pueda solicitarlo.

Si un turno pendiente o confirmado es cancelado, el horario vuelve a estar disponible.

La confirmación NO es automática.

El turno queda pendiente hasta que el barbero correspondiente lo confirme desde el panel administrativo.

==================================================
SISTEMA MIXTO
==================================================

La barbería continuará atendiendo clientes que llegan sin turno.

NO diseñar en esta versión:

- cola virtual
- turnos para walk-ins
- gestión de personas esperando en el local
- estimación de tiempo de espera de clientes sin turno

La aplicación solamente administra los turnos reservados online.

==================================================
PANEL ADMINISTRATIVO
==================================================

Crear un panel administrativo separado de la experiencia del cliente.

Debe tener tres secciones principales:

1. PRÓXIMOS TURNOS

Mostrar los próximos turnos confirmados.

Cada turno debe mostrar:

- fecha
- hora
- nombre del cliente
- servicio
- barbero
- estado

Permitir cancelar un turno.

2. PENDIENTES DE CONFIRMAR

Mostrar las solicitudes que todavía no fueron confirmadas.

Cada solicitud debe permitir:

- Confirmar
- Cancelar

3. HORARIOS DISPONIBLES

Permitir visualizar y posteriormente modificar la disponibilidad de cada barbero.

Inicialmente todos tienen:

Lunes a sábado
10:00–20:00

==================================================
RESPONSIVE
==================================================

La aplicación debe diseñarse mobile-first.

Debe funcionar correctamente en:

- teléfonos
- tablets
- notebooks
- desktop

No crear una versión mobile y otra desktop completamente diferentes.

Utilizar un sistema responsive coherente.

En mobile:

- navegación simple
- botones fáciles de tocar
- formularios cortos
- horarios fáciles de seleccionar
- evitar tablas horizontales cuando sea posible

En desktop:

- aprovechar el espacio disponible
- mantener una interfaz limpia
- utilizar layouts de dos columnas cuando ayuden a la experiencia

==================================================
IMPORTANTE SOBRE UX
==================================================

La reserva debe sentirse simple y rápida.

No quiero un formulario administrativo.

El usuario debe sentir que está reservando su turno en una barbería premium.

Reducir la cantidad de decisiones simultáneas.

Mostrar una etapa claramente diferenciada a la vez.

Dar feedback visual después de cada acción.

Los horarios deben ser fáciles de comparar y seleccionar.

Evitar información innecesaria.

No solicitar la creación de una cuenta antes de reservar.

==================================================
DATOS FICTICIOS
==================================================

Utilizar datos ficticios realistas para demostrar cómo funcionaría la interfaz.

Ejemplos de clientes:

- Tomás Blutmann
- Martín González
- Nicolás Rodríguez
- Lucas Fernández

Ejemplos de turnos:

- Corte — Tomás — Gonzalo — 19:00 — Confirmado
- Corte + barba — Martín — Lautaro — 19:30 — Pendiente
- Barba — Nicolás — Valentín — 20:00 — Confirmado

==================================================
RESTRICCIONES
==================================================

NO agregar funcionalidades que no hayan sido especificadas.

NO agregar:

- pagos online
- promociones
- cupones
- puntos
- reviews
- WhatsApp
- SMS
- push notifications
- Google Calendar
- múltiples sucursales
- estadísticas avanzadas
- programa de fidelización
- aplicación nativa
- registro obligatorio

No implementar todavía backend ni base de datos.

Primero quiero validar la experiencia y la interfaz.

Antes de agregar funcionalidades adicionales, priorizar simplicidad, claridad y facilidad de uso.

==================================================
OBJETIVO DE ESTA PRIMERA ETAPA
==================================================

Construir un prototipo navegable de alta fidelidad del producto, con:

- Home
- Selección de servicio
- Selección de barbero
- Selección de fecha
- Selección de horario
- Formulario de datos
- Resumen de reserva
- Confirmación de solicitud
- Panel administrativo
- Próximos turnos
- Turnos pendientes
- Gestión visual de disponibilidad

Utilizar mock data para simular el funcionamiento.

NO conectar todavía una base de datos.

Primero quiero revisar y validar la UX/UI.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://kanibarberstudio.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/50013633-0ea8-4b15-b889-c11c9761f165).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
