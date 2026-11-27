export type InstagramMediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "REELS";

export type InstagramFeedItem = {
  id: string;
  mediaType: InstagramMediaType;
  mediaUrl: string;
  thumbnailUrl: string | null;
  permalink: string;
  caption: string;
  timestamp: string | null;
};

export type InstagramFeedPayload = {
  source: "behold" | "graph" | "fallback";
  items: InstagramFeedItem[];
};

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3500;
const MAX_ITEMS = 3;

let cachedEntry: { expiresAt: number; payload: InstagramFeedPayload } | null = null;

function readEnv(name: string): string {
  const runtimeEnv = (
    globalThis as typeof globalThis & { __KANI_RUNTIME_ENV?: Record<string, string> }
  ).__KANI_RUNTIME_ENV;
  const raw = process.env[name] ?? runtimeEnv?.[name] ?? "";
  return typeof raw === "string" ? raw.trim() : "";
}

function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeMediaType(raw: unknown, isReel?: boolean): InstagramMediaType {
  if (isReel === true) return "REELS";
  if (typeof raw !== "string") return "IMAGE";
  const upper = raw.trim().toUpperCase();
  if (upper === "VIDEO") return "VIDEO";
  if (upper === "REELS" || upper === "REEL") return "REELS";
  if (upper === "CAROUSEL_ALBUM") return "CAROUSEL_ALBUM";
  return "IMAGE";
}

function buildFallbackPayload(): InstagramFeedPayload {
  return {
    source: "fallback",
    items: [],
  };
}

type RawBeholdSize = {
  mediaUrl?: string;
};

type RawBeholdPost = {
  id?: string | number;
  mediaType?: string;
  isReel?: boolean;
  mediaUrl?: string;
  thumbnailUrl?: string;
  permalink?: string;
  caption?: string;
  prunedCaption?: string;
  timestamp?: string;
  sizes?: {
    small?: RawBeholdSize;
    medium?: RawBeholdSize;
    large?: RawBeholdSize;
  };
};

type RawGraphMediaItem = {
  id?: string | number;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  caption?: string;
  timestamp?: string;
};

function normalizeBeholdPosts(raw: unknown): InstagramFeedItem[] {
  const list: RawBeholdPost[] = Array.isArray(raw)
    ? (raw as RawBeholdPost[])
    : raw && typeof raw === "object" && Array.isArray((raw as { posts?: unknown }).posts)
      ? ((raw as { posts: RawBeholdPost[] }).posts)
      : [];

  const items: InstagramFeedItem[] = [];
  for (const post of list) {
    if (items.length >= MAX_ITEMS) break;
    if (!post || typeof post !== "object") continue;

    const id = post.id !== undefined && post.id !== null ? String(post.id).trim() : "";
    const permalink = isSafeHttpsUrl(post.permalink) ? post.permalink.trim() : "";
    if (!id || !permalink) continue;

    const mediaType = normalizeMediaType(post.mediaType, post.isReel);
    const sizedUrl =
      (isSafeHttpsUrl(post.sizes?.medium?.mediaUrl) && post.sizes?.medium?.mediaUrl.trim()) ||
      (isSafeHttpsUrl(post.sizes?.large?.mediaUrl) && post.sizes?.large?.mediaUrl.trim()) ||
      (isSafeHttpsUrl(post.sizes?.small?.mediaUrl) && post.sizes?.small?.mediaUrl.trim()) ||
      null;
    const rawThumb = isSafeHttpsUrl(post.thumbnailUrl) ? post.thumbnailUrl.trim() : null;
    const rawMedia = isSafeHttpsUrl(post.mediaUrl) ? post.mediaUrl.trim() : null;

    const thumbnailUrl = rawThumb ?? (mediaType === "VIDEO" || mediaType === "REELS" ? sizedUrl : null);
    const mediaUrl =
      mediaType === "VIDEO" || mediaType === "REELS"
        ? (thumbnailUrl ?? rawMedia)
        : (sizedUrl ?? rawMedia ?? rawThumb);

    if (!mediaUrl) continue;

    const captionRaw =
      typeof post.prunedCaption === "string" && post.prunedCaption.trim()
        ? post.prunedCaption
        : typeof post.caption === "string"
          ? post.caption
          : "";

    items.push({
      id,
      mediaType,
      mediaUrl,
      thumbnailUrl,
      permalink,
      caption: captionRaw.trim().slice(0, 160),
      timestamp: typeof post.timestamp === "string" && post.timestamp.trim() ? post.timestamp.trim() : null,
    });
  }

  return items;
}

