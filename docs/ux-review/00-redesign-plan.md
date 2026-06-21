# Specorator Testrunner — UX Redesign Master Plan

**Status:** draft for product-owner sign-off
**Mandate (chosen 2026-06-21):** a **bold redesign** — a new visual identity and a
**restructured information architecture** — with a **"native + light identity"**
visual direction (stay theme-compatible via Obsidian CSS variables, but introduce a
subtle, consistent Specorator identity). Weighted toward the **core authoring loop**,
the **Story Map board**, and **dashboards / explorers / settings**.

This plan synthesizes five deep-review reports into one vision, a set of cross-cutting
foundations, and a sequenced, parallelizable roadmap of workstreams sized for dedicated
implementation subagents. The detail lives in the source reports — cited as `[0N-Rk]`:

| Report | File |
|---|---|
| 01 — Information Architecture, Navigation & Onboarding | `docs/ux-review/01-information-architecture.md` |
| 02 — Design System | `docs/ux-review/02-design-system.md` |
| 03 — Core Authoring Loop | `docs/ux-review/03-authoring-loop.md` |
| 04 — Story Map Board | `docs/ux-review/04-story-map-board.md` |
| 05 — Dashboards, Explorers & Settings | `docs/ux-review/05-dashboards-settings.md` |

**Non-negotiable constraints (every workstream honours these):**
- Hexagonal architecture: presentation stays a **thin shell** over pure, unit-tested
  modules (ADR-0029, AGENTS.md). New logic lands in pure projections/helpers with tests.
- **Native theming only** — colours/spacing derive from Obsidian CSS variables; no
  hard-coded palette except the deliberate Story-Map pastels.
- eslint forbids `as` casts and `!`; zero raw HTML (`createEl`/`createDiv`).
- Desktop-only. Colour is never the sole signal (the `[data-status]` reinforcement
  contract is preserved and extended).

---

## 0. Decisions log

**2026-06-21 (product owner):**
- **T1 — IA depth → HUB SHELL (bold).** Commit to the single Test Hub home leaf with a
  Plan/Build/Run/Review section rail (WS-B1). Deep-linking, breadcrumbs, and the loop rail
  still land first to de-risk it. A new ADR will record the shell + workspace-restore model.
- **T2 — Identity → DEFAULT Specorator brand hue.** `--spec-accent` defaults to a Specorator
  hue (initial pick: **teal**, a single adjustable token — light/dark-aware, `--text-on-accent`
  contrast verified), *not* opt-in. Class names migrate to `spec-`, UI wordmark "Specorator";
  plugin **id** stays `e2e-test-hub` (renaming is a breaking data migration, out of scope).
- **Proceeding to Increment 1 (Phase 0 Foundations) now.**
- Still open (decide as their phase begins): T4 run-view granularity, run-time env override,
  board colour/inspector/focus scope, health-hero metric (§6 items 3–6).

## 1. Vision & design principles

**North star:** Specorator should feel like *one coherent BDD workbench* — a place you
*enter* and *move through* (Plan → Build → Run → Review), not a drawer of eleven
disconnected views you each have to find and re-find. The redesign is built on four
principles:

1. **One home, one spine.** A single Test Hub home with a persistent section rail; every
   surface knows where it sits and offers the obvious next step.
2. **The graph is navigable.** PRD ↔ Use Case ↔ Feature ↔ Suite ↔ Run ↔ Evidence ↔ Story
   Map is real data today but a dead graph in the UI — make every edge a click.
3. **Forward momentum.** Each artifact's landing surface points at what comes next; the
   loop is a guided pipeline, not a series of returns-to-hub.
4. **A light, consistent identity.** Identity comes from *one accent, one elevation/spacing
   rhythm, one component vocabulary, and consistent iconography* — layered on the user's
   theme, never fighting it.

---

## 2. Cross-cutting themes (the same findings, seen five times)

The five reviews independently converged on a small set of systemic issues. These are the
**highest-leverage** work because each fix pays off across every surface:

