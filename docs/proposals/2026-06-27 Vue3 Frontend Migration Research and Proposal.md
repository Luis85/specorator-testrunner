# Test Hub Frontend → Vue 3 Migration — Research & Proposal

_Date: 2026-06-27. Researches migrating the Test Hub presentation layer from
hand-written Obsidian `ItemView` DOM rendering to a **Vue 3 + Pinia +
vue-router** runtime. Synthesized from a read of the current presentation layer
(~80 files, ~11.5K LOC), the live-refresh/event-bus reactivity already in place,
the build/test toolchain, and the architectural governance (32 ADRs, CONTEXT.md
glossary, ESLint-enforced layering, fallow quality gates). The decision itself is
recorded in **ADR-0033 (Vue Frontend Runtime)**; this document is the supporting
research and the phased plan._

---

## 1. Executive summary

The Test Hub frontend is a disciplined, fully hand-rolled DOM layer. It works,
it is theme-correct, and its **testable logic is already extracted into pure
projections** (`*-rows.ts` / `*-format.ts`) covered by ~127 vitest files. That
extraction is the single most important asset for this migration: it means a
framework swap can be **confined to the thin DOM-writing shells** while the
projection core — and its tests — stay untouched.

The recommendation is to adopt **Vue 3 + Pinia + vue-router**, with each library
scoped tightly to fit Obsidian's embedded, leaf-based runtime:

- **Vue 3** replaces the manual `contentEl.empty()` + rebuild loop. It is a
  natural fit: per-leaf `createApp().mount(contentEl)` / `unmount()`, reactivity
  driven by the existing domain `EventBus`. **Must** ship runtime-only with
  build-time-compiled SFC templates (no runtime compiler → no `eval`/`new
  Function`, which Obsidian/Electron CSP forbid).
- **Pinia** holds **presentation view-state only** — the ephemeral fields today
  living on view classes (`activeSection`, `evidenceFilter`, `useCaseFilter`,
  `onboardingCollapsed`) plus an EventBus-invalidated read cache. It is **never**
  a second source of truth for domain data; domain mutations still flow through
  application services. Stores are created per Vue app (per leaf), not as a
  global singleton.
- **vue-router** drives **intra-view** navigation only, on
  `createMemoryHistory()`. Obsidian's leaf/tab system remains the authority for
  cross-view ("cross-leaf") navigation; vue-router never owns a leaf transition.

The dominant risk is not the framework — it is **discarding the pure-projection +
EventBus pattern** the tests and quality gates depend on. The plan below
preserves it.

---

## 2. What the frontend is today

| Aspect | Current state | Evidence |
| --- | --- | --- |
| Packaging | Single CJS `main.js`, esbuild-bundled, desktop-only | `esbuild.config.mjs`, `manifest.json` (`isDesktopOnly: true`) |
| Architecture | Hexagonal: `domain → application → infrastructure/presentation`, kernel in `shared`; ESLint `no-restricted-imports` enforces boundaries | `AGENTS.md` |
| View base | Obsidian `ItemView` subclasses writing vanilla DOM (`contentEl.createEl`, `setIcon`) | `src/presentation/views/hub-view.ts` |
| Reactivity | Hand-rolled: `LiveDashboardView`/`LiveRefresh` subscribe a view's `render()` to the in-process `EventBus`, coalesced by a `RenderScheduler` | `src/presentation/views/live-refresh.ts`, `live-dashboard-view.ts` |
| Navigation | Obsidian leaves for cross-view (`openHub`, `openUseCaseDetail`, `setViewState`); pure `hub-sections.ts` projection for intra-hub section rail | `src/main.ts`, `src/presentation/navigation/hub-sections.ts` |
| State persistence | Per-leaf `getState()/setState()` survives workspace reload | `hub-view.ts` (`activeSection`), `main.ts` (`useCaseId`, `storyMapId`) |
| Testable logic | Extracted into pure `*-rows.ts` / `*-format.ts` projections; **views are deliberately not unit-tested** | `AGENTS.md` ("Views stay thin… views do not"), `tests/` (~127 files) |
| Runtime deps | Only `interactjs` (Story Map board drag-and-drop) | `package.json`, `story-map-board-dnd.ts` |

