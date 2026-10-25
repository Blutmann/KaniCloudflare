import { createClient } from "@supabase/supabase-js";
import { getRuntimeEnv } from "./kani-mercadopago.server";

// Never import from browser code or fall back to a public/anon key for payment writes.
export async function createPaymentSupabaseClient() {
  const url = getRuntimeEnv("SUPABASE_URL") ?? getRuntimeEnv("VITE_SUPABASE_URL") ?? import.meta.env.VITE_SUPABASE_URL;
  const key = getRuntimeEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("PAYMENT_SERVER_CONFIGURATION_MISSING");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
