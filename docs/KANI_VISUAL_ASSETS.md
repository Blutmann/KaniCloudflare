# Kani — assets definitivos del ZIP `kani def.zip`

Base: `af128f6`. Reemplazo visual exclusivamente; no se modifica lógica de reservas, administración ni integraciones.

## Originales conservados sin modificar bytes

| Archivo adjunto | Píxeles | Ubicación original completa |
| --- | --- | --- |
| `Kani fondo mobile claro 1440x3200.webp` | 1440×3200 | `public/kani-fondo-claro-mobile-blanco.webp` |
| `Kani fondo mobile oscuro 1440x3200.webp` | 1440×3200 | `public/kani-fondo-oscuro-mobile.webp` |
| `Kani fondo desktop claro 3840x2160.webp` | 3840×2160 | `public/kani-fondo-claro-desktop-blanco.webp` |
| `Kani fondo desktop oscuro 3840x2160.webp` | 3840×2160 | `public/kani-fondo-oscuro-desktop.webp` |
| `logo-kani.webp` | 4299×2262, RGBA | `src/assets/originals/logo-kani.webp` |
| `kanji-bordo.webp` | 1724×1752, RGBA | `src/assets/originals/kanji-bordo.webp` |

Todos los adjuntos son WebP estáticos. Los fondos son RGB opacos; logo y kanji conservan alfa. No se crea contenido ni se modifican colores, tintes o transparencia de los originales.

## Variantes de entrega

- Fondos Mobile: 720×1600, 1080×2400 y original 1440×3200 mediante image-set para distintas densidades.
- Fondos Desktop: 1920×1080 y original 3840×2160. Viewports mayores de 1920 px de ancho o 1080 px de alto usan el original.
- Logo: 384×202 y 768×404 mediante srcset/sizes; original archivado completo.
- Kanji: 431×438 y 862×876 mediante srcset/sizes; original archivado completo. Reemplaza el PNG anterior usado en el acceso administrativo.
- Variantes obtenidas únicamente por reducción proporcional Lanczos y codificación WebP lossless. Se comprobó igualdad de píxeles entre el bitmap redimensionado y su WebP decodificado; sin compresión con pérdida adicional.
- Los originales de logo/kanji no se incluyen en el bundle: sólo se importan las variantes proporcionadas para sus tamaños de interfaz.

Se preservan fondo fixed/cover/no-repeat, recorte proporcional, breakpoint 768 px y tratamientos de tema existentes. El menú reutiliza la misma imagen correspondiente sin descargar un fondo antiguo distinto.

La altura de la caja del logo pasa de 54/38 px a 66/46 px, con desplazamiento localizado de 6/4 px para compensar exclusivamente el margen transparente mayor y asimétrico del original nuevo. Su tinta visible mantiene aproximadamente la escala y alineación anteriores; sin recortes ni filtros nuevos. Los atributos width/height evitan saltos durante la carga. El kanji mantiene sus cajas existentes de 112/68 px con object-fit contain.

## Verificación

- 360×800, 375, 390, 430, 1440 y 2560 px; Light/Dark; DPR 1, 2 y 3.
- Flujo de Reserva V2 hasta Datos y CTA habilitado, sin crear turnos ni pagos; header, menú, scroll, viewport reducido simulando teclado, login público con kanji.
- CLS del header/logo medido: 0 en la matriz local. No overflow horizontal ni errores de assets/hidratación en Reserva V2 o login.
- 7 tests existentes de fondos aprobados; build aprobado. Suite completa: 402 aprobadas y los mismos dos fallos previos de estadísticas/columnas manuales.
- Aviso de React #418 en /estudio reproducido también en la versión publicada anterior; no se modifica esa página ni su lógica.

Los archivos antiguos sin referencias de ejecución se dejan intactos salvo el PNG del kanji que fue reemplazado; no se realiza limpieza general.