Two consequences shape everything:

1. **The "reactive view" pattern already exists.** Vue does not introduce
   reactivity; it replaces a hand-rolled version of it. The migration is a
   like-for-like substitution at the rendering boundary, not a new paradigm.
2. **The framework-agnostic core already exists.** `*-rows.ts`/`*-format.ts` take
   data and return view-models with zero DOM. Vue components consume those
   view-models. The 127 tests assert on them and remain valid.

---

## 3. Library-by-library fit

### 3.1 Vue 3 — good fit

**Mounting.** Each `ItemView` owns a `contentEl`. In `onOpen()`,
`createApp(RootComponent, props).mount(this.contentEl)`; in `onClose()`,
`app.unmount()`. One Vue app per leaf instance — required because each leaf has
independent `getState()` (a Use Case detail leaf carries its own `useCaseId`).

**Reactivity bridge.** A `useEventBus(types, onRefresh)` composable replaces
`LiveRefresh`: it subscribes on mount, unsubscribes on unmount, and invalidates
the relevant reactive store slice.

**Async refresh serialization must be carried forward.** Vue's batched async
rendering only coalesces *DOM flushes*; it does **not** order or cancel
overlapping async service reads. The existing `RenderScheduler`
(`render-scheduler.ts:3-8`) does more than DOM batching — it **serializes async
renders** so a slower refresh holding stale data cannot resolve last and clobber
fresher output (out-of-order `findAll`/`refreshDashboard` resolutions). A
`useEventBus()`/Pinia cache that naively re-reads on every event reintroduces
exactly that stale-write race. Therefore the bridge **must** preserve a
latest-only refresh discipline per store slice: either keep a `RenderScheduler`-
equivalent serializer behind the composable, or tag each async read with a
monotonic token and **discard a resolved read whose token is no longer current**
(cancellation). This is an acceptance requirement of the Phase 0 spike, not an
implementation detail to discover later.

**Hard constraints (non-negotiable):**

- **CSP / no `eval`.** Obsidian runs in Electron with a Content Security Policy
  that forbids `new Function`. Vue's *runtime template compiler* uses
  `new Function`. Therefore SFC templates **must** be compiled at build time
  (esbuild + `unplugin-vue` or `esbuild-plugin-vue3`) and only the
  **runtime-only** Vue build shipped. This is a build-config requirement, and the
  spike must prove a `@wip`-free production build loads without a CSP violation.
- **CSS / theme parity.** There is one 64KB `styles.css` keyed to Obsidian theme
  variables (`--spec-accent`, `--background-*`, …). Keep components rendering the
  **existing global class names**; do **not** adopt Vue scoped styles, which would
  fragment the theme-aware stylesheet and break light/dark parity. CSS migration,
  if ever, is a separate decision.
- **Bundle.** Vue runtime-only ≈ 34KB gzip, Pinia ≈ 2KB, vue-router ≈ 10KB.
  ~+45KB gzip total. Acceptable for a desktop-only plugin; tracked in the spike.

### 3.2 Pinia — fit only if scoped to presentation state

The application layer already owns domain state (services + ports + `Result<T>`).
Pinia's role is strictly the **ephemeral view-state** currently held as mutable
fields on view classes — e.g. in `hub-view.ts`: `activeSection`,
`evidenceFilter`, `evidenceVisibleLimit`, `useCaseFilter`, `onboardingCollapsed`
— plus a thin **read cache** of service query results that the EventBus
invalidates.

Rules that keep Pinia from breaking the architecture:

- **Not a domain source of truth.** Stores never persist domain entities; they
  cache the result of a service read and drop it on the matching domain event.
- **Mutations go through services.** A store action calls a `*Service`; it does
  not mutate domain data locally and reconcile later.
- **Per-app, not global.** Because Obsidian leaves are independent instances,
  Pinia is instantiated per Vue app (`createPinia()` per `createApp`), so two
  open leaves don't share a singleton store. View-state that must survive a
  workspace reload is persisted through Obsidian's **layout-save path, not by
  writing `setState()`**: `setState()` is only the *restore* hook. As the hub
  does today (`hub-view.ts:271-279`), a store mutation that must persist updates
  the field `getState()` returns and then calls
  `this.app.workspace.requestSaveLayout()`, which makes Obsidian re-read
  `getState()` and serialize it. Pinia holds the live copy; the `getState()`
  field + the layout save is the durable copy.

