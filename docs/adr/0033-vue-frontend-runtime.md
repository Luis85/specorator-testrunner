---
type: adr
id: ADR-0033
status: proposed
title: Vue 3 Frontend Runtime for the Test Hub
date: 2026-06-27
related:
  - "[[0031-test-hub-home-shell]]"
  - "[[0029-story-map-visual-board]]"
  - "[[0019-error-handling-and-logging-model]]"
---

# Vue 3 Frontend Runtime for the Test Hub

The Test Hub presentation layer (~80 files, ~11.5K LOC under `src/presentation/`)
renders by hand: Obsidian `ItemView` subclasses write vanilla DOM
(`contentEl.createEl`, `setIcon`), and a hand-rolled reactivity base
(`LiveDashboardView` / `LiveRefresh`) subscribes each view's `render()` to the
in-process domain `EventBus`, coalescing repaints through a `RenderScheduler`.
The pattern is disciplined but verbose, and every interactive surface re-derives
DOM diffing by `empty()`-and-rebuild.

This ADR decides to migrate the Test Hub frontend to a **Vue 3 + Pinia +
vue-router** runtime, with each library scoped to fit Obsidian's embedded,
leaf-based, CSP-constrained environment. The full research is in
`docs/proposals/2026-06-27 Vue3 Frontend Migration Research and Proposal.md`.
This ADR records the shape and the hard constraints; the migration is phased and
each phase is a later increment.

## Context

- The plugin ships a single CJS `main.js` (esbuild, desktop-only).
- Views mount into an Obsidian-owned `contentEl`. There is **no HTML page and no
  URL bar**; Obsidian's leaf/tab system is the cross-view navigation authority.
- Each leaf persists its own state via `getState()/setState()` (the hub's
  `activeSection`, a detail leaf's `useCaseId`), surviving workspace reload.
- Testable logic is already extracted into pure `*-rows.ts` / `*-format.ts`
  projections, covered by ~127 vitest files; **views themselves are deliberately
  not unit-tested** (AGENTS.md). This is the asset the migration must preserve.
- Obsidian runs in Electron under a Content Security Policy that forbids
  `new Function` / `eval`.

## Decision

### Adopt Vue 3 as the rendering runtime
Replace the `ItemView` `render()` / `LiveRefresh` loop with **per-leaf Vue apps**:
`createApp(Root, props).mount(this.contentEl)` in `onOpen()`, `app.unmount()` in
`onClose()`. One Vue app per leaf instance (leaves carry independent state). A
`useEventBus()` composable replaces `LiveRefresh` — subscribe on mount,
unsubscribe on unmount, invalidate the reactive slice on a domain event.

### Runtime-only build, templates compiled at build time
**Ship the runtime-only Vue build.** SFC templates are compiled by esbuild
(`unplugin-vue` / `esbuild-plugin-vue3`) at build time. The runtime template
compiler is **never** bundled, because it relies on `new Function`, which the
Obsidian/Electron CSP forbids. A production build that loads without a CSP
violation is an acceptance gate of the spike.

### Pinia holds presentation view-state only
Pinia stores hold the **ephemeral view-state** currently living on view classes
(`activeSection`, `evidenceFilter`, `useCaseFilter`, `onboardingCollapsed`, …)
plus an EventBus-invalidated **read cache** of service queries. Constraints:
- A store is **never** a second source of truth for domain data.
- Store actions mutate domain state **only through application services**
  (preserving the ESLint-enforced layering and the `Result<T>` contract).
- Pinia is instantiated **per Vue app** (`createPinia()` per `createApp`), not as
  a global singleton — two open leaves do not share a store.
- View-state that must survive a reload is mirrored into Obsidian
  `getState()/setState()`; Pinia holds the live copy, `setState` the durable one.

### vue-router routes within a leaf, on memory history
vue-router uses **`createMemoryHistory()`** (no browser URL) and routes **only
within a single mounted Vue app**: the hub's five-section rail
(`overview/plan/build/run/review`, re-expressing `hub-sections.ts` as routes) and
future intra-view sub-navigation. It **never** triggers a cross-leaf transition —
opening another view still goes through the workspace adapter. The active route
is mirrored into `getState()/setState()` so the rail survives a reload, exactly
as `activeSection` does today (ADR-0031).

### Preserve the pure-projection core (load-bearing)
`*-rows.ts` / `*-format.ts` projections stay framework-agnostic and unchanged.
Vue components are **thin consumers** of the view-models they return; only the
DOM-writing shell is replaced. The ~127 projection tests stay green throughout.
Component tests (`@vue/test-utils`) are **additive** for real component behaviour,
not a replacement for projection tests. "Views stay thin" is strengthened: the
component is the new thin view.

### Phased, independently shippable migration
0. ADR + toolchain spike on one self-contained leaf (Guided Tour or Evidence
   Explorer) — prove build, CSP, theme CSS, `setState` survival, EventBus bridge,
   and bundle delta.
1. Bridge primitives (`mountVueView()`, `useEventBus()`, per-app Pinia,
   `setState`↔store/route mirror).
2. Hub shell + vue-router rail.
3. Explorers & dashboards (the `LiveDashboardView` subclasses).
4. Detail/interactive views; the Story Map board last (its `interactjs` adapter
   must survive the Vue lifecycle).
5. Modals — optional, native `Modal` may remain indefinitely.

## Consequences

**Positive**
- Declarative components and real reactivity retire the `empty()`-and-rebuild
  loop and the per-view subscription preamble.
- The framework-agnostic projection core and its tests are preserved, so coverage
  does not regress.
- vue-router gives deeper views a real intra-view navigation primitive without
  competing with Obsidian's leaf system.

**Negative / risks**
- ~+45KB gzip bundle (Vue runtime + Pinia + vue-router); tracked from the spike.
- New build-toolchain dependency (esbuild Vue plugin) and the CSP/no-`eval`
  constraint it must satisfy — the primary unknown, resolved in Phase 0.
- A new failure mode (logic creeping into components) is held off by the
  load-bearing projection rule; if violated, the test/quality story erodes.
- Two navigation models coexist (Obsidian leaves for cross-view, vue-router for
  intra-view); the boundary must stay crisp — vue-router never owns a leaf.

**Rejected alternatives**
- *Status quo (hand-rolled DOM).* Works, but every interactive surface
  re-implements diffing and subscription wiring; the cost compounds as views grow.
- *React / Svelte instead of Vue.* Viable, but the user's target stack is Vue +
  Pinia + vue-router; no technical blocker makes Vue the wrong choice here.
- *Composables without Pinia / no vue-router.* Lighter, and considered. The
  decision adopts the full stack per the product direction, scoping Pinia to
  view-state and vue-router to memory-history intra-view routing so neither
  conflicts with the existing architecture.
