# Vue 3 Migration — Phase 0 Spike Findings

_Date: 2026-06-28. Records the outcome of the ADR-0033 Phase 0 toolchain spike:
the first real Vue-migrated leaf (**Guided Tour**) plus the reusable bridge
primitives, and the evidence for each acceptance gate. Follows the proposal
`2026-06-27 Vue3 Frontend Migration Research and Proposal.md` and ADR-0033._

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

## Next

Phase 1 hardens the bridge (the `requestSaveLayout` persistence utility) and
Phase 2 migrates the hub shell with vue-router — which is where the persistence
seam and the router both get their first real exercise.
