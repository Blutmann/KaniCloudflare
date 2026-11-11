# KANI Barber Studio

**Booking Platform · Product Design · UX Research · AI-Assisted Engineering**

A responsive booking and business management platform designed for KANI Barber Studio, an independent premium barbershop in Buenos Aires, Argentina.

**Live website:** https://www.kanibarber.com

## Overview

KANI began as a UX/UI prototype focused on improving appointment scheduling and reducing uncertainty around waiting times.

The project evolved into a production-oriented digital platform connecting the customer booking experience with daily barbershop operations, payment workflows, customer management, and digital memberships.

The product was developed through iterative design, AI-assisted software engineering, integration testing, and continuous refinement.

## The Problem

Traditional walk-in barbershop experiences can create uncertainty for customers and operational challenges for professionals.

Customers need predictable appointment times, while barbers need better visibility into availability, reservations, and daily workload.

The challenge was to introduce digital booking without compromising the business's existing service model or premium brand experience.

## Product Goals

- Improve appointment predictability.
- Reduce friction throughout the booking journey.
- Simplify daily scheduling and customer management.
- Support secure, traceable payment workflows.
- Introduce digital memberships and customer benefits.
- Maintain a consistent responsive experience.
- Build a scalable foundation for future product iterations.

## Core Features

### Customer Experience

- Responsive appointment booking.
- Service and barber selection.
- Real-time availability management.
- Customer information and booking confirmation.
- Booking deposits and payment integration.
- Promotional discount codes.
- Digital membership cards with QR verification.

### Business Administration

- Appointment management.
- Barber availability and scheduling.
- Customer directory and records.
- Payment tracking.
- Membership and session management.
- Business statistics and operational insights.
- Role-based access for administrators, managers, and barbers.

### Digital Membership Experience

The Black Card experience introduces a premium digital membership credential featuring:

- Personalized membership information.
- Available and consumed sessions.
- Digital session stamps.
- Visit history.
- QR-based membership verification.
- Authorized session redemption and reinstatement.

## UX & Product Design

The design process focuses on aligning business requirements with user needs and operational constraints.

**Areas of work:**

- Problem framing and requirements analysis.
- Information architecture.
- User journeys and task flows.
- Responsive interaction design.
- Visual hierarchy and usability heuristics.
- Iterative prototyping.
- Accessibility considerations.
- Product evaluation and refinement.

### Information Architecture — Admin Panel V2

An alternative administration experience was introduced to address the increasing complexity of the original navigation.

The proposed structure separates the platform into two workspaces:

**Operations:** Appointments, Availability, Customers, Payments.

**Business:** Memberships, Discounts, Analytics.

The architecture preserves independent functional pages and existing workflows while reducing simultaneous navigation choices.

The redesign is an implementation of a UX hypothesis, with qualitative user validation planned as a subsequent activity.

## Technology & Engineering

| Area | Technology |
|---|---|
| Frontend | React, TypeScript, TanStack Start |
| Build tooling | Vite |
| Styling | CSS, Tailwind CSS |
| Backend & database | Supabase, PostgreSQL |
| Authentication & authorization | Supabase Auth, role-based access |
| Hosting & deployment | Cloudflare Workers |
| Transactional email | Resend |
| Testing | Vitest, integration and browser-based validation |
| Version control | Git, GitHub |
| Development workflow | AI-assisted engineering and iterative implementation |

Additional integrations and configuration requirements are maintained within the project source and internal documentation.

## Engineering Approach

The project combines product thinking with AI-assisted software development.

The workflow emphasizes:

1. Defining user needs and business constraints.
2. Establishing functional and UX acceptance criteria.
3. Implementing changes through iterative development.
4. Reviewing generated code and system behavior.
5. Running regression and integration tests.
6. Validating responsive layouts and critical user flows.
7. Deploying and monitoring production changes.

AI tools assist with implementation, debugging, and iteration. Product decisions, requirements, and acceptance criteria remain human-directed.

## Quality & Security

The platform incorporates:

- Role-based access controls.
- Server-side authorization for protected operations.
- Controlled appointment and payment state transitions.
- Membership session traceability.
- Responsive regression checks.
- QR verification testing.
- Environment-based configuration for sensitive credentials.

Security controls and automated tests are part of an ongoing engineering process and should not be interpreted as a formal security certification.

## Project Evolution

**Phase 1 — Discovery & UX Prototyping**

Initial booking flow, interaction design, and responsive prototype.

**Phase 2 — Functional Platform**

Database integration, authentication, scheduling, and administrative workflows.

**Phase 3 — Operational Integrations**

Payment workflows, transactional notifications, and expanded administrative tools.

**Phase 4 — Membership Experience**

Digital membership management, Black Card interface, QR verification, and session tracking.

**Phase 5 — Information Architecture**

Development of Admin Panel V2, organized around operational and business tasks.

## Product Status

**Active development — Production deployment**

The live application is available at https://www.kanibarber.com.

New functionality is evaluated iteratively. Certain UX hypotheses and workflows remain subject to further validation with real users.

## Project Ownership

**Product direction, UX/Product Design, and AI-assisted development:** Tomás Blutmann.

Developed for KANI Barber Studio.

## Development

This repository contains the application's source code, configuration, database migrations, and automated tests.

For local development, refer to the current project configuration and package scripts. A compatible Node.js environment (Node 24 recommended), `pnpm`, and the required environment variables are necessary.

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
