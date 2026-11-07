import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/test/kani-staff-recovery.integration.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
