---
id: FEAT-029
type: feature
title: Optional Check Libraries
status: proposed
priority: P3
increment: V2.x
epic: "[[EPIC-013]]"
stories:
  - "[[US-090]]"
  - "[[US-091]]"
  - "[[US-092]]"
---

# FEAT-029 Optional Check Libraries

> Feature of [[EPIC-013]] — Playwright-Native Runner. *(V2.x, stories on
> acceptance.)*

The native runner makes three high-demand additions cheap, each as an opt-in
step/template library:

- **Visual regression** — `toHaveScreenshot` with baselines stored in the
  vault as visual evidence; tolerance controls to avoid the documented
  false-positive trap.
- **Accessibility checks** — axe-core steps; the European Accessibility Act
  is law since June 2025.
- **API-setup steps** — Playwright `request` fixture for 3–4x faster data
  setup before UI flows.

## Stories

Drafted ahead of acceptance; the feature itself stays V2.x, picked up
opportunistically once [[EPIC-013]] has shipped.

- [[US-090]] — Visual regression steps
- [[US-091]] — Accessibility check steps
- [[US-092]] — API-setup steps
