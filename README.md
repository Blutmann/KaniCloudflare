# KANI Barber Studio

**Booking Platform · Product Design · UX Research · AI-Assisted Engineering**

A responsive booking, payment, and business management platform designed for KANI Barber Studio, an independent premium barbershop in Martínez, Zona Norte of Buenos Aires, Argentina.

**Live website:** https://www.kanibarber.com

## Overview

KANI began as a UX/UI prototype focused on improving appointment scheduling and reducing uncertainty around waiting times.

The project evolved into a production digital platform connecting the customer booking experience with daily barbershop operations, multi-gateway payment workflows, real-time calendar synchronization, customer management, and digital memberships.

The product was developed through iterative design, AI-assisted software engineering, integration testing, and continuous production refinement.

## The Problem

Traditional walk-in barbershop experiences create uncertainty for customers and operational challenges for professionals.

Customers need predictable appointment times and transparent deposit confirmation, while barbers and studio operators need real-time visibility into availability, daily workload, cash flow, and recurring clients.

The challenge was to introduce digital booking and online deposits without compromising the business's existing service model or premium brand experience.

## Product Goals

- Improve appointment predictability and prevent double-bookings transactionally.
- Reduce friction throughout the mobile and desktop booking journey.
- Prevent stranded unpaid holds while protecting late payments from race conditions.
- Simplify daily scheduling, cash reconciliation, and customer management by role.
- Support secure, traceable multi-gateway payment workflows (Payway and Mercado Pago).
- Provide digital Black Card memberships and flexible promotional benefits.
- Maintain a fast, accessible, SEO-clean responsive experience across light and dark modes.

## Core Capabilities by User Profile

### Customer (`/reservar`, `/cancelar-turno`, `/membresia/$token`)

- **Liquid Glass Booking Flow:** Mobile-first step-by-step booking with service selection, barber choice (or deferred barber selection by time slot), real-time availability, and contact details.
- **7-Minute Temporary Holds & Live Countdown:** Selected slots are held transactionally for 7 minutes with a visible countdown timer during payment, plus immediate release if the user cancels/closes checkout or returns via `/pago/error` without an active charge.
- **Multi-Gateway Online Deposits:** Server-side barber routing using **Mercado Pago Checkout Pro (Orders API)** for Gonzalo and **Payway** for Valentín and Lautaro, with dynamic server-validated deposit amounts.
- **Promotional & Benefit Codes:** Supports percentage discounts, no-deposit (`$0`), and complimentary service codes with direct confirmation when no online deposit is required.
- **Self-Service Cancellation:** Secure tokenized cancellation link (`/cancelar-turno`) enforcing the studio's cancellation window.
- **Black Card Digital Membership:** Personalized digital card with available/consumed sessions, visual session stamps, visit history, and QR verification (`/verificar-membresia/$token`).

### Barber (`/panel-administracion` — `BARBER` role)

- **Scoped Personal Agenda:** Strictly scoped to the barber's own `barber_id` at both API and PostgreSQL RLS/RPC levels.
- **Schedule & Availability Control:** Block/unblock dates or time slots (`UNAVAILABLE`), enable exceptions, and open extraordinary time slots outside base schedules.
- **Quick In-Person Payments:** Record walk-in and appointment balance payments in cash or transfer with automatic deposit deduction and zero double-counting.
- **Google Calendar Sync:** Automatic bidirectional/queue-based event synchronization with each barber's connected Google Calendar.
- **Automated Notifications:** Real-time WhatsApp and email notifications for bookings, confirmations, and cancellations.

### Manager & Administrator (`/panel-administracion` — `MANAGER` & `ADMIN` roles)

- **Production Admin Panel V2:** Consolidated operational workspace (`/panel-administracion` + quick shortcuts `/panel-turnos`, `/panel-horarios`, `/panel-membresias`, `/panel-descuentos`) replacing all legacy admin variants.
- **Multi-Barber Operations:** Full agenda management across barbers, manual appointments, and recurring/fixed weekly appointments.
- **Client Directory:** Centralized client records, visit history, cancellation tracking, and export tools.
- **Black Card Memberships & Benefit Codes:** Create, renew, redeem, and reinstate membership sessions; issue and manage promotional discount codes (`ADMIN`).
- **Real-Date Cash Accounting:** Unified payment ledger tracking **Efectivo**, **Transferencia**, **Payway**, and **Mercado Pago** by real accreditation date (`America/Argentina/Buenos_Aires`), separating deposit date from future appointment date without double-counting when the remaining balance is collected in person.
- **Statistics, Maintenance & Role Permissions:** Revenue and service analytics, payment/notification diagnostics, maintenance utilities, and strict three-tier role enforcement (`ADMIN`, `MANAGER`, `BARBER`).

## UX & Product Design

The design process aligns business requirements with real barbershop workflows and mobile ergonomics.

**Areas of work:**

