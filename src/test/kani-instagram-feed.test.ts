import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleInstagramFeedRequest,
  resetInstagramFeedCacheForTest,
} from "@/lib/kani-instagram-feed.server";

describe("Instagram Feed server endpoint (/api/instagram-feed)", () => {
  const originalBeholdUrl = process.env["BEHOLD_FEED_URL"];
  const originalToken = process.env["INSTAGRAM_ACCESS_TOKEN"];
  const originalUserId = process.env["INSTAGRAM_USER_ID"];

  beforeEach(() => {
    resetInstagramFeedCacheForTest();
    delete process.env["BEHOLD_FEED_URL"];
    delete process.env["INSTAGRAM_ACCESS_TOKEN"];
    delete process.env["INSTAGRAM_USER_ID"];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetInstagramFeedCacheForTest();
    if (originalBeholdUrl !== undefined) process.env["BEHOLD_FEED_URL"] = originalBeholdUrl;
    else delete process.env["BEHOLD_FEED_URL"];
    if (originalToken !== undefined) process.env["INSTAGRAM_ACCESS_TOKEN"] = originalToken;
    else delete process.env["INSTAGRAM_ACCESS_TOKEN"];
    if (originalUserId !== undefined) process.env["INSTAGRAM_USER_ID"] = originalUserId;
    else delete process.env["INSTAGRAM_USER_ID"];
  });

  it("rejects non-GET requests with 405", async () => {
    const res = await handleInstagramFeedRequest(
      new Request("https://www.kanibarber.com/api/instagram-feed", { method: "POST" }),
    );
    expect(res.status).toBe(405);
  });

  it("returns fallback payload with 200 OK when no env vars are configured", async () => {
    const res = await handleInstagramFeedRequest(
      new Request("https://www.kanibarber.com/api/instagram-feed"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const body = await res.json();
    expect(body).toEqual({
      source: "fallback",
      items: [],
    });
  });

  it("parses Behold.so JSON feed, caps strictly to 3 items, caches in memory, and sets 12h s-maxage header", async () => {
    process.env["BEHOLD_FEED_URL"] = "https://feeds.behold.so/test-kani-feed";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          posts: [
            {
              id: "ig-1",
              mediaType: "IMAGE",
              mediaUrl: "https://cdn.behold.so/1.jpg",
              sizes: { medium: { mediaUrl: "https://cdn.behold.so/1-md.jpg" } },
              permalink: "https://www.instagram.com/p/post1/",
              prunedCaption: "Fade clásico en Kani",
              timestamp: "2026-11-26T15:00:00Z",
            },
            {
              id: "ig-2",
              mediaType: "VIDEO",
              isReel: true,
              mediaUrl: "https://cdn.behold.so/2.mp4",
              thumbnailUrl: "https://cdn.behold.so/2-thumb.jpg",
              permalink: "https://www.instagram.com/reel/reel2/",
              caption: "Nuevo reel de corte",
              timestamp: "2026-11-25T15:00:00Z",
            },
            {
              id: "ig-3",
              mediaType: "CAROUSEL_ALBUM",
              mediaUrl: "https://cdn.behold.so/3.jpg",
              permalink: "https://www.instagram.com/p/post3/",
              caption: "Detalle de terminación",
            },
            {
              id: "ig-4",
              mediaType: "IMAGE",
              mediaUrl: "https://cdn.behold.so/4.jpg",
              permalink: "https://www.instagram.com/p/post4/",
              caption: "Cuarto post que no debe aparecer",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await handleInstagramFeedRequest(
      new Request("https://www.kanibarber.com/api/instagram-feed"),
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=43200");
    const body = await first.json();
    expect(body.source).toBe("behold");
    expect(body.items).toHaveLength(3);
    expect(body.items[0]).toMatchObject({
      id: "ig-1",
      mediaType: "IMAGE",
      mediaUrl: "https://cdn.behold.so/1-md.jpg",
      permalink: "https://www.instagram.com/p/post1/",
      caption: "Fade clásico en Kani",
    });
    expect(body.items[1]).toMatchObject({
      id: "ig-2",
      mediaType: "REELS",
      mediaUrl: "https://cdn.behold.so/2-thumb.jpg",
      thumbnailUrl: "https://cdn.behold.so/2-thumb.jpg",
      permalink: "https://www.instagram.com/reel/reel2/",
    });
    expect(body.items[2].id).toBe("ig-3");

    // Second request is served from in-memory cache without another upstream fetch
    const second = await handleInstagramFeedRequest(
      new Request("https://www.kanibarber.com/api/instagram-feed"),
    );
    expect(second.status).toBe(200);
    expect(second.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=43200");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("supports Instagram Graph API when BEHOLD_FEED_URL is not set", async () => {
    process.env["INSTAGRAM_ACCESS_TOKEN"] = "ig-test-token";
    process.env["INSTAGRAM_USER_ID"] = "1784140000000";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "g-1",
              media_type: "IMAGE",
              media_url: "https://scontent.cdninstagram.com/g1.jpg",
              permalink: "https://www.instagram.com/p/g1/",
              caption: "Corte y barba",
              timestamp: "2026-11-26T12:00:00Z",
            },
            {
              id: "g-2",
              media_type: "VIDEO",
              media_url: "https://video.cdninstagram.com/g2.mp4",
              thumbnail_url: "https://scontent.cdninstagram.com/g2-thumb.jpg",
              permalink: "https://www.instagram.com/reel/g2/",
              caption: "Reel en el estudio",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleInstagramFeedRequest(
      new Request("https://www.kanibarber.com/api/instagram-feed"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=43200");
    const body = await res.json();
    expect(body.source).toBe("graph");
    expect(body.items).toHaveLength(2);
    expect(body.items[1]).toMatchObject({
      id: "g-2",
      mediaType: "VIDEO",
      mediaUrl: "https://scontent.cdninstagram.com/g2-thumb.jpg",
      thumbnailUrl: "https://scontent.cdninstagram.com/g2-thumb.jpg",
    });
  });

  it("falls back gracefully with 200 OK if upstream fails or times out", async () => {
    process.env["BEHOLD_FEED_URL"] = "https://feeds.behold.so/test-kani-feed";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("AbortError: timeout")));

    const res = await handleInstagramFeedRequest(
      new Request("https://www.kanibarber.com/api/instagram-feed"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      source: "fallback",
      items: [],
    });
  });
});
