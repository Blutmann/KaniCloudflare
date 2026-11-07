// Existing public project defaults, shared by browser and stateless server Auth clients.
// These are publishable configuration values. Never place a service-role key here.
export const DEFAULT_SUPABASE_URL = "https://iockpxtkflyjfagkvgnr.supabase.co";
export const DEFAULT_SUPABASE_PUBLIC_KEY = "sb_publishable_jLUHqN-Y_2az8c0Y2yG3mA_gl618304";

export function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    // Opaque publishable keys belong in apikey, not in the JWT bearer header.
    if (
      (supabaseKey.startsWith("sb_publishable_") || supabaseKey.startsWith("sb_secret_")) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    )
      headers.delete("Authorization");
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}
