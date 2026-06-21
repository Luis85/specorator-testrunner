# UX Review 01 — Information Architecture, Navigation & First-Run Onboarding

**Scope:** the connective tissue between surfaces — entry points, view types, cross-artifact deep-linking, and the wizard → tour → hub first-run path. Each view/dashboard is treated as a *navigation node*; its internal tiles are reviewed elsewhere.

**Mandate alignment:** the product owner has chosen a BOLD redesign — a new visual identity and a RESTRUCTURED IA, "native + light identity." This review proposes a single **Test Hub** home with explicit sub-navigation and a consistent left-rail, plus command grouping by domain prefix. It stays theme-compatible (Obsidian CSS vars) and respects the thin-shell / no-`as` / no-`!` constraints (ADR-0029).

---

## 1. Current-state IA map

### Entry points (how a user gets *in*)

| Surface | Entry | File:line |
| --- | --- | --- |
| Ribbon — Dashboard | `gauge` icon → `openView(DASHBOARD)` | `src/main.ts:227` |
| Ribbon — Test Console | `terminal` icon → `openView(TEST_CONSOLE, "sidebar")` | `src/main.ts:232` |
| Ribbon — PRDs | `git-fork` icon → `openView(PRD, "sidebar")` | `src/main.ts:237` |
| Ribbon — Story Maps | `map` icon → `openView(STORY_MAP, "sidebar")` | `src/main.ts:242` |
| Command palette | ~30 commands (see below) | `register-commands.ts`, `register-run-commands.ts` |
| Settings tab | validate / repair / CI / browser matrix | `src/main.ts:212` |
| First-run wizard | `openWizard()` (command + dashboard CTA) | `src/main.ts:327`, `dashboard-view.ts:314` |

> Note the ribbon comment at `main.ts:221-226` claims default chrome is "Dashboard + Test Console only" — but **four** ribbon icons are actually registered (Dashboard, Console, PRDs, Story Maps). Comment and code disagree.

### View types (navigation nodes) — **11 distinct registered views**

`DASHBOARD`, `USE_CASE` (explorer), `USE_CASE_DETAIL`, `SUITE`, `PRD`, `STORY_MAP` (explorer), `STORY_MAP_BOARD`, `TEST_CONSOLE`, `EVIDENCE_EXPLORER`, `GUIDED_TOUR`, `FEATURE_EDITOR` (`.feature` extension). Sources: `_VIEW_TYPE` consts across `src/presentation/views/*`; registered in `register-views.ts:81-276`.

### Command-palette surface (~30 commands, flat, no grouping)

Registered with **no shared prefix** and inconsistent casing conventions:
- Lifecycle: `Initialize Test Hub`, `Validate environment`, `Repair installation`
- CI: `Generate CI workflow`, `Overwrite CI workflow`, `Check CI readiness`
- Create: `New Use Case`, `New Test Suite`, `New PRD`, `New Story Map`
- Open (views): `Open Use Cases`, `Open Test Suites`, `Open Story Maps`, `Open Evidence Explorer`, `Open dashboard`, `Open documentation`, `Open user manual`, `Open troubleshooting`, `Open guided tour`, `Open Test Console`
- Feature authoring: `Generate feature from Use Case`, `Validate feature`, `Detect missing steps`, `Generate step definitions`
- Run: `Run Demo Test`, `Run all tests`, `Run Test Suite…`, `Run Use Case…`, `Run feature…`, `Cancel Test Run`, `Import report for last run`

Sources: `register-commands.ts:263-395`, `register-run-commands.ts:99-140`.

### How surfaces interconnect (ASCII map)