> Honest framing: for much of today's view-state, Vue composables (`reactive()` +
> a `useEventBus()` hook) would be lighter than Pinia. Pinia earns its place where
> state is shared across components *within* a leaf (e.g. the hub shell + its
> active body + the onboarding rail all reading the same KPI snapshot). The
> proposal adopts Pinia for that shared-slice case and uses plain composables for
> purely local state, rather than forcing every `ref` through a store.

### 3.3 vue-router — fit only for intra-view navigation

vue-router assumes a single SPA owning history/URL. This plugin has neither a URL
bar nor a single app — **Obsidian's leaf/tab system is the cross-view router**
(`openHub`, `openUseCaseDetail`, `setViewState`, persisted per leaf). Intra-hub
section switching is already a clean pure projection (`hub-sections.ts`,
ADR-0031).

Scope that lets vue-router coexist instead of compete:

- **Memory history only** (`createMemoryHistory()`) — there is no browser URL to
  own.
- **Intra-view only.** A router instance lives inside one mounted Vue app and
  routes *within* that leaf: the hub's five-section rail
  (`overview/plan/build/run/review`) and any future sub-tabs (e.g. Use Case
  detail panels). It **never** triggers a cross-leaf transition — opening another
  view still calls the existing workspace adapter.
- **Persisted through the layout-save path.** The hub's active route survives a
  workspace reload exactly as `activeSection` does today (`hub-view.ts:271-279`):
  a route change updates the field `getState()` returns and calls
  `this.app.workspace.requestSaveLayout()` (which re-reads `getState()`);
  `setState()` reads that value back on restore and drives the router to the
  saved route. The router is the in-leaf navigation model; the `getState()` field
  + the layout save is its durable projection — writing `setState()` alone would
  **not** persist, so a reload would revert the route.

This re-expresses the existing `hub-sections.ts` rail as router routes and gives
deeper views (Use Case detail, Story Map board) a real intra-view navigation
primitive, without vue-router ever reaching outside its leaf.

---

## 4. The dominant risk and the mitigation

The codebase is governed by 32 ADRs, a domain glossary, ESLint-enforced layering,
fallow quality gates, and ~127 tests **built around the pure-projection +
EventBus pattern**. The failure mode of a framework migration is rewriting view
logic *into* components, which:

- invalidates the projection tests (the coverage gate drops),
- moves testable logic back into an untested surface (components), and
- couples domain shaping to the view framework.

**Mitigation — the load-bearing rule of this migration:**

> `*-rows.ts` / `*-format.ts` projections are the framework-agnostic core and stay
> as-is. Vue components are **thin consumers** of the view-models those
> projections already return. Only the DOM-writing shell (the `render()` body) is
> replaced. The 127 projection tests stay green throughout.

Component-level tests (`@vue/test-utils` + happy-dom) are **additive** for genuine
component behaviour (event wiring, conditional slots), not a replacement for the
projection tests. AGENTS.md's "views stay thin" rule is *strengthened*, not
relaxed: the component is the new thin view.

---

## 5. Phased plan

Each phase is independently shippable and gated by the full PR gate
(`lint && format:check && typecheck && build && test:coverage`) plus
`quality:audit`.

**Phase 0 — ADR + toolchain spike (de-risk).**
Land ADR-0033. Add Vue/Pinia/vue-router + the esbuild Vue plugin. Convert **one
self-contained leaf** to a per-leaf Vue app and prove, with evidence: production
build succeeds, plugin loads with **no CSP violation**, theme CSS still applies,
the EventBus→reactive bridge refreshes on a domain event, and the leaf's existing
projection tests still pass unchanged. Record the bundle-size delta.

