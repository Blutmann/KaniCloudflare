/**
 * Constantes institucionales y utilidades de formato canónicas de Kani Barber Studio.
 */

export const KANI_STUDIO_NAME = "Kani Barber Studio";

/**
 * Dirección exacta y oficial del estudio (formato canónico conciso).
 */
export const KANI_STUDIO_ADDRESS = "San Isidro Labrador 7, Martinez";

/**
 * Dirección completa institucional.
 */
export const KANI_STUDIO_FULL_ADDRESS = "San Isidro Labrador 7, Martínez, Provincia de Buenos Aires";

/**
 * Enlace directo oficial a Google Maps con place ID de Kani Barber Studio.
 */
export const KANI_MAPS_URL =
  "https://www.google.com/maps/place/KANI+BARBER+STUDIO/@-34.4939808,-58.5005199,17z/data=!3m1!4b1!4m6!3m5!1s0x95bcb11919d38997:0x48bcfe7b2ea7ba60!8m2!3d-34.4939808!4d-58.497945!16s%2Fg%2F11nvyg5zgw?entry=ttu&g_ep=EgoyMDI2MTAyMC4wIKXMDSoASAFQAw%3D%3D";

/**
 * URL oficial de embed de Google Maps para Kani Barber Studio.
 */
export const KANI_MAPS_EMBED_URL =
  "https://maps.google.com/maps?cid=5241343871369591392&hl=es&output=embed";

/**
 * Seña estándar vigente en pesos argentinos (ARS) para todos los servicios de Kani.
 */
export const KANI_STANDARD_DEPOSIT_ARS = 5000;

/**
 * WhatsApp oficial de contacto público de Kani Barber Studio.
 */
export const KANI_PUBLIC_WHATSAPP_NUMBER = "5491155616438";

/**
 * URL canónica de WhatsApp para contacto público con Kani Barber Studio.
 */
export const KANI_PUBLIC_WHATSAPP_URL = `https://wa.me/${KANI_PUBLIC_WHATSAPP_NUMBER}`;

const SPANISH_MONTHS_TITLE = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

/**
 * Formatea fecha y hora según la especificación exacta de Kani:
 * Ejemplo: "26 Octubre 2026 | 10:00 hs"
 * - Día en dos dígitos
 * - Nombre completo del mes en español
 * - Año en 4 dígitos
 * - Separador ' | '
 * - Hora HH:mm (sin segundos)
 * - Determinista y libre de desfases de huso horario (SSR/cliente consistentes)
 */
export function formatAppointmentDateTime(dateStr?: string | null, timeStr?: string | null): string {
  if (!dateStr) return "";
  const [yearStr, monthStr, dayStr] = dateStr.trim().split("-");
  const year = yearStr;
  const monthIdx = parseInt(monthStr, 10) - 1;
  const day = dayStr ? dayStr.padStart(2, "0") : "";
  const monthName = SPANISH_MONTHS_TITLE[monthIdx] || monthStr;

  const cleanTime = (timeStr || "").trim().slice(0, 5);

  if (cleanTime) {
    return `${day} ${monthName} ${year} | ${cleanTime} hs`;
  }
  return `${day} ${monthName} ${year}`;
}