- Problem framing and operational requirements analysis.
- Information architecture and route consolidation.
- User journeys, edge-case recovery flows, and payment state messaging.
- Liquid Glass visual system across Light and Dark modes.
- Responsive interaction design and accessibility heuristics.
- Performance optimization (asset compression, prebundling, and bundle reduction).

## Technology & Engineering

| Area | Technology |
|---|---|
| Frontend & Routing | React 19, TypeScript, TanStack Start, TanStack Router |
| Build & Runtime | Vite 8, Nitro, Cloudflare Workers |
| Background Automation | Cloudflare Workers Cron (`* * * * *`) |
| Styling | CSS, Tailwind CSS v4, Liquid Glass UI |
| Backend & Database | Supabase, PostgreSQL (transactional RPCs & RLS) |
| Authentication & Authorization | Supabase Auth, server-verified `ADMIN` / `MANAGER` / `BARBER` scopes |
| Online Payments | Payway (card tokenization & settlement) & Mercado Pago Checkout Pro (Orders API + Webhooks) |
| Transactional Email | Resend (with Svix webhook verification) |
| WhatsApp Notifications | Pontiun WhatsApp integration |
| Calendar Integration | Google Calendar OAuth & idempotent sync queue |
| Technical SEO | Server-side HTTP `301` redirects, per-route canonicals, JSON-LD, `sitemap.xml`, `X-Robots-Tag` |
| Testing | Vitest, Testing Library, integration & security suites |
| Version Control | Git, GitHub |

## Engineering Approach

The project combines product thinking with AI-assisted software development:

1. Defining user needs, operational rules, and edge-case constraints.
2. Establishing functional, security, and UX acceptance criteria.
3. Enforcing critical invariants server-side and transactionally in PostgreSQL.
4. Iterating on UI/UX, payment safety, and regression tests.
5. Validating builds, bundle integrity, and Cloudflare Workers configuration before release.

AI tools assist with implementation, auditing, debugging, and testing. Product decisions, requirements, and release approvals remain human-directed.

## Quality & Security

- Server-side staff authentication against `public.staff_profiles` and PostgreSQL RLS/RPCs.
- Transactional availability locking (`pg_advisory_xact_lock`) preventing double-bookings.
- Server-side deposit and benefit quote validation with idempotency keys.
- Webhook signature verification (Mercado Pago, Resend/Svix, Pontiun/WhatsApp).
- Late-payment reconciliation safety net (`confirm_verified_appointment_payment` with `PAID_LATE_REVIEW` conflict protection).
- Environment-isolated secrets and preview indexing protection (`X-Robots-Tag: noindex` on `*.workers.dev`).

## Project Evolution

**Phase 1 — Discovery & UX Prototyping**
Initial booking flow, interaction design, and responsive prototype.

**Phase 2 — Functional Platform**
Supabase/PostgreSQL schema, authentication, availability locking, and administrative workflows.

**Phase 3 — Operational Integrations**
Payway deposit workflows, Resend transactional emails, WhatsApp notifications (Pontiun), and expanded admin tools.

**Phase 4 — Digital Membership Experience**
Black Card digital memberships, QR verification, session tracking, and promotional benefit codes.

**Phase 5 — Admin Panel V2 & Liquid Glass UI**
Production rollout of Admin Panel V2 (`/panel-administracion`) and the unified Liquid Glass booking and administration interface.

**Phase 6 — Multi-Gateway Routing & Real-Date Cash Ledger**
Per-barber payment gateway routing (Mercado Pago Checkout Pro for Gonzalo, Payway for Valentín/Lautaro), dynamic server-side deposits, per-barber base 45-minute schedules, and real accreditation-date accounting for online deposits.

**Phase 7 — Hold Lifecycle & Operational Automations**
Unified 7-minute unpaid hold window with live countdown, immediate server-verified release on checkout abandonment, late-payment recovery safety net, Google Calendar sync queue, and Cloudflare Workers cron maintenance.

**Phase 8 — Technical SEO, Route Consolidation & Asset Optimization**
Canonical metadata, JSON-LD, `sitemap.xml`, server-side HTTP `301` redirects, removal of 77 legacy/duplicate routes and orphaned components, and background WebP optimization.

## Product Status

**Active production deployment**

The live application is available at https://www.kanibarber.com.

## Project Ownership

**Product direction, UX/Product Design, and AI-assisted development:** Tomás Blutmann.

Developed for KANI Barber Studio.

## Development

A compatible Node.js environment (Node 22/24), `pnpm`, and the required environment variables are necessary for local development.

```sh
# Install dependencies
pnpm install

# Start local development server
pnpm run dev

# Run automated tests
pnpm test

# Build for production
pnpm run build
```

Do not commit access tokens, service-role keys, payment credentials, webhook secrets, or production environment files.

## License

No open-source license is granted by default. The source code and visual assets remain subject to their respective ownership and usage rights.