```
                         [ RIBBON ]  (4 icons)         [ COMMAND PALETTE ]  (~30, flat)
                              |                                  |
        +---------------------+----------------+                 |
        v          v          v                v                 v
   DASHBOARD   TEST CONSOLE  PRD EXPLORER   STORY MAP EXPLORER   (every view, modal, run)
   (the hub)   (sidebar)     (sidebar)      (sidebar)
        |                       |                 |
        | quick actions /       | (no deep link   | open board
        | KPI tiles / docs /    |  into a UC)     v
        | PRD section /         |            STORY MAP BOARD --(card ref)--> [no nav to UC]
        | env badge / tour CTA  |
        v
   +----+-----------------------------------------------+
   |  USE CASE EXPLORER  --(row/id)--> USE CASE DETAIL   |
   |     ^  "All Use Cases" breadcrumb  |   |            |
   |     |                              |   +-- PRD breadcrumb --> PRD EXPLORER (not the PRD)
   |     |                              |   +-- Story Map backlinks (text only, no nav)
   |     |                              v
   |     |                         FEATURE EDITOR (.feature)  --Run--> TEST CONSOLE
   +-----+----------------------------------------------------------------+
        |
   SUITE EXPLORER --Run--> TEST CONSOLE --(run completes)--> EVIDENCE note
                                                              ^
   EVIDENCE EXPLORER --(row)--> EVIDENCE note ----------------+

   RunLauncher (single owner) reveals TEST CONSOLE before every run  (run-launcher.ts:46-49)
   First-run: WIZARD --"Start guided tour"--> GUIDED TOUR (sidebar) --steps dispatch--> existing flows
              WIZARD --"Open Getting Started"--> doc note
              DASHBOARD shows Initialize CTA when uninitialized (dashboard-view.ts:314)
```

### First-run path

`Wizard (modal)` → success screen offers **Start guided tour** (CTA) or **Open Getting Started** or **Close** (`initialization-wizard-modal.ts:161-199`) → `Guided Tour` opens in the **right sidebar** (`main.ts:332`). The 10-step tour (`tour-steps.ts:113-403`) auto-advances by observing real domain events; its action buttons dispatch to existing flows (`guided-tour-view.ts:150-174`). The dashboard separately shows an `Initialize CTA` (uninitialized), a `Get started` onboarding panel (initialized, 0 UCs — `dashboard-rows.ts:212-243`), and a `Continue the guided tour` banner (`dashboard-view.ts:384`).

---

## 2. Pain points & inconsistencies

### Critical

- **C1 — No single home / "Test Hub" front door; the hub competes with 3 sidebar explorers.** The dashboard is *documented* as the hub (`main.ts:224`, `dashboard-view.ts:121`) but the ribbon promotes PRDs and Story Maps as **co-equal top-level icons** (`main.ts:237-246`), each opening a sidebar explorer that has no path back to the hub. There is no persistent "you are here / go home" affordance on any explorer. The mental model is "10+ peers" not "one hub with sub-areas." This is the core IA defect.
- **C2 — Deep-linking between artifacts is broken in both directions across the planning↔testing seam.** The PRD explorer cannot open a Use Case (`prd-explorer-view.ts` has no `openUseCaseDetail`/deep-link — confirmed by grep). The Story Map **Board** renders a UC card reference but offers no navigation into that Use Case. The Use Case detail's **PRD breadcrumb opens the PRD *explorer*, not the specific PRD** (`use-case-detail-view.ts:340`), and its Story Map backlinks are text-only. The PRD↔UC↔Feature↔Suite↔Run↔Evidence↔Story Map chain in CONTEXT.md is a real data graph but is *not* a navigable one.
- **C3 — Two parallel, overlapping onboarding systems with no orchestration.** Wizard (scaffolds), Guided Tour (teaches, sidebar), dashboard `Get started` panel (`dashboard-rows.ts:212`), dashboard tour CTA banner, and the wizard's own "Open Getting Started" all coexist. A fresh user can see the `Get started` 3-step panel **and** the `Continue the guided tour` banner **and** the Initialize/empty states simultaneously, with overlapping but non-identical steps (panel step 1 "Create a Use Case" vs tour step 2 "Create your own Use Case"). No component owns "what is the single next action?"

### Major

