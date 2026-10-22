export type ClientOrder = "newest" | "oldest" | "name-asc" | "name-desc";

/** Sort a copy so changing the presentation never changes shared client state. */
export function sortClients<T extends { name: string; created_at: string }>(
  clients: readonly T[],
  order: ClientOrder,
): T[] {
  return [...clients].sort((a, b) => {
    if (order === "name-asc" || order === "name-desc") {
      const comparison = a.name.localeCompare(b.name, "es", { sensitivity: "base" });
      return order === "name-asc" ? comparison : -comparison;
    }
    const comparison = Date.parse(a.created_at) - Date.parse(b.created_at);
    return order === "oldest" ? comparison : -comparison;
  });
}