| Theme | Where it shows up | Resolution |
|---|---|---|
| **No identity / under-systematised CSS** | 02-H1; 03-Mi5; 04-§3.3; 05-§3.1 | A token sheet + accent-spine motif + canonical components (WS-A1/A2) |
| **Duplicated components** — 3 status pills, 5 bordered panels, 12 focus rings, 2 banners | 02-H2/H3/H4/M5 | One `spec-*` component library (WS-A2) |
| **Three status vocabularies** (planning vs automation vs run vs PRD) with three colour rules | 02; 03-R8; 04-M6; 05-m6 | One shared **status-chip component**; keep the *semantics* distinct (planning ≠ automation, per CONTEXT.md), unify the *rendering* (WS-A2) |
| **Full-repaint on every change** resets scroll/hover, flickers, blocks a viewport | 04-C2; 05-m3 | A reusable **reconciling render** helper (WS-A3); keystone for the board |
| **Dead artifact graph** — no deep-linking, PRD→UC, board card→UC, breadcrumbs | 01-C2; 04-M1; 05-M5 | One `openArtifact(id)` port + `breadcrumbFor()` projection (WS-A4) |
| **No true home; 11 co-equal leaves** | 01-C1/M3/M4; 03-§3.8 | The Test Hub home shell + section rail (WS-B1) |
| **Inconsistent destructive + validation UX** (PRD delete has no confirm) | 05-M3/M6; 01 | Extract the proven two-click confirm + checklist-validation as shared primitives (WS-A3) |
| **Onboarding fragmented across 3 systems** | 01-C3 | One onboarding orchestrator (WS-B2) |
| **Weak empty/first-run states** everywhere | 03; 04-M7; 05-m4 | A `renderEmptyState()` primitive + per-surface scaffolds (WS-A2) |

---

## 3. Resolving the big tensions

Four decisions shape the architecture of everything downstream. The plan's **recommended**
position is stated; the gating questions are consolidated in §6 for your sign-off.

**T1 — How far on IA? (the single biggest fork.)** Reports 01 and 03 both propose
collapsing the eleven co-equal leaves. Two framings:
- *(a) Hub shell + section rail* — one Test Hub leaf hosts the existing view bodies under a
  Plan/Build/Run/Review rail (01-§3.1).
- *(b) Loop-rail + deep-linking only* — keep separate leaves, unify them with a next-step
  rail + breadcrumbs + deep-links (03-R1, the lower-risk subset).

  **Recommendation:** commit to **(a) the hub shell** as the destination (it is the
  "bold redesign" the mandate asked for), but **sequence it so the deep-linking,
  breadcrumbs, and loop-rail (b) land first** as independently-valuable steps that
  de-risk the shell. (a) needs a new ADR (Obsidian per-leaf workspace-restore is the
  main risk).