- **M1 — Ribbon comment contradicts ribbon code.** `main.ts:221-226` says Dashboard + Test Console only; four icons are registered (`main.ts:227-246`). Either the product call regressed or the comment is stale — either way the chrome is heavier than the documented "deliberately minimal" intent.
- **M2 — Command palette is flat and unprefixed.** ~30 commands with no namespace; in Obsidian's palette they interleave with every other plugin's commands and don't cluster. Casing is also mixed: `Run Demo Test` / `Run all tests`, `New Use Case` / `Open dashboard`. The glossary-proper-noun rule (`register-commands.ts:268`) is applied unevenly (`Run feature…` lowercase vs `Run Use Case…`).
- **M3 — Inconsistent open-location semantics.** Dashboard, Use Case explorer, Suite explorer, Evidence explorer open as **main tabs**; Console, PRD, Story Map, Guided Tour open in the **sidebar** (`obsidian-workspace-adapter.ts:27-36` + each call site). PRDs and Story Maps are *primary planning surfaces* yet are relegated to the cramped sidebar, while a passive Evidence list gets a full tab. The main/sidebar split does not track importance.
- **M4 — "Open X" commands and ribbon both navigate, but nothing tells the user where they are.** No breadcrumb except the single "All Use Cases" link on the UC detail (`use-case-detail-view.ts:248`). Explorers, board, console, and evidence views are dead-ends with respect to lateral navigation — a user in the Story Map Board cannot reach Suites or the Console without the palette/ribbon.
- **M5 — Tour lives in the sidebar but teaches main-area actions.** The tour view (`guided-tour-view.ts`) is right-sidebar; its steps drive modals and explorers that open as main tabs, so the checklist is frequently occluded or scrolled away while the user works. There is no docked, always-visible "next step" rail.

### Minor

- **m1 — Two names for the home node.** Ribbon tooltip "Open Test Hub dashboard" (`main.ts:229`) vs command "Open dashboard" (`register-commands.ts:366`) vs display text "Test Hub dashboard" (`dashboard-view.ts:144`). CONTEXT.md defines **Test Hub** as the whole workbench, so calling the home node "dashboard" muddies the term.
- **m2 — KPI tiles all drill to one place.** Every tile navigates to `use-cases` regardless of label (`dashboard-rows.ts:80-85`); "Passing"/"Failing" promise a filtered drill-down they don't deliver.
- **m3 — Documentation has 4 commands + 3 dashboard buttons + a wizard button** for the same small doc set (`register-commands.ts:370-389`, `dashboard-view.ts:470`), but no in-app "docs home" beyond the generated index note.
- **m4 — Story Map explorer and board are separate nodes** with the board reachable only *through* the explorer or `openStoryMapBoard` callback; no command opens a board directly, and there's no "back to maps" affordance on the board.
- **m5 — Evidence is reachable three ways** (dashboard recent-runs row, Evidence Explorer, console "Open evidence"), each surfacing a different slice, with no canonical "Evidence" home.

---

## 3. Redesign opportunities (bold, mandate-aligned)

### 3.1 One **Test Hub** home with explicit sub-navigation

Collapse the dashboard from "a panel of tiles" into a true **home shell** with a persistent **section switcher** (left-rail of the hub view) over four sub-areas that mirror the domain's two layers (Plan / Build / Run / Review):

```
+----------------------------------------------------------+
|  [Specorator mark]  Test Hub            Env: staging  ▾   |  <- identity bar (light accent)
+--------+-------------------------------------------------+
| PLAN   |  (active section renders here)                  |
|  Roadmap (PRDs)                                           |
|  Story Maps                                              |
+--------|                                                  |
| BUILD  |   Use Cases · Features                           |
+--------|                                                  |
| RUN    |   Suites · Console                               |
+--------|                                                  |
| REVIEW |   Evidence · Runs                                |
+--------+-------------------------------------------------+
|  Onboarding rail (collapsible): "Next: Create a Use Case"|
+----------------------------------------------------------+
```

The four existing explorers remain the *content* of each section but stop competing as top-level peers. The left-rail is the consistent navigation spine the IA currently lacks (addresses C1, M3, M4). Implement as a thin shell hosting the existing view bodies, keeping ADR-0029 (presentation = thin over tested pure modules): the rail model is a pure projection (like `QUICK_ACTIONS`/`ONBOARDING_STEPS` already are).

### 3.2 Make the artifact graph navigable (deep-linking)

