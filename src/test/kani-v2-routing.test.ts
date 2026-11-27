import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.gen";

describe("Consolidated active routing (Phase 3)", () => {
  for (const section of [
    "inicio",
    "turnos",
    "horarios",
    "pagos",
    "clientes",
    "datos",
    "descuentos",
    "membresias",
    "mantenimiento",
  ]) {
    it(`keeps /panel-administracion/${section} under /panel-administracion layout`, () => {
      const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
      const matches = router.matchRoutes(`/panel-administracion/${section}`);
      expect(matches.at(-1)?.routeId).toBe(`/panel-administracion/${section}`);
      expect(matches.some((m) => m.routeId === "/panel-administracion")).toBe(true);
    });
  }

  for (const activePath of [
    "/reservar",
    "/contacto",
    "/cancelar-turno",
    "/politica-de-privacidad",
    "/terminos-y-condiciones",
    "/case-study",
    "/panel-turnos",
    "/panel-horarios",
    "/panel-membresias",
    "/panel-descuentos",
  ]) {
    it(`preserves active route ${activePath} independently`, () => {
      const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
      expect(router.matchRoutes(activePath).at(-1)?.routeId).toBe(activePath);
    });
  }
});
