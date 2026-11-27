import { KANI_GOOGLE_REVIEW_URL, KANI_MAPS_URL } from "./kani-constants";

export type GooglePlaceReviewItem = {
  authorName: string;
  rating: number;
  relativePublishTimeDescription: string;
  text: string;
  authorPhotoUri: string | null;
};

export type GoogleReviewsPayload = {
  source: "google_places" | "fallback";
  rating: number | null;
  userRatingCount: number | null;
  mapsUrl: string;
  reviewUrl: string | null;
  reviews: GooglePlaceReviewItem[];
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PLACES_TIMEOUT_MS = 3500;

let cachedEntry: { expiresAt: number; payload: GoogleReviewsPayload } | null = null;

function readEnv(name: string): string {
  const runtimeEnv = (
    globalThis as typeof globalThis & { __KANI_RUNTIME_ENV?: Record<string, string> }
  ).__KANI_RUNTIME_ENV;
  const raw = process.env[name] ?? runtimeEnv?.[name] ?? "";
  return typeof raw === "string" ? raw.trim() : "";
}

function buildFallbackPayload(): GoogleReviewsPayload {
  return {
    source: "fallback",
    rating: null,
    userRatingCount: null,
    mapsUrl: KANI_MAPS_URL,
    reviewUrl: KANI_GOOGLE_REVIEW_URL,
    reviews: [],
  };
}

type RawPlaceReview = {
  rating?: number;
  relativePublishTimeDescription?: string;
  text?: { text?: string };
  originalText?: { text?: string };
  authorAttribution?: {
    displayName?: string;
    photoUri?: string;
  };
};

type RawPlaceResult = {
  id?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  reviews?: RawPlaceReview[];
};

function normalizePlaceResult(place: RawPlaceResult): GoogleReviewsPayload {
  const placeId = typeof place.id === "string" && place.id.trim() ? place.id.trim() : null;
  const reviews: GooglePlaceReviewItem[] = Array.isArray(place.reviews)
    ? place.reviews
        .map((r) => {
          const text = (r.text?.text || r.originalText?.text || "").trim();
          const authorName = (r.authorAttribution?.displayName || "Cliente").trim();
          const rating = typeof r.rating === "number" ? r.rating : 5;
          const relativePublishTimeDescription = (r.relativePublishTimeDescription || "").trim();
          const authorPhotoUri = r.authorAttribution?.photoUri?.trim() || null;
          return {
            authorName,
            rating,
            relativePublishTimeDescription,
            text,
            authorPhotoUri,
          };
        })
        .filter((r) => r.text.length > 0)
        .slice(0, 5)
    : [];

  return {
    source: "google_places",
    rating: typeof place.rating === "number" ? place.rating : null,
    userRatingCount: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
    mapsUrl: place.googleMapsUri?.trim() || KANI_MAPS_URL,
    reviewUrl:
      KANI_GOOGLE_REVIEW_URL ||
      (placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : null),
    reviews,
  };
}

async function fetchGooglePlacesData(apiKey: string, placeId?: string): Promise<GoogleReviewsPayload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLACES_TIMEOUT_MS);

  try {
    let place: RawPlaceResult | undefined;

    if (placeId) {
      const res = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=es`,
        {
          method: "GET",
          headers: {
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "id,rating,userRatingCount,googleMapsUri,reviews",
          },
          signal: controller.signal,
        },
      );
      if (!res.ok) throw new Error(`Places API error: ${res.status}`);
      place = (await res.json()) as RawPlaceResult;
    } else {
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.id,places.rating,places.userRatingCount,places.googleMapsUri,places.reviews",
        },
        body: JSON.stringify({
          textQuery: "Kani Barber Studio San Isidro Labrador 7 Martinez",
          languageCode: "es",
          maxResultCount: 1,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Places searchText error: ${res.status}`);
      const data = (await res.json()) as { places?: RawPlaceResult[] };
      place = data.places?.[0];
    }

    if (!place) return buildFallbackPayload();
    return normalizePlaceResult(place);
  } finally {
    clearTimeout(timeout);
  }
}

export function resetGoogleReviewsCacheForTest(): void {
  cachedEntry = null;
}

export async function handleGoogleReviewsRequest(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const now = Date.now();
  if (cachedEntry && cachedEntry.expiresAt > now) {
    return new Response(JSON.stringify(cachedEntry.payload), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=3600, s-maxage=86400",
      },
    });
  }

  const apiKey = readEnv("GOOGLE_PLACES_API_KEY");
  const placeId = readEnv("GOOGLE_PLACES_PLACE_ID") || undefined;

  if (!apiKey) {
    return new Response(JSON.stringify(buildFallbackPayload()), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  }

  try {
    const payload = await fetchGooglePlacesData(apiKey, placeId);
    cachedEntry = {
      expiresAt: now + CACHE_TTL_MS,
      payload,
    };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=3600, s-maxage=86400",
      },
    });
  } catch (err) {
    console.warn("[google-reviews] Falling back to static Maps link:", err);
    return new Response(JSON.stringify(buildFallbackPayload()), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  }
}