function normalizeGraphMedia(raw: unknown): InstagramFeedItem[] {
  const list: RawGraphMediaItem[] =
    raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
      ? ((raw as { data: RawGraphMediaItem[] }).data)
      : [];

  const items: InstagramFeedItem[] = [];
  for (const post of list) {
    if (items.length >= MAX_ITEMS) break;
    if (!post || typeof post !== "object") continue;

    const id = post.id !== undefined && post.id !== null ? String(post.id).trim() : "";
    const permalink = isSafeHttpsUrl(post.permalink) ? post.permalink.trim() : "";
    if (!id || !permalink) continue;

    const mediaType = normalizeMediaType(post.media_type);
    const thumbnailUrl = isSafeHttpsUrl(post.thumbnail_url) ? post.thumbnail_url.trim() : null;
    const rawMedia = isSafeHttpsUrl(post.media_url) ? post.media_url.trim() : null;
    const mediaUrl =
      mediaType === "VIDEO" || mediaType === "REELS"
        ? (thumbnailUrl ?? rawMedia)
        : (rawMedia ?? thumbnailUrl);

    if (!mediaUrl) continue;

    items.push({
      id,
      mediaType,
      mediaUrl,
      thumbnailUrl,
      permalink,
      caption: typeof post.caption === "string" ? post.caption.trim().slice(0, 160) : "",
      timestamp: typeof post.timestamp === "string" && post.timestamp.trim() ? post.timestamp.trim() : null,
    });
  }

  return items;
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Instagram feed upstream error: ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchInstagramFeedPayload(): Promise<InstagramFeedPayload> {
  const beholdFeedUrl = readEnv("BEHOLD_FEED_URL");
  if (beholdFeedUrl) {
    if (!isSafeHttpsUrl(beholdFeedUrl)) {
      throw new Error("Invalid BEHOLD_FEED_URL");
    }
    const raw = await fetchJsonWithTimeout(beholdFeedUrl);
    const items = normalizeBeholdPosts(raw);
    return items.length > 0 ? { source: "behold", items } : buildFallbackPayload();
  }

  const accessToken = readEnv("INSTAGRAM_ACCESS_TOKEN");
  const userId = readEnv("INSTAGRAM_USER_ID");
  if (accessToken && userId) {
    const graphUrl =
      `https://graph.instagram.com/${encodeURIComponent(userId)}/media` +
      `?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp` +
      `&limit=${MAX_ITEMS}&access_token=${encodeURIComponent(accessToken)}`;
    const raw = await fetchJsonWithTimeout(graphUrl);
    const items = normalizeGraphMedia(raw);
    return items.length > 0 ? { source: "graph", items } : buildFallbackPayload();
  }

  return buildFallbackPayload();
}

export function resetInstagramFeedCacheForTest(): void {
  cachedEntry = null;
}

export async function handleInstagramFeedRequest(request: Request): Promise<Response> {
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
        "cache-control": "public, max-age=3600, s-maxage=43200",
      },
    });
  }

  const hasBehold = Boolean(readEnv("BEHOLD_FEED_URL"));
  const hasGraph = Boolean(readEnv("INSTAGRAM_ACCESS_TOKEN") && readEnv("INSTAGRAM_USER_ID"));

  if (!hasBehold && !hasGraph) {
    return new Response(JSON.stringify(buildFallbackPayload()), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  }

  try {
    const payload = await fetchInstagramFeedPayload();
    if (payload.source !== "fallback") {
      cachedEntry = {
        expiresAt: now + CACHE_TTL_MS,
        payload,
      };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=3600, s-maxage=43200",
        },
      });
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  } catch (err) {
    console.warn("[instagram-feed] Falling back to static Instagram link:", err);
    return new Response(JSON.stringify(buildFallbackPayload()), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  }
}
