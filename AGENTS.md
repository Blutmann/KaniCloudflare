<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Stack and Architecture
- **Frontend & Routing:** React 19, TypeScript, Tailwind CSS v4, and TanStack Start (`@tanstack/react-start` + `@tanstack/react-router`) with file-based routing under `src/routes/`. Never edit `src/routeTree.gen.ts` manually, and do not introduce Next.js/Remix conventions (`src/pages/`, `app/layout.tsx`).
- **Build & Runtime:** Vite 8 (`@lovable.dev/vite-tanstack-config`) + Nitro targeting **Cloudflare Workers** (`kanibarberstudio-cloudflare` in `wrangler.jsonc`). The custom SSR/API/webhook entrypoint is `src/server.ts`, and scheduled cron tasks (`* * * * *`) run via `server/plugins/payment-maintenance.ts`.
- **Vite Dependency Prebundling:** Keep UI and core dependencies (`react`, `react-dom`, `@tanstack/react-query`, `@radix-ui/*`, `lucide-react`, etc.) in `vite.config.ts` `optimizeDeps.include` so lazy navigation does not invalidate React module URLs in dev/preview.
- **Database:** Supabase / PostgreSQL with schema migrations in `supabase/migrations/`. Availability locking, double-booking prevention, and state transitions are enforced transactionally in PostgreSQL RPCs and RLS policies—never rely solely on client-side checks.

## Authentication, Roles & Permissions
- **Staff Authentication:** Authenticate staff requests server-side via Supabase Auth (`authenticateStaffRequest` in `src/lib/kani-staff-request.server.ts`) against `public.staff_profiles`. Never trust client-supplied role claims or user/barber IDs.
- **Roles:** Respect the three operational roles (`ADMIN`, `MANAGER`, `BARBER`) defined in `src/lib/kani-permissions.ts` and mirrored in PostgreSQL RLS/RPCs:
  - `ADMIN`: Full operational, business, discount management, maintenance, and role access.
  - `MANAGER`: Operational management across barbers without `ADMIN`-only maintenance/role/discount-admin privileges.
  - `BARBER`: Scoped strictly to their own `barber_id` agenda and permitted views.

## Secrets, Environment & Isolation
- **Never expose or commit secrets:** Never hardcode, log, or commit API keys, tokens, passwords, webhook secrets, or `SUPABASE_SERVICE_ROLE_KEY`. Never prefix private keys with `VITE_` (only public Supabase URL/anon keys belong in `VITE_*`).
- **Cloudflare Runtime Config:** Preserve `"previews": {}` and `"keep_vars": true` in `wrangler.jsonc` so Cloudflare Preview bindings and production secrets are not wiped on deploy.
- **Do Not Assume Preview/DEV Isolation:** Never assume Preview/DEV environments have an independent database. Always verify effective connections, bindings, and credentials before executing operations, and never assume isolation without checking it first.

## Production Protection & Payments
- **Production Safeguards:** Never modify secrets, Cloudflare variables, production payment configuration, or real production data without explicit user authorization. Never perform real payment charges for testing. Before any authorized production operation, identify its target, explain its potential impact, and obtain confirmation.
- **Payway & Mercado Pago:** Production payment settings are active in `wrangler.jsonc`. Never mix production credentials with Sandbox endpoints, never bypass explicit environment gates (`PAYWAY_PRODUCTION_ENABLED`, `PAYWAY_SANDBOX_ENABLED`), and never delete or automatically re-charge historical `payment_attempts`.
- **Server-Side Integrity:** Always compute and validate deposit/service amounts, benefit code quotes, and idempotency keys server-side. Preserve webhook signature verification for Mercado Pago, Resend (`svix-*`), and Pontiun/WhatsApp.
- **Google Calendar & Notifications:** Keep scheduled queue processing (`processCalendarSyncQueue`, `reconcilePendingPayments`) resilient and idempotent.

## Git Workflow, Deployments & Migrations
- **Branching & Integration:** `main` is connected to Cloudflare Workers automatic production deployments (`www.kanibarber.com`). Do not develop directly on `main` (create `feat/*` or `fix/*` branches per `docs/DEPLOYMENT_WORKFLOW.md`), and never integrate/merge changes into `main` without explicit user authorization.
- **No Unauthorized Deploys or Migrations:** Never run `pnpm run deploy`, `npx wrangler deploy`, `wrangler versions upload`, or execute SQL migrations against remote/production Supabase projects without explicit user authorization.

## Regression Prevention & Verification
- **Preserve Existing Flows:** Multiple public booking routes (`/`, `/reservar`, `/reservar-turno`, `/reservar-turno-liquid`, etc.), Black Card memberships (`/membresia/$token`), and admin panels (`/panel-administracion/*`, `/panel-v2/*`, `/admin-v2-liquid/*`) coexist. Changes to shared libraries or components must not break sibling routes.
- **Proportional Testing (using `pnpm`):** Select tests according to the scope of each change—do not impose full suites unnecessarily for purely visual changes, and do not skip relevant tests for functional, permission, payment, or persistence changes:
  - Unit/integration suites via `pnpm test` or targeted suites (`pnpm run test:staff`, `pnpm run test:booking`, or specific Vitest files).
  - **SQL / Supabase Tests:** Tests that interact with Supabase (`pnpm run test:staff:sql`, `pnpm run test:availability:sql`, `supabase test db`) require identifying the target project beforehand and evaluating their effects. Do not execute tests that may modify real data without explicit authorization.
  - Run `pnpm run lint` and `pnpm run build` when verifying code/bundle integrity (confirming `.output/server/wrangler.json` preserves `previews`), and `node scripts/verify-integration-base.mjs` before publishing preview versions.
