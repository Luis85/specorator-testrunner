# Vue 3 Migration — Phase 0 + 1 Findings

_Date: 2026-06-28. Records the outcome of the ADR-0033 **Phase 0** toolchain
spike (the first Vue-migrated leaf, **Guided Tour**, plus the reusable bridge
primitives) and **Phase 1** (the first STATEFUL leaf, **Use Case Detail**, plus
SFC type-checking), with the evidence for each acceptance gate. Follows the
proposal `2026-06-27 Vue3 Frontend Migration Research and Proposal.md` and
ADR-0033. Phase 1 is appended at the end._

## What landed

- **Toolchain.** `vue`, `pinia` added as deps; `unplugin-vue` + `@vitejs/plugin-vue`
  as devDeps. `esbuild.config.mjs` compiles `.vue` SFCs **at build time** (the
  `unplugin-vue/esbuild` plugin) and defines Vue's feature flags; vitest uses
  `@vitejs/plugin-vue` so the view modules under test can import `.vue`. A
  `src/vue-shims.d.ts` lets `tsc` resolve `*.vue` imports.
- **Bridge primitives** (`src/presentation/vue/`):
  - `mountVueView()` — a per-leaf `createApp` + `createPinia`, mounted into the
    view's `contentEl`, with an `unmount()` the view calls on `onClose`.
  - `useEventBus()` — the Vue replacement for `LiveRefresh`. It **reuses
    `RenderScheduler`** so async refreshes stay serialized/latest-only (the
    stale-write guard the ADR required), subscribing on mount and tearing down on
    unmount in the same order as `LiveRefresh.close()`.
- **First migrated leaf — Guided Tour.** `GuidedTourView` is now a thin
  `ItemView` that mounts `GuidedTourApp.vue`. The component consumes the
  **unchanged** pure `projectTour` projection and renders the identical DOM/class
  names (theme parity); refresh runs through `useEventBus`. The view dropped its
  `LiveDashboardView`/`render()` loop.

## Why the Guided Tour leaf (not Use Case Detail)

The proposal recommended a stateful leaf (Use Case Detail) to also exercise the
`getState/setState` persistence seam, with a documented fallback: a stateless
leaf for the first mount/CSP/EventBus proof, deferring the persistence gate to
Phase 2 on the hub. This spike took the fallback. The persistence seam (and its
`requestSaveLayout` utility) is **not** proven here and remains a Phase 2 gate.

## Acceptance gates — evidence

| Gate | Result |
| --- | --- |
| Production build (`npm run build`) | **PASS** |
| **CSP / no `eval`** — `grep "new Function"` / `eval(` in `main.js` | **0 / 0** — runtime-only Vue confirmed |
| Bundle delta (minified `main.js`) | 471,826 → 540,891 bytes (**+69 KB min, ≈ +40–45 KB gzip**) |
| Typecheck (`tsc --noEmit`) | **PASS** |
| Lint (`eslint .`) | **PASS** (only pre-existing `max-lines` warnings, none new) |
| Format (`prettier --check`) | **PASS** |
| Tests (`vitest run`) | **PASS** — 127 files, 1837 tests; the `projectTour` tests unchanged |
| Coverage (`test:coverage`) | **PASS** — statements 94.18%, branches 87.68%, functions 95.93%, lines 96.51% |
| fallow changed-code audit (`quality:audit`) | **PASS** — no issues in 10 changed files |

## Decisions made during the spike

- **`vue-router` not installed yet.** Nothing routes in the Guided Tour leaf, so
  installing it now is a dead dependency (fallow flags it). It lands in **Phase 2**
  (hub shell + memory-history router), exactly where ADR-0033 scopes it. The
  full-stack commitment is unchanged — only the install is deferred to its use.
- **Vue bridge dir is coverage-exempt** (`src/presentation/vue/**`), mirroring the
  existing `*-view.ts` exemption: `createApp`/lifecycle code is Obsidian/Vue
  runtime-bound. The pure projections it consumes (`*-rows.ts`) stay covered.

## Still requires manual verification in Obsidian (cannot run here)

The automated gates above cover the toolchain risks (build, CSP, types, tests,
bundle). These runtime behaviours need a manual check in a real vault before
relying on the pattern broadly:

1. The Guided Tour renders identically (theme CSS, light/dark) to the pre-Vue view.
2. Steps auto-advance live as tour events fire (the `useEventBus` bridge).
3. Action buttons (dispatch / mark done / skip / restart / dismiss) and snippet
   **Copy** behave as before.
4. Open/close the leaf repeatedly — no leaked subscriptions (the `unmount` path).

## Next (from Phase 0)

