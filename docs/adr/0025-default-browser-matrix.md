---
type: adr
id: ADR-0025
status: accepted
title: Default Browser Matrix Is Chromium-Only
date: 2026-06-13
related:
  - "[[0021-adopt-playwright-bdd-as-execution-engine]]"
  - "[[2026-06-13-v2-foundational-adrs-design]]"
---

# Default Browser Matrix Is Chromium-Only

The generated `.testrunner` ships **Chromium-only by default**; Firefox and WebKit are a one-line opt-in via Playwright projects. This lifts AD-5 (Chromium-only) from a hard V1 constraint to a default.

playwright-bdd ([[0021-adopt-playwright-bdd-as-execution-engine]]) makes multi-browser a config concern (Playwright projects), so the *capability* is free; the only decision is the default. The Phase-0 lesson stands: browser downloads are the dominant first-run and CI cost — the per-OS Chromium cache in the `e2e-smoke` gate exists for exactly this reason. A Chromium-only default honors the local-first, respect-the-user's-machine ethos and keeps first-run light; teams lift to multi-browser deliberately when a Suite needs it.

## Considered alternatives

- **Chromium + WebKit default.** WebKit is the asymmetric value (Safari/iOS engine, cheap nowhere else). Rejected as default: ~2× install/CI weight for coverage most beta users will not exercise on day one — available as a one-line opt-in.
- **All three default (Chromium + Firefox + WebKit).** Rejected: ~3× browser install (the Phase-0 caching pain × OS × CI leg), slowest first run, for coverage users can add in one line.

## Consequences

- US-055 (browser matrix) ships the opt-in mechanism and documents the install-cost trade.
- The `e2e-smoke` gate continues to cache per-OS browser downloads; a user opting into Firefox/WebKit accepts the additional download and CI time.