**Spike-leaf choice — must persist leaf state.** The `getState/setState`-survives-
a-reload gate can only be exercised by a leaf that **actually overrides**
`getState()/setState()`. The small explorers do **not**: `EvidenceExplorerView`
has no override, and `GuidedTourView`'s `getState()` reads the *tour service*
state, not the Obsidian leaf state — so picking either would let the spike pass
while the Vue mount↔persistence seam stayed untested. Only `UseCaseDetailView`
(`useCaseId`, `use-case-detail-view.ts:166-184`) and `StoryMapBoardView`
(`storyMapId`, `story-map-board-view.ts:296-319`) persist leaf state today.
Therefore: spike on **Use Case Detail** — the smaller of the two stateful leaves
(the Story Map board is heavier via `interactjs` and is deliberately Phase 4) — so
the persistence gate is real. If a lighter, stateless leaf (Evidence Explorer) is
preferred for the *first* mount/CSP/EventBus proof, then **split the persistence
gate out of Phase 0** and prove it in Phase 2 on the hub (which does override
`getState/setState`) — do not claim it from a leaf that never persisted state.

**Phase 1 — bridge primitives.**
Extract the reusable seam: an `ItemView`↔Vue `mountVueView()` / `unmount` helper,
the `useEventBus()` composable (replacing `LiveRefresh` per-view), the per-app
`createPinia()` wiring, and a **state-persistence utility** that bridges a
store/route slice to Obsidian's leaf state per §3.3 — `getState()` returns the
slice, a mutation calls `requestSaveLayout()` to serialize it, and `setState()`
restores it (not a `setState()` write). These become the substrate every later
view reuses.

**Phase 2 — the hub shell + router.**
Re-express `hub-view.ts` as a root Vue component with vue-router
(`createMemoryHistory`) driving the five-section rail (`hub-sections.ts` becomes
the route table), each section body a route component. Persist the active route
through the layout-save path per §3.3 — on a route change, update the field
`getState()` returns and call `requestSaveLayout()` (which re-reads `getState()`);
`setState()` restores it and drives the router on reload. Writing `setState()`
alone would not serialize, so a reload would revert the route. This is the
largest single view and validates the router scope.

**Phase 3 — explorers & dashboards.**
Migrate the `LiveDashboardView` subclasses (PRDs, Use Cases, Suites, Evidence,
recent-runs, overview hero) to components consuming their existing projections.
Each retires its bespoke `render()`/subscription preamble for the shared
composable.

**Phase 4 — detail/interactive views.**
Use Case detail, Test Console, Feature Editor, and the **Story Map board**. The
board is last and highest-risk: it integrates `interactjs` pointer drag behind a
swappable adapter (`story-map-board-dnd.ts`); validate that the adapter survives
Vue's lifecycle (mount/unmount, re-render) before migrating it.

**Phase 5 — modals (optional, last).**
Obsidian `Modal` subclasses can remain native indefinitely. Migrate only if a
modal's body complexity justifies it; the mount helper from Phase 1 works for a
`Modal.contentEl` identically to a view's `contentEl`.

---

## 6. Open questions for the spike to answer

1. **esbuild Vue plugin choice** — `unplugin-vue` vs `esbuild-plugin-vue3`:
   which compiles SFCs cleanly into the existing CJS bundle without pulling the
   runtime compiler? (CSP-blocking if it doesn't.)
2. **Bundle budget** — confirm the ~+45KB gzip estimate and decide whether it is
   acceptable against current `main.js` size.
3. **happy-dom vs jsdom** for component tests under vitest, and whether component
   tests are worth adding at all given the projection tests already cover logic.
4. **Pinia vs composables boundary** — codify when shared state warrants a store
   vs a local `reactive()`, so stores don't proliferate.
5. **`interactjs` under Vue** (Phase 4 gate) — does the pointer-drag adapter need
   changes to survive component re-render?

---

## 7. Recommendation

Adopt **Vue 3 + Pinia + vue-router**, each scoped as in §3, executed via the
phased plan in §5, under the load-bearing rule in §4. Begin with the **Phase 0
spike** before committing the toolchain change broadly — the CSP/no-`eval`
constraint and the esbuild SFC-compilation path are the only genuine unknowns,
and the spike resolves both cheaply. The decision is ratified in **ADR-0033**.