**T2 — Identity strength. DECIDED (§0): default Specorator brand hue.**
`--spec-accent` **defaults to a Specorator brand teal** (a single adjustable token,
light/dark contrast-tuned) — **not** the theme accent and **not** opt-in. A settings toggle
may still let a user fall *back* to their theme accent, but the shipped default is the brand
hue. Keep the plugin **id** `e2e-test-hub` (renaming is a breaking data migration — out of
scope) but migrate **class names** to a `spec-` prefix and the UI wordmark to "Specorator."
[02-R10; supersedes report-02's opt-in-default recommendation]

**T3 — Status semantics vs. rendering.** CONTEXT.md is explicit that Planning Status,
Automation Status, and Run Status are *different axes*. **Recommendation:** unify the
**chip component and colour mechanism**, keep the **lexicons separate** — one renderer,
three vocabularies. [02-H2, 04-M6, 05-m6]

**T4 — Run view live granularity.** The richest payoff (per-scenario live results,
"re-run failed only") depends on the runner emitting per-scenario events mid-run, not just
terminal counts. **Recommendation:** confirm feasibility early; if unavailable, ship the
Run view output-log-first and layer live per-scenario rows when the stream exists.
[03-Q2, 03-R3/R4]

---

## 4. The roadmap — workstreams sized for subagents

Phases gate on **shared foundations**; within a phase, workstreams touching different
surfaces are **parallelizable**. Each workstream lists its source recommendations, the
pure modules it should produce (to keep presentation thin), and its risk.

### Phase 0 — Foundations *(must land first; low risk; unblocks everything)*

| WS | Scope | Sources | Notes / pure artifacts |
|---|---|---|---|
| **A1 Design tokens** | `:root` token sheet over Obsidian vars (accent/spacing/radius/elevation/motion) + `prefers-reduced-motion` guard. Purely additive, zero visual change. | 02-R1/R2 | CSS only; no behaviour change |
| **A2 Component library** | `spec-panel` (+ accent-spine), `spec-btn` (+ modifiers, one focus-ring), one **status-chip**, `spec-banner`, `spec-chip`, `spec-empty`/`renderEmptyState`, checklist. Consolidate 3 pills / 5 panels / 12 rings / 2 banners. Collapse `sm-board-`/`e2e-test-hub-story-map-` → `spec-storymap-`; fix undefined classes (`error-text`, `scope-items`…). | 02-R3..R9; 03-R8; 04-R15; 05-R12 | View `cls:` churn; coordinate with tests asserting class names |
| **A3 Interaction primitives** | Extract the proven **two-click destructive confirm** and **checklist validation** as shared helpers; a generic **reconciling-render** helper (keyed spec-differ); `renderLoadError` sibling. | 04-R1; 05-R5/R12 | Reconciling-render is a pure fn over two spec lists; keystone for D1 |
| **A4 Navigation port** | One `openArtifact(id)` deep-link port + pure `breadcrumbFor(node, target)` projection. | 01-R2/R4 | Services already expose `findById`/`findAll`; handle renamed/missing ids like UC-detail not-found |

### Phase 1 — IA & navigation *(the structural bet; new ADR for the shell)*

| WS | Scope | Sources | Risk |
|---|---|---|---|
| **B1 Test Hub home shell** | One hub leaf with a persistent **Plan/Build/Run/Review** section rail hosting existing view bodies; demote explorers from top-level peers. Rail model is a pure projection. | 01-R1; 03-R9 | **High** — Obsidian leaf/workspace-restore; needs an ADR |
| **B2 Onboarding orchestrator** | One state machine ("the single next action") in a docked, never-occluded rail; retire the `Get started` panel + tour CTA banner duplication; wizard scaffolds, rail teaches. **Needs a NEW pure `projectOnboarding(initState, ucCount, tourState)`** — the tour service alone lacks init-state + UC-count, so retiring dashboard onboarding on it would lose the fresh-vault next action (Codex catch — see 01 corrected). | 01-R3 | Med — first-run behaviour change; keep tour event wiring intact |
| **B3 Command + ribbon hygiene** | Prefix/group commands `Test Hub: <Area> — <verb>` (ids unchanged) — independent, ship early. **Ribbon reduction to one "Open Test Hub" icon depends on B1** (else PRD/Story Maps become palette-only — Codex catch); fix the stale comment with it. | 01-R5/R6 | Low; ribbon half gated on B1 |
| **B4 Wire the graph** | Apply A4 everywhere: PRD→UC, board card→UC, UC→Story Map board, breadcrumb→specific PRD, Evidence↔Run↔Suite. | 01-R2; 04-R6 | Low–Med |

### Phase 2 — Core authoring loop *(parallel with Phases 3–4 after foundations)*

| WS | Scope | Sources | Risk |
|---|---|---|---|
| **C1 Loop rail / forward momentum** | A 5-node next-step spine (Use Case · Feature · Steps · Suite · Run) on every authoring surface; create-UC opens the **detail cockpit**, not the raw note; ▶ Run in the Feature editor toolbar. | 03-R1 | Low — additive, reuses existing services |
| **C2 Pending Steps panel** | First-class surface listing undefined steps; "Generate stub" + **open the step file at the inserted stub**; merge detect+generate into one "Steps" action; progress bar. | 03-R2 | Med — needs a `.testrunner` open-at-line path |
| **C3 Run view** | Reframe the console as a Run view: per-scenario live results, progress (N of M), **environment chip**, inline evidence, **re-run failed only**, raw log behind a disclosure. NB: re-run-failed needs a **new failure-set execution scope** — today `ExecutionScope` is only `use-case\|feature\|suite\|all\|demo` and `RunLauncher` forwards one scope/target, so this requires runner-command/scope/event/evidence work, not just reusing existing plumbing (Codex catch — see 03 corrected). | 03-R3/R4/R5 | Med–High — gated by T4 (per-scenario events) + a new failure-set scope |
| **C4 Tag-expression builder** | Vault-wide tag palette + operator buttons + live "Matches N" in the suite modal; "Included in N suites" under editor scenarios; a lightweight Tag glossary. NB: "in N suites" needs a **new per-scenario suite-membership projection** (not `scenarioCounter`, which is a corpus aggregate — Codex catch). | 03-R6 | Low for the builder; Med for the membership badge |
| **C5 Rename-identity protection** | Intercept a history-dropping scenario rename with an inline confirm. Soften copy to "has recorded history" **or** add a history-count API — an exact count isn't available today (`ScenarioHistoryService` caps `recent` at history depth; Codex catch — see 03 corrected). | 03-R7 | Med — editor commit is fire-and-forget on blur |

### Phase 3 — Story Map board *(parallel; the marquee canvas)*

| WS | Scope | Sources | Risk |
|---|---|---|---|
| **D1 Reconciling board render** | Replace `empty()`+rebuild with the A3 keyed differ so edits don't reset scroll/zoom/hover. **Keystone** for D2. | 04-R1 | Med — hottest path; careful DnD re-wire |
| **D2 Zoom/pan/focus + minimap** | `panzoom` behind a one-function adapter (mirrors the dnd adapter); fit-to-screen; **focus a Slice/Activity** (camera frame + dim); minimap. The adapter must **own screen→board conversion** (invert the wrapper group's CTM); `toBoardPoint` today reads the **outer** SVG's CTM and must route through the adapter (Codex catch — see 04 corrected). ADR-0029's named remaining phase. | 04-R2/R3/R4 | Med — new runtime dep (anticipated by ADR-0029 P5); coordinate inversion is real work |
| **D3 Card visual language** | Bigger breathing cards + **type-tinted spine** + 2-line wrapped titles + **status-as-visual-state**; resolve `ref` to a clickable aliased `[[note\|UC-NNN]]`; reconcile the two colour systems (inline swatch cycles **Card Types**; free-text `color` modal-only). | 04-R5/R6/R7 | Low–Med — R7 changes documented P4 behaviour (T-board) |
| **D4 Board toolbar + panels** | Persistent toolbar (breadcrumb + view controls + add + legend toggle); **live legend** (filter + type palette); **right-docked card inspector** exposing the card **body** — needs **new card-note body read/write plumbing** (the board model drops the body today; Codex catch — see 04 corrected); **persona identity** (colour/initial chips linking to `PER-NNN`). | 04-R8/R9/R10/R12 | Med |
| **D5 Board polish** | In-board undo (pure-model snapshot stack); real empty/first-run states + coachmarks; satellite consistency (Settings modal → `Setting` rows; builder board-shape preview); light identity layer (dot-grid, banded slices). | 04-R11/R13/R14/R15 | Low |

### Phase 4 — Dashboards, explorers & settings *(parallel)*

| WS | Scope | Sources | Risk |
|---|---|---|---|
| **E1 Hub home redesign** | **Health hero** ("is my product green?": pass-rate + last-run verdict). NB: denominator = **`automatedUseCases`** (passing÷(passing+failing) drops `implemented` and overstates health — Codex catch). NB: the UC-automation roll-up is **environment-agnostic today** (`TestRunSummary`/evidence carry no env) — either add an environment dimension or **omit the active-env label** from the hero (Codex catch — see 05 corrected). **KPI funnel** with denominators/%/bars; make tiles **real filters** (widen `DashboardNavTarget`); reorder so health/actions/KPIs lead and docs/onboarding defer. | 05-R1/R2/R3/R4 | Low–Med (R3 needs an explorer filter contract; env-attributed health needs a model change) |
| **E2 PRD explorer + builder** | Quiet primary row target + actions menu; **PRD delete behind the shared two-click confirm**; per-PRD coverage chip; builder step rail + per-step validation + drop the dead Success step + clickable Review. | 05-R5/R7/R9 | Low–Med |
| **E3 Settings IA** | Advanced/collapsible vault paths; explicit **Danger zone** for Reset; environments as summary cards that expand; auth column headers/caption. | 05-R6/R10 | Low |
| **E4 Runs & live feedback** | Richer recent-runs (counts, env, duration, re-run, friendly label); "updated just now" live-refresh feedback. | 05-R8/R11 | Med (needs run summary to carry counts/env/duration) |

**Dependency spine:** `A1 → A2 → A3/A4 → B1` ; `A3 → D1 → D2` ; `B1 → E1` (both own
`DashboardView.render()` — E1 builds on the shell, never parallel to it) ; `B1 → B3 ribbon
half` ; `A2/A4` underpin every Phase 2–4 surface. After Phase 0–1, the **board track (D…)**
parallelizes with the **hub track (B1→E1)** and the **loop track (C…)** — but workstreams
that share a surface (notably B1/E1 on the dashboard) stay under one owner.

---

## 5. ADRs & docs this redesign will produce

- **New ADR — Test Hub home shell / IA** (T1): the single-leaf shell, the section model,
  and the Obsidian workspace-restore approach.
- **ADR-0029 follow-up** (already anticipated): adopt `panzoom` for zoom/pan + focus (D2).
- **New ADR or CONTEXT.md update — the design system** (T2/A1/A2): tokens, the accent-spine
  motif, the `spec-*` component vocabulary, the identity/opt-in-accent boundary.
- **Possible ADR — Run view & per-scenario live events** (T4) if runner streaming changes.
- **CONTEXT.md** gains: the unified **status-chip** concept, **Loop rail**, **Pending Steps**,
  **Health hero**, **Focus mode**, **Card inspector** as named surfaces.

---

## 6. Decisions needed before/early in implementation

Consolidated from the 34 open questions across the five reports — the ones that **gate the
plan's structure**:

1. ~~**IA depth (T1)**~~ — **DECIDED (§0): hub shell (bold).**
2. ~~**Identity & brand (T2)**~~ — **DECIDED (§0): default Specorator brand hue, not
   opt-in; `spec-` class rename + "Specorator" wordmark; plugin id stays `e2e-test-hub`.**
3. **Run view granularity (T4):** can/should the runner emit **per-scenario events**
   mid-run (enables live results + re-run-failed), or stay output-log-first for now?
4. **Run-time environment override:** allow running against a non-active environment
   without changing the persisted active one (the single-active-env model)? NB: not UI-only —
   needs an optional env threaded through `ExecuteTestRequest` → `RunLauncher` → `runEnv`
   (today `runEnv` always reads `settings.sut.active`) (Codex catch — see 03 corrected).
5. **Board scope (T-board):** (a) inline swatch cycles **Card Types** (one colour
   language) — OK to change the documented P4 behaviour? (b) Expose/edit the card **body**
   on the board via the inspector? (c) Focus = camera-only (recommended) or also filter?
6. **Health-hero metric, denominator & environment attribution:** headline = **pass-rate of
   automated UCs** — if so, **`passing ÷ automatedUseCases`** (honest; includes
   mid-implementation `implemented` UCs) vs `passing ÷ (passing+failing)` (terminal-only,
   overstates health by dropping `implemented` — Codex catch); or a coverage-weighted figure
   penalising unspecified/unautomated UCs? **And:** the UC-automation roll-up is
   **environment-agnostic today** — `TestRunSummary`/evidence carry no environment field — so
   the hero can't honestly label counts with the active env
   without first **adding an environment dimension** to runs/evidence/history. Decide:
   add that dimension, or drop the env label from the hero (see 05-§3.1, corrected).

The remaining report-level questions (slug defaults, minimap cost, persona-ownership model,
settings audience, recent-runs depth, etc.) are workstream-local and can be decided as each
WS starts.

---

## 7. Suggested execution order (first three increments)

1. **Increment 1 — Foundations & identity (Phase 0):** A1 tokens → A2 component library +
   status-chip → A3 primitives (confirm/validation/reconciling-render) → A4 deep-link port.
   *Visible identity, zero structural risk; every later WS builds on it.*
2. **Increment 2 — Navigability (Phase 1, subset b of T1):** B4 wire the graph + B3
   **command renames only** + B2 onboarding orchestrator + the **loop rail** (C1). *Delivers
   "forward momentum" and a navigable graph before the heavier shell.* **NB (Codex catch):
   defer the ribbon reduction half of B3** — removing the PRD/Story Map ribbon icons before
   the hub rail exists (B1) would strand Story Maps in palette-only access, since the
   dashboard has no Story Maps quick action today. Ribbon demotion moves to Increment 3,
   after B1.
3. **Increment 3 — The bets:** B1 hub shell (Phase 1a) **then** E1 health hero + KPI funnel
   **on top of it**, in parallel with D1→D2 board reconciling-render + zoom/pan/focus. **NB
   (Codex catch): E1 must NOT run parallel to B1** — both own `DashboardView.render()` (B1
   replaces that home with the shell/rail; E1 reorders its content), so E1 sequences *after*
   B1's shell contract (or under one owner) to avoid the hero landing in the superseded
   dashboard. The board track (D1→D2) is a genuinely separate surface and parallelizes
   safely; the ribbon-reduction half of B3 also lands here once B1 exists. *Foundations make
   the non-overlapping tracks non-colliding.*

Lower-risk polish (C2/C4/C5, D3/D4/D5, E2/E3/E4) slots in alongside as capacity allows.

---

*Plan derived from `docs/ux-review/01..05`. Awaiting product-owner decisions in §6 before
breaking Increment 1 into per-task subagent briefs.*