Wire the data graph that already exists into click-through navigation, both directions:
- PRD explorer row → open **that** PRD's Use Cases (and the UC detail). (Fixes the `prd-explorer-view` gap, C2.)
- UC-detail PRD breadcrumb → open the **specific** PRD, not the PRD explorer (`use-case-detail-view.ts:340`).
- Story Map Board card → open the referenced **Use Case detail** (the board already resolves `UC-NNN` refs; expose them as links).
- UC-detail Story Map backlinks → open the **Story Map Board** at that card.
- Evidence note ↔ Run ↔ the Suite/Use Case that produced it. **Note (Codex catch): Evidence/Run are NOT id-resolvable like PRD/UC/SM** — Evidence is addressed by `VaultPath` (`TraceabilityRecord.evidence: VaultPath[]`) and `RunHistoryService` has only `list()` (no `findById`). So the nav target is a **discriminated union** (`{kind:"evidence", path}` / `{kind:"run", runId}` alongside `{kind:"artifact", id}`), and "open the run behind this evidence" needs a run/evidence lookup added — it is not free from `openArtifact(id)` alone.

Standardize on **one** `openLinkText`/`openArtifact(id)` navigation port so every node links the same way (today links are ad-hoc `openView` calls with no target id for PRD/Story Map).

### 3.3 Consistent breadcrumbs / back-navigation

Every node renders a breadcrumb derived from the artifact hierarchy: `Test Hub › Plan › PRD-003 › UC-021 › Feature`. The UC-detail "All Use Cases" pattern (`use-case-detail-view.ts:248`) becomes the universal pattern, generated by a pure `breadcrumbFor(node, target)` projection. Adds lateral navigation the explorers/board/console/evidence currently lack (M4).

### 3.4 Group & prefix the command palette

Adopt a domain prefix so Specorator commands cluster and read as a family:
- `Test Hub: Plan — New PRD`, `Test Hub: Plan — New Story Map`
- `Test Hub: Build — New Use Case`, `… Generate feature`, `… Validate feature`
- `Test Hub: Run — Demo test`, `… All tests`, `… Suite…`, `… Cancel`
- `Test Hub: Review — Open Evidence`, `… Import last report`
- `Test Hub: Setup — Initialize`, `… Validate environment`, `… Repair`, `… Generate CI`

Normalize casing once against the glossary rule already stated at `register-commands.ts:268`. (Addresses M2.)

### 3.5 Single onboarding orchestrator + a docked rail

Replace the three parallel onboarding affordances (C3) with **one** state machine that owns "the single next action," surfaced as a **collapsible bottom rail of the hub shell** (always visible, never occluded — fixes M5). States: `Not initialized → Initialize` → `Initialized, 0 UCs → Guided Tour / first Use Case` → `In tour → next tour step` → `Done → dismissed`. The wizard scaffolds; the rail teaches; the `Get started` panel and the tour CTA banner are retired into the rail. **This needs a NEW projection, not a re-host** (reviewer catch, Codex 2026-06-21): `GuidedTourService.getState()` only knows tour steps/completed/dismissed — the `Not initialized` and `Initialized, 0 UCs` branches depend on **initialization state + Use Case count**, which the dashboard computes separately (there is no `projectTour` today). B2 must add a pure `projectOnboarding(initState, ucCount, tourState)` that combines all three into the single next action; retiring the dashboard onboarding on the tour service alone would lose the correct Initialize / first-Use-Case step on a fresh vault.

### 3.6 Light Specorator identity for recognition

