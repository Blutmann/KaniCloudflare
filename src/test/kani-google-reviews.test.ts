import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleGoogleReviewsRequest,
  resetGoogleReviewsCacheForTest,
} from "@/lib/kani-google-reviews.server";
import { getStudioOpenStatus } from "@/lib/kani-studio-hours";
import { KANI_MAPS_URL } from "@/lib/kani-constants";

describe("Google Reviews server endpoint & studio hours", () => {
  const originalKey = process.env["GOOGLE_PLACES_API_KEY"];
  const originalPlaceId = process.env["GOOGLE_PLACES_PLACE_ID"];

  beforeEach(() => {
    resetGoogleReviewsCacheForTest();
    delete process.env["GOOGLE_PLACES_API_KEY"];
    delete process.env["GOOGLE_PLACES_PLACE_ID"];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetGoogleReviewsCacheForTest();
    if (originalKey !== undefined) process.env["GOOGLE_PLACES_API_KEY"] = originalKey;
    else delete process.env["GOOGLE_PLACES_API_KEY"];
    if (originalPlaceId !== undefined) process.env["GOOGLE_PLACES_PLACE_ID"] = originalPlaceId;
    else delete process.env["GOOGLE_PLACES_PLACE_ID"];
  });

  it("returns fallback payload with 200 OK when GOOGLE_PLACES_API_KEY is missing", async () => {
    const res = await handleGoogleReviewsRequest(new Request("https://www.kanibarber.com/api/google-reviews"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      source: "fallback",
      rating: null,
      userRatingCount: null,
      mapsUrl: KANI_MAPS_URL,
      reviewUrl: null,
      reviews: [],
    });
  });

  it("fetches Google Places API (New), normalizes reviews, builds writereview URL, and caches for 24h", async () => {
    process.env["GOOGLE_PLACES_API_KEY"] = "test-places-key";
    process.env["GOOGLE_PLACES_PLACE_ID"] = "ChIJtestPlace123";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "ChIJtestPlace123",
          rating: 4.9,
          userRatingCount: 128,
          googleMapsUri: "https://maps.google.com/?cid=123",
          reviews: [
            {
              rating: 5,
              relativePublishTimeDescription: "hace 2 semanas",
              text: { text: "Excelente atención y corte impecable." },
              authorAttribution: { displayName: "Mateo G." },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await handleGoogleReviewsRequest(new Request("https://www.kanibarber.com/api/google-reviews"));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.source).toBe("google_places");
    expect(firstBody.rating).toBe(4.9);
    expect(firstBody.userRatingCount).toBe(128);
    expect(firstBody.reviewUrl).toBe("https://search.google.com/local/writereview?placeid=ChIJtestPlace123");
    expect(firstBody.reviews).toHaveLength(1);
    expect(firstBody.reviews[0].authorName).toBe("Mateo G.");

    // Second call hits in-memory 24h cache without calling fetch again
    const second = await handleGoogleReviewsRequest(new Request("https://www.kanibarber.com/api/google-reviews"));
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back gracefully if Google Places API fails", async () => {
    process.env["GOOGLE_PLACES_API_KEY"] = "test-places-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network timeout")));

    const res = await handleGoogleReviewsRequest(new Request("https://www.kanibarber.com/api/google-reviews"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("fallback");
    expect(body.reviews).toEqual([]);
  });

  it("computes open/closed status in Buenos Aires timezone", () => {
    // Wednesday 15:00 ART (18:00 UTC) -> Open
    expect(getStudioOpenStatus(new Date("2026-11-25T18:00:00Z"))).toEqual({
      isOpen: true,
      label: "Abierto ahora · Hasta las 20:00",
    });
    // Sunday 15:00 ART (18:00 UTC) -> Closed until Monday
    expect(getStudioOpenStatus(new Date("2026-11-29T18:00:00Z"))).toEqual({
      isOpen: false,
      label: "Cerrado · Abre lunes 10:00",
    });
  });
});
