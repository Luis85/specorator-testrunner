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

**Async refresh stays serialized / latest-only.** Vue's batched async rendering
coalesces DOM flushes but does **not** order or cancel overlapping async service
reads. The existing `RenderScheduler` (`render-scheduler.ts:3-8`) serializes
async renders so a slower refresh holding stale data cannot resolve last and
clobber fresher output. The `useEventBus()`/Pinia bridge **must** carry this
forward — either a `RenderScheduler`-equivalent serializer per store slice, or a
monotonic token per async read that discards a now-stale resolution. A naive
"re-read on every event" bridge reintroduces the stale-write race and is
rejected.

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
- View-state that must survive a reload is persisted through Obsidian's
  **layout-save path, not by writing `setState()`** (which is only the restore
  hook): a persisting mutation updates the field `getState()` returns and calls
  `this.app.workspace.requestSaveLayout()`, which makes Obsidian re-read
  `getState()` (as the hub does today, `hub-view.ts:271-279`). Pinia holds the
  live copy; the `getState()` field + layout save is the durable copy.

### vue-router routes within a leaf, on memory history
vue-router uses **`createMemoryHistory()`** (no browser URL) and routes **only
within a single mounted Vue app**: the hub's five-section rail
(`overview/plan/build/run/review`, re-expressing `hub-sections.ts` as routes) and
future intra-view sub-navigation. It **never** triggers a cross-leaf transition —
opening another view still goes through the workspace adapter. The active route
survives a reload via the layout-save path — a route change updates the
`getState()` field and calls `requestSaveLayout()`; on restore `setState()` reads
it back and records it as the pending route, which `onOpen()` applies once the
router exists (see the restore-deferral note below) — exactly as `activeSection`
does today (ADR-0031, `hub-view.ts:271-279`). Writing `setState()` alone would
not persist the route.

**Restore deferral — `setState()` must not drive the router directly.** On a
workspace restore Obsidian calls `setState()` **before** `onOpen()`, but the Vue
app/router/subscriptions are created in `onOpen()` — so a `setState()` that tries
to navigate the router during restore would find no router yet and lose or throw
the restore. Mirror the existing `isOpen`-guarded restore-gap pattern
(`hub-view.ts:237-241`): `setState()` only **records the pending route** into the
state field; `onOpen()` (after it mounts the app and creates the router) applies
that pending route as the router's initial location. The router is never driven
from `setState()` before the app exists.

### Preserve the pure-projection core (load-bearing)
`*-rows.ts` / `*-format.ts` projections stay framework-agnostic and unchanged.
Vue components are **thin consumers** of the view-models they return; only the
DOM-writing shell is replaced. The ~127 projection tests stay green throughout.
Component tests (`@vue/test-utils`) are **additive** for real component behaviour,
not a replacement for projection tests. "Views stay thin" is strengthened: the
component is the new thin view.

### Phased, independently shippable migration
0. ADR + toolchain spike on one self-contained leaf — prove build, CSP, theme
   CSS, EventBus bridge, and bundle delta. The leaf-state-survives-reload gate
   needs a leaf that actually overrides `getState/setState`: the small explorers
   do not (`EvidenceExplorerView` has none; `GuidedTourView.getState()` reads the
   tour service, not leaf state), so spike on **Use Case Detail**
   (`use-case-detail-view.ts:166-184`) — or split that gate to Phase 2 (the hub
   overrides `getState/setState`). Do not claim persistence from a stateless leaf.
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
