export const KANI_SITE_ORIGIN = "https://www.kanibarber.com";
export const KANI_DEFAULT_OG_IMAGE = `${KANI_SITE_ORIGIN}/kani-email-logo.png`;

export type PageHeadOptions = {
  canonicalPath?: string;
  noindex?: boolean;
  robots?: string;
  ogImage?: string;
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
};

export function resolveCanonicalUrl(canonicalPath?: string): string | undefined {
  if (!canonicalPath || !canonicalPath.trim()) return undefined;
  const trimmed = canonicalPath.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const normalizedPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${KANI_SITE_ORIGIN}${normalizedPath}`;
}

export function buildKaniLocalBusinessJsonLd(pageUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BarberShop",
    name: "Kani Barber Studio",
    url: pageUrl,
    image: KANI_DEFAULT_OG_IMAGE,
    description:
      "Barbería en Martínez, Zona Norte de Buenos Aires. Reservá tu turno online en Kani Barber Studio.",
    address: {
      "@type": "PostalAddress",
      streetAddress: "San Isidro Labrador 7",
      addressLocality: "Martínez",
      addressRegion: "Buenos Aires",
      addressCountry: "AR",
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        opens: "10:00",
        closes: "20:00",
      },
    ],
    sameAs: ["https://www.instagram.com/kanibarberstudio/"],
    potentialAction: {
      "@type": "ReserveAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${KANI_SITE_ORIGIN}/reservar`,
      },
      result: {
        "@type": "Reservation",
        name: "Reserva de turno en Kani Barber Studio",
      },
    },
  };
}

export function pageHead(
  title: string,
  description: string,
  documentTitle = `${title} - Kani Barber Studio`,
  options?: PageHeadOptions,
) {
  const canonicalUrl = resolveCanonicalUrl(options?.canonicalPath);
  const ogImage = options?.ogImage || KANI_DEFAULT_OG_IMAGE;
  const robotsContent = options?.robots ?? (options?.noindex ? "noindex, nofollow" : undefined);

  const meta: Array<Record<string, string>> = [
    { title: documentTitle },
    { name: "description", content: description },
    { property: "og:title", content: documentTitle },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Kani Barber Studio" },
    { property: "og:locale", content: "es_AR" },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: documentTitle },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];

  if (canonicalUrl) {
    meta.push({ property: "og:url", content: canonicalUrl });
  }

  if (robotsContent) {
    meta.push({ name: "robots", content: robotsContent });
  }

  const links = canonicalUrl ? [{ rel: "canonical", href: canonicalUrl }] : [];

  const jsonLdItems = options?.jsonLd
    ? Array.isArray(options.jsonLd)
      ? options.jsonLd
      : [options.jsonLd]
    : [];

  const scripts = jsonLdItems.map((item) => ({
    type: "application/ld+json",
    children: JSON.stringify(item),
  }));

  return {
    meta,
    ...(links.length > 0 ? { links } : {}),
    ...(scripts.length > 0 ? { scripts } : {}),
  };
}
