export type StudioOpenStatus = {
  isOpen: boolean;
  label: string;
};

/**
 * Calcula si el estudio se encuentra abierto en horario de Buenos Aires
 * (Lunes a sábados de 10:00 a 20:00 hs).
 */
export function getStudioOpenStatus(now: Date = new Date()): StudioOpenStatus {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Argentina/Buenos_Aires",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");

    const isSunday = weekday === "Sun";

    if (!isSunday && hour >= 10 && hour < 20) {
      return { isOpen: true, label: "Abierto · Hasta las 20:00 hs" };
    }

    return { isOpen: false, label: "Cerrado" };
  } catch {
    return { isOpen: false, label: "Cerrado" };
  }
}
