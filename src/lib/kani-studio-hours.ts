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
    const isSaturday = weekday === "Sat";

    if (isSunday) {
      return { isOpen: false, label: "Cerrado · Abre lunes 10:00" };
    }

    if (hour >= 10 && hour < 20) {
      return { isOpen: true, label: "Abierto ahora · Hasta las 20:00" };
    }

    if (hour < 10) {
      return { isOpen: false, label: "Cerrado · Abre hoy 10:00" };
    }

    if (isSaturday) {
      return { isOpen: false, label: "Cerrado · Abre lunes 10:00" };
    }

    return { isOpen: false, label: "Cerrado · Abre mañana 10:00" };
  } catch {
    return { isOpen: false, label: "Lunes a sábados · 10:00 a 20:00" };
  }
}