Introduce a single accent token plus a compact wordmark in the hub identity bar and a consistent per-section icon set (reuse existing Lucide icons: `git-fork` Plan, `file-check` Build, `terminal`/`play` Run, `gauge`/`clipboard` Review). Sections, breadcrumbs, and the rail all draw from the same icon+accent vocabulary so the user learns the map once. **Use the decided brand token, not the theme accent** (this report's earlier "layered over `--interactive-accent` / no hard-coded colors" framing is **superseded** by §0/T2 in `00-redesign-plan.md`): the identity bar draws `--spec-accent`, which **defaults to the Specorator brand teal** (as shipped in A1), not the user's theme accent. The B1 identity bar must consume `--spec-accent`, so the hub and the Phase-0 tokens ship the *same* default.

### 3.7 Rationalize the ribbon

Reduce to **one** ribbon icon: "Open Test Hub" (the home shell). Everything else is reachable via the in-hub left-rail and the now-grouped palette. This finally makes the `main.ts:221-226` "deliberately minimal" intent true (fixes M1, C1).

---

## 4. Prioritized recommendations

| # | Recommendation | Impact | Effort | Risk | Dependencies |
| --- | --- | --- | --- | --- | --- |
| R1 | Build the **Test Hub home shell** with a persistent left-rail over Plan/Build/Run/Review sections; demote explorers from top-level peers | H | H | Layout churn; Obsidian leaf/workspace-restore edge cases | Pure rail/section model (mirror `dashboard-rows`); ADR-0029 thin-shell |
| R2 | **Deep-link the artifact graph** (PRD→UC, board card→UC, breadcrumb→specific PRD, UC→Story Map board via id; Evidence↔Run↔Suite via path/run-id) through a deep-link port with a **discriminated-union target** (id / evidence-path / run-id — Codex catch), not id-only | H | M | Stale/renamed-id dead-ends (handle like UC-detail not-found); Evidence/Run need path/run-id targets | `findById`/`findAll` for PRD/UC/SM; a run/evidence lookup for the Evidence↔Run hop |
| R3 | **Single onboarding orchestrator** + docked rail; retire `Get started` panel + tour CTA banner duplication | H | M | Behavior change to first-run; tour event wiring must stay intact | **new** pure `projectOnboarding(initState, ucCount, tourState)` (the tour service alone lacks init-state + UC-count — Codex catch); `guided-tour-service` state; R1 shell to host the rail |
| R4 | **Universal breadcrumbs** via pure `breadcrumbFor()` on every node | M | M | Low (additive) | R2 deep-linking; hierarchy lookups |
| R5 | **Group & prefix commands** (`Test Hub: <Area> — <verb>`), normalize casing | M | L | Command-id churn (keep ids stable, change names only) | None (names only; ids in `register-commands.ts` unchanged) |
| R6 | **Reduce ribbon to one** "Open Test Hub" icon; fix the stale comment | M | L | Users who relied on PRD/Story Map ribbon icons | R1 (so demoted surfaces stay reachable in-hub) |
| R7 | **Light identity**: one accent var + wordmark + per-section icon vocabulary | M | L | Theme-compat regressions (audit against light/dark) | Stays on Obsidian CSS vars; coordinate with other redesign slices |
| R8 | Make **KPI tiles drill to filtered Use Cases** (Passing/Failing) | L | M | Needs a per-status filter the explorer lacks today | Explorer filter param (`dashboard-rows.ts:80`) |
| R9 | Establish **one canonical Evidence/Review home** (fold the three evidence entry points) | L | L | Minor relocation | R1 Review section |

---

## 5. Open questions for the product owner

1. ~~**Hub as shell vs. tabs**~~ — **DECIDED (§0/T1 in `00-redesign-plan.md`): the single Test Hub shell** (one leaf, left-rail switcher). The B1 brief has one IA target; the multi-leaf path is not an option. (A new ADR will record the workspace-restore approach.)
2. **Ribbon minimalism:** is the intent truly one ribbon icon (per the `main.ts:221` comment), or are PRDs/Story Maps deliberately promoted? Code and comment currently disagree — which wins?
3. **Onboarding consolidation:** can the dashboard `Get started` panel and the tour be merged into a single docked rail, or must the sidebar Guided Tour persist as its own node for users who close the hub?
4. **Sidebar vs main for planning:** PRDs and Story Maps are primary planning artifacts but open in the cramped sidebar today — should they be promoted to main-area sections?
5. **Deep-link target on rename:** when a PRD/UC/Story-Map id is renamed or deleted, follow the UC-detail "not found, offer explorer" pattern everywhere, or attempt id remapping?
6. **Command prefix wording:** `Test Hub:` (matches the glossary product-surface name) vs `Specorator:` (matches the new identity)? This sets the palette's recognizable namespace.
7. **Identity scope:** how far may the accent/wordmark go before it stops feeling "native"? Need a hard boundary so the identity layer doesn't fight user themes.