Phase 1 migrates the first stateful leaf and hardens SFC type-checking; Phase 2
migrates the hub shell with vue-router — where the `requestSaveLayout` persistence
utility and the router both get their first real exercise.

---

# Phase 1 — Use Case Detail (stateful leaf) + SFC type-checking

## What landed

- **First STATEFUL leaf — Use Case Detail.** `UseCaseDetailView` is now a thin
  `ItemView` that mounts `UseCaseDetailApp.vue`. It holds the persisted target
  `useCaseId` as a Vue `ref`: `getState` reads it, `setState` writes it, and the
  component **watches** it to (re)load. Because the ref holds the value even
  before the app mounts, the **restore-before-`onOpen` gap** (ADR-0033) is handled
  with no render guard — the component's first load just reads whatever `setState`
  already stored. This proves the `getState/setState` restore seam on a complex
  leaf. (The `requestSaveLayout`-on-internal-mutation path is NOT exercised here —
  Use Case Detail's id only changes via external `setViewState`; that path is the
  hub's, in Phase 2.)
- **The view body** (header + WS-C1 loop rail + per-Feature rows with inline
  validate/detect/generate results) is reproduced across `UseCaseDetailApp.vue` +
  `FeatureRow.vue`, consuming the **unchanged** projections
  (`projectUseCaseHeader`, `projectLoopRail`, `projectFeatureRows`,
  `storyMapBacklinks`, the `*Outcome` helpers). The genuinely fiddly DOM writers
  (`renderLoopRail`, `renderChecklist`, `renderLoadError`, `renderEmptyState`) are
  **reused verbatim** through a tiny `Imperative.vue` wrapper that mounts a writer
  inside the Vue tree — so that DOM (and its theme classes) is identical by
  construction rather than re-derived, minimizing behavioural risk.
- **SFC type-checking (important).** `tsc` does not type-check `.vue` script
  bodies (the `*.vue` shim is opaque), so a whole class of errors was shipping
  unchecked. Added **`vue-tsc`** and pointed `npm run typecheck` at it; it
  immediately caught real errors (the `state` discriminated-union narrowing was
  lost inside inline-arrow `:paint` closures), now fixed by hoisting those
  closures into script-level paint factories. The Phase 0 `GuidedTourApp.vue` is
  now type-checked too.

## Decisions / fixes during Phase 1

- **fallow `usedClassMembers`** gained an `extends: ItemView` clause: the migrated
  leaves extend `ItemView` directly (not the `LiveDashboardView` base), so the
  Obsidian-surface allowlist (`getState`/`setState`/`onOpen`/… are framework-
  invoked) had to cover that heritage. Verified that `fallow-ignore` suppressions
  work **inside `.vue` script blocks** (used on the irreducible `runLoopAction`
  switch and the `reload` load-orchestration, mirroring the original `render()`).
- **`vue-router` still deferred** to Phase 2, as in Phase 0.

## Acceptance gates — evidence (Phase 0 + 1 combined)

| Gate | Result |
| --- | --- |
| `npm run build` | **PASS** |
| **CSP / no `eval`** in `main.js` | **0 / 0** |
| Bundle (minified) vs pre-Vue baseline | 471,826 → 544,625 bytes (**+71 KB min, ≈ +45 KB gzip**) |
| `typecheck` (now **`vue-tsc`**, checks `.ts` + `.vue`) | **PASS** |
| `lint` | **PASS** (`use-case-detail-view.ts` dropped off the `max-lines` warnings — ~447 → ~165 lines) |
| `format:check` | **PASS** |
| `test` / `test:coverage` | **PASS** — 127 files, 1837 tests; coverage 94.18% / 87.68% / 95.93% / 96.51% (unchanged) |
| `quality:audit` (fallow) | **PASS** |

## Still requires manual verification in Obsidian (Use Case Detail)

The body was reproduced faithfully (and reuses the proven DOM writers), but the
view itself is not unit-tested and cannot run here. Verify in a real vault:

1. The detail view renders identically (header, loop rail, Feature rows, theme).
2. **Re-target** works: opening a different Use Case in the reused leaf reloads;
   a **workspace reload** restores the same Use Case (the `getState/setState` +
   ref-before-`onOpen` seam).
3. Per-Feature **Validate / Detect / Generate** render their inline checklist
   results in the right row; the loop rail's **Generate step definitions** renders
   below the rail; **Edit** opens the modal; Run / Open note / Generate feature /
   breadcrumb / Story-Map backlinks all navigate as before.
4. Live refresh on the subscribed events (e.g. a run completing updates the
   Automation pill); open/close leaks no subscriptions.
