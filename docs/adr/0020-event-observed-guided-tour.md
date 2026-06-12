---
type: adr
id: ADR-0020
status: accepted
title: Event-observed Guided Tour for Onboarding
date: 2026-06-11
related:
  - "[[Specorator Testrunner]]"
  - "[[Solution Design]]"
  - "[[0009-provide-out-of-the-box-demo-test]]"
---

# Event-observed Guided Tour for Onboarding

Onboarding gains a **Guided Tour**: a persistent right-sidebar checklist over the full V1 loop (Use Case → Feature → Gherkin → step definitions → Suite → Run → Evidence → CI). The user performs each step in the real UI; a `GuidedTourService` observes the existing domain events on the EventBus, auto-advances the checklist, persists progress in the settings (`onboarding` section — including event-sequence progress, so a reload cannot dead-end a step — cleared by a UC-024 reset), and publishes `tour.started` / `tour.step.completed` / `tour.step.skipped` / `tour.completed` with `correlationId = tourId`. Step predicates verify the taught artifact precisely (the authored Feature must carry `@tour`; the created Suite's Tag Expression must select it; the final run is correlated suite → run id), and exclude everything initialization itself ships. The demo fixture gains a greeting form so the user's self-authored scenario exercises genuinely new behavior, including a real missing-steps → generate → implement cycle.

ADR-0009 is unchanged: the shipped UC-001 demo remains the five-minute smoke check and the tour's step 1; the tour has the user build a *second* test beside it.

## Considered alternatives

- Extend the Initialization Wizard into a multi-page tutorial modal. Rejected: modals block the workspace, so the user cannot perform the actions while being guided — the opposite of learning by doing.
- A generated interactive Markdown checklist note. Rejected: Markdown cannot observe actions; the checklist would go stale the moment the user does anything.
- Track progress via service-internal callbacks without domain events. Rejected: tour progress is a domain fact like any other; publishing `tour.*` events keeps the views bus-driven (consistent with every other surface) and the Event Catalog complete.
- Have the tour replace the generated demo content (user builds UC-001 themselves). Rejected: weakens ADR-0009's "green within five minutes" promise; the worked example and the self-built test serve different needs.
