// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    // The sender address is non-secret and must be available to the server-function bundle
    // as a build-time fallback when Cloudflare runtime bindings are not propagated.
    envPrefix: ["VITE_", "RESEND_FROM_EMAIL"],
    server: {
      allowedHosts: ['.manus.computer'],
    },
    // cloudflare:workers is a Workers runtime built-in, not an npm package.
    // Keep it external so Vite/Rolldown doesn't try to resolve it during build.
    build: {
      rolldownOptions: {
        external: ["cloudflare:workers"],
      },
    },
    optimizeDeps: {
      // Prebundle the complete UI dependency set together. Discovering these
      // during navigation can invalidate React URLs in an already-open preview.
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@radix-ui/react-dialog",
        "@radix-ui/react-slot",
        "lucide-react",
        "class-variance-authority",
        "clsx",
        "tailwind-merge",
      ],
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
