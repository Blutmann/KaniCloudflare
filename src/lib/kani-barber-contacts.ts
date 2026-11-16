export interface BarberContactRecord {
  slug: "lautaro" | "gonzalo" | "valentin" | "franco";
  displayName: string;
  whatsapp: string;
  email: string;
  aliases: readonly string[];
}

/**
 * Fuente única de verdad para los contactos de notificación de cada barbero.
 * Los IDs reales provienen de la tabla `public.barbers` en Supabase y se resuelven
 * por `barber_id` -> nombre canónico normalizado.
 */
export const KANI_BARBER_CONTACTS: readonly BarberContactRecord[] = [
  {
    slug: "lautaro",
    displayName: "Lautaro",
    whatsapp: "5491131486834",
    email: "lautarodejesus08@gmail.com",
    aliases: ["lautaro", "lautaro de jesus"],
  },
  {
    slug: "gonzalo",
    displayName: "Gonzalo",
    whatsapp: "5491136360003",
    email: "gonzalomatiasss123@gmail.com",
    aliases: ["gonzalo", "gonzalo pierucci"],
  },
  {
    slug: "valentin",
    displayName: "Valentín",
    whatsapp: "5491133992102",
    email: "carrizovalentin10@gmail.com",
    aliases: ["valentin", "valentin carrizo"],
  },
  {
    slug: "franco",
    displayName: "Franco",
    whatsapp: "5491139566333",
    email: "Franco.dejesus.02@gmail.com",
    aliases: ["franco", "franco de jesus"],
  },
] as const;

export function normalizeBarberLookupKey(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export interface ResolvedBarberContact {
  barberId: string | null;
  barberName: string;
  whatsapp: string | null;
  email: string | null;
  source: "db" | "registry" | "missing";
}

export function resolveBarberContact(input: {
  barberId?: string | null;
  barberName?: string | null;
  dbEmail?: string | null;
  dbWhatsapp?: string | null;
}): ResolvedBarberContact {
  const rawName = (input.barberName ?? "").trim();
  const normalizedName = normalizeBarberLookupKey(rawName);
  const normalizedId = normalizeBarberLookupKey(input.barberId);

  const matched = KANI_BARBER_CONTACTS.find((entry) => {
    if (normalizedId && entry.slug === normalizedId) return true;
    if (!normalizedName) return false;
    return (
      entry.slug === normalizedName ||
      entry.aliases.some((alias) => alias === normalizedName) ||
      normalizedName.startsWith(`${entry.slug} `)
    );
  });

  const dbEmail = (input.dbEmail ?? "").trim() || null;
  const dbWhatsapp = (input.dbWhatsapp ?? "").trim() || null;

  const email = dbEmail ?? matched?.email ?? null;
  const whatsapp = dbWhatsapp ?? matched?.whatsapp ?? null;

  return {
    barberId: input.barberId ?? null,
    barberName: rawName || matched?.displayName || "Barbero",
    whatsapp,
    email,
    source: dbEmail || dbWhatsapp ? "db" : matched ? "registry" : "missing",
  };
}
