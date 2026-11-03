# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is an individual teacher managing day-to-day classroom work from a personal browser profile, often while moving around a classroom and using a phone or laptop. The product has not yet established a verified real-user base, so future product decisions must distinguish demonstrated behavior from assumptions.

## Product Purpose

Edunoza is an offline-first teacher workspace for planning classes, recording attendance and evidence, consolidating grades, coordinating tutor follow-up, producing reports, and protecting local academic records. Success means a teacher can complete recurring classroom work quickly while retaining control of sensitive data and being able to recover it safely.

## Positioning

Unlike account-based learning platforms and school information systems, Edunoza keeps academic records in the teacher's browser and remains usable without a central application backend. Its value is a coherent private workspace across teaching, planning, assessment, follow-up, and recovery rather than student submission or institutional collaboration.

## Operating Context

Teachers use the product before class for planning, during class for attendance and evidence capture, and afterward for assessment, follow-up, reporting, and backups. Mobile use must support fast, touch-friendly classroom actions; larger screens support denser planning and management work.

## Capabilities and Constraints

- Academic data is stored in IndexedDB and must never be included in product analytics or feedback by default.
- The app is a React PWA with network-first navigation and cached application assets.
- There is no application account system or academic-data backend.
- Encrypted backups, validated restore, local app locking, and explicit destructive confirmations are established product capabilities.
- AI features connect directly from the browser to a user-selected cloud or loopback provider and require explicit confirmation before academic data is sent.
- Marketing and onboarding must not invent customers, testimonials, adoption figures, or performance claims.

## Brand Commitments

The product name is Edunoza. The primary domain is `edunoza.com`. The interface voice is direct, calm, practical, and written for Spanish-speaking teachers. The existing blue-led visual identity and workflow-based navigation remain the incumbent design authority.

## Evidence on Hand

- The implemented product capabilities and security model are documented in `README.md`.
- Current capabilities and architecture boundaries are documented in `README.md`; maintenance contracts are indexed in `docs/README.md`.
- Current production traffic does not provide evidence of verified teacher adoption or feature usage.
- No approved testimonials, customer logos, usage benchmarks, pricing, or institutional claims are available and none may be fabricated.

## Product Principles

1. Keep academic data private by default.
2. Make the next classroom action obvious and fast.
3. Prefer recoverable, explicit operations over silent automation.
4. Measure product behavior without collecting educational content or persistent user identity.
5. Validate adoption with real teachers before expanding into institution-scale complexity.

## Accessibility & Inclusion

Core workflows must use semantic landmarks and controls, visible keyboard focus, screen-reader announcements for dynamic state, reduced-motion support, and touch targets of at least 44 by 44 CSS pixels on mobile.
