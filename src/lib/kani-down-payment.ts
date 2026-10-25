const downPaymentCache = new Map<string, { amount: number; timestamp: number }>();
const DOWN_PAYMENT_CACHE_TTL_MS = 60 * 1000;

/**
 * Obtiene el monto dinámico de la seña según el barbero y la RPC pública de base de datos.
 * Aislado de dependencias de node:crypto para compatibilidad pura con bundles cliente.
 */
export async function getDynamicDownPayment(
  barberName?: string | null,
  options: { bypassCache?: boolean } = {},
): Promise<number> {
  const key = barberName?.trim() || "__ALL__";
  const now = Date.now();
  if (!options.bypassCache) {
    const cached = downPaymentCache.get(key);
    if (cached && now - cached.timestamp < DOWN_PAYMENT_CACHE_TTL_MS) {
      return cached.amount;
    }
  }
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.rpc("read_public_deposit_amount", {
      p_barber_name: barberName?.trim() || null,
    });
    if (!error && typeof data === "number" && data > 0) {
      const unified = data <= 5000 ? data : 5000;
      downPaymentCache.set(key, { amount: unified, timestamp: now });
      return unified;
    }
  } catch {
    // Si la RPC aún no está creada o la conexión falla, se retorna el valor por omisión estándar
  }
  return 5000;
}
