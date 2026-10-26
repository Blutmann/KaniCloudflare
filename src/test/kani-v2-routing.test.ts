import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.gen";

describe("V2 parallel routing", () => {
  for (const section of ["inicio", "turnos", "horarios", "pagos", "clientes", "datos"]) {
    it(`keeps /admin-v2/${section} under its own layout`, () => {
      const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
      const matches = router.matchRoutes(`/admin-v2/${section}`);
      expect(matches.at(-1)?.routeId).toBe(`/admin-v2/${section}`);
      expect(matches.some((m) => m.routeId === "/admin")).toBe(false);
      expect(matches.some((m) => m.routeId === "/admin-v2")).toBe(true);
    });
  }
  for (const path of ["/admin", "/admin/horarios", "/admin/pagos", "/admin/datos", "/reservar", "/reserva-v2", "/reserva-v3"]) {
    it(`preserves ${path} independently`, () => {
      const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
      expect(router.matchRoutes(path).some((m) => m.routeId === "/admin-v2")).toBe(false);
      expect(router.matchRoutes(path).at(-1)?.routeId).toContain(path);
    });
  }
});
