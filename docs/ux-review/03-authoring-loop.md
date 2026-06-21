# UX Review 03 — The Core Authoring & Execution Loop

**Scope:** Use Case → Feature Specification → Test Suite → Test Run / Test Console → Evidence.
**Direction (product mandate):** bold redesign, *native + light identity*. One of the three highest-weighted focus areas.
**Constraint baseline:** desktop-only; presentation is thin over tested pure modules (ADR-0029, AGENTS.md); native theming only (`styles.css` is 377 `var(--…)` refs, 1 hardcoded hex, no custom font / gradient / shadow identity); eslint forbids `as` / `!`.

This review reads the loop end-to-end and proposes a redesign that **collapses steps, makes editing inline, and keeps every surface's outcome on-screen** — without breaking the Markdown-native, hexagonal, native-theme contract.

---

## 1. Current-state — the loop as it works today

The Test Hub is a **hub-and-spokes** model. The Dashboard (`dashboard-view.ts`) is the hub; everything else is an independently-opened leaf. The daily loop crosses five surfaces:

### Stage A — Author a Use Case
- **Where:** Dashboard quick action "New Use Case" (`dashboard-rows.ts:120`, primary CTA) → `CreateUseCaseModal` (`create-use-case-modal.ts`). Title + optional description; Enter submits; service creates `UC-NNN`, then `openOrNotice` opens the raw note (`create-use-case-modal.ts:79`).
- **Detail surface:** `UseCaseDashboardView` (table: ID, Title, Status, Automation, Features, Note, Run) → click the id → `UseCaseDetailView`. The detail view is the real authoring cockpit: header (Status + Automation, PRD breadcrumb, Story Map backlinks), and per-Feature rows with Open / Run / Validate / Detect missing steps / Generate step definitions, each rendering inline ✓/✗/! checklists (`use-case-detail-view.ts:392-449`).
- **Edit:** `EditUseCaseModal` edits title/status/parent-PRD without touching YAML (`edit-use-case-modal.ts`). Automation status is intentionally not editable (derived, ADR-0017/US-057).

### Stage B — Write the Feature Specification (Gherkin)
- **Generate:** "Generate feature" on the detail view (or command palette `GenerateFeatureModal` fuzzy picker). First feature → `happy-path` slug silently; second+ → a **separate `SlugPromptModal`** (`generate-feature-modal.ts:74-133`). Opens the new `.feature` file.
- **Edit:** `FeatureEditorView` (`feature-editor-view.ts`) is a registered handler for `.feature`. Raw text is source of truth; **structured mode** is a projection (`feature-editor-structured.ts` / `feature-editor-scenario.ts`) that round-trips through `parseFeature`/`serialiseFeature`. Files with comments / `Rule:` blocks fall back to **raw mode** (`roundTripsLosslessly`, `feature-editor-view.ts:128-133`). A live ✓/✗/! validation strip plus a per-step `!` missing-definition flag (`feature-editor-structured.ts:167-179`), datalist autocomplete for steps/tags, and a **rename advisory** warning that history detaches (`feature-editor-format.ts:163-180`).

### Stage C — Group scenarios into Suites by Tag Expression
- **Create:** `CreateSuiteModal` (`create-suite-modal.ts`): name + description + Tag Expression, with a debounced live "Matches N scenarios" preview (`create-suite-modal.ts:102-122`). Membership is *only* the tag expression (AD-4).
- **List:** `SuiteDashboardView` table (Name, ID, Tag Expression, Scenarios, Run) with per-row Run.

### Stage D — Run & watch the Test Console
- **Launch paths:** command palette (`Run all` / `Run demo` = 1 click; `Run Suite…` / `Run Use Case…` / `Run feature…` = 2 clicks via `RunPickerModal`), per-row Run buttons in every explorer + detail view, dashboard quick actions. All funnel through `RunLauncher.launch` (`run-launcher.ts:46`), which reveals the console first (bus doesn't replay) then `execute()`.
- **Console:** `TestConsoleView` streams output, shows a live elapsed timer + scope label, a terminal banner that lifts Playwright/bddgen summary lines ("1 failed, Missing step definitions: 2") with an actionable hint, and a toolbar: Cancel / Re-run / Open evidence / Clear (`test-console-view.ts:227-278`). At most one active run (ADR-0018); `RUN_IN_PROGRESS` surfaces as a Notice.
- **Environment:** read at execute time from the *persisted active* environment only; switched via the **Dashboard** badge (`dashboard-view.ts:335`) → `EnvironmentPickerModal`. No run-time environment choice.

### Stage E — Review Evidence, close the loop
- **Console → Evidence:** "Open evidence" enables once `evidence.generated` lands for the last run (`test-console-view.ts:347`).
- **Evidence Explorer:** `EvidenceExplorerView` — month-grouped, status-filterable, paged history; each row opens its note (`evidence-explorer-view.ts`).
- **Roll-up:** finished run → `scenarios.ndjson` → history index → per-scenario latest status → Feature → UC automation status (US-057), which re-renders the detail header and dashboard KPIs live.

**The happy-path click count, new idea → green run → evidence (best case, dashboard open):**
1. New Use Case (modal, 2 fields, submit) → opens raw note.
2. Navigate back, open Use Cases explorer, click UC id → detail view.
3. Generate feature (+ slug modal if 2nd) → opens feature editor.
4. Author scenario in structured editor (name, steps, tags).
5. Generate step definitions (inline) → leave Obsidian to implement stubs in `.testrunner/src/steps`.
6. (Optionally) create a Suite by tag.
7. Run (a button somewhere) → console opens → watch.
8. Open evidence.

That is **5+ surfaces and 8+ deliberate context switches**, several of them modal round-trips that drop the user back to a *raw note* or a *table*, not forward to the next step.

---

## 2. Pain points & friction (evidence-backed)

### CRITICAL

**C1 — The loop has no forward momentum; each surface dead-ends to a list or a raw note.**
Creating a Use Case opens the **raw Markdown note** (`create-use-case-modal.ts:79`), not the detail cockpit where the next action (Generate feature) lives. The user must then manually find Use Cases explorer → click the id → detail. Generating a feature opens the `.feature` editor (good), but finishing authoring there offers **no path to "now run me"** — the user must go back to the detail view or an explorer to find a Run button. The journey is a series of returns-to-hub rather than a guided pipeline. *Evidence:* `create-use-case-modal.ts:78-79`; `use-case-dashboard-view.ts:124-131` (id → detail is a separate manual hop); feature editor has no run/affordance to the next stage (`feature-editor-view.ts:198-225` toolbar is only Structured/Raw).

**C2 — Step-definition implementation is an unguided cliff out of the app.**
The single hardest part of the loop — making steps executable — ends with a Notice/hint telling the user to "implement the stubs in `.testrunner/src/steps`" (`test-console-format.ts:64`), a folder the plugin otherwise hides. There is no in-Hub surface listing pending stubs, opening the step file, or showing which scenarios are blocked. The "Generate step definitions" inline action reports a count and a filename (`use-case-detail-rows.ts:211-222`) then abandons the user at a `.ts` file they must edit by hand with no scaffolding visible.

**C3 — Environment cannot be chosen at run time, and the only switch lives on a different surface.**
A run silently uses the persisted active environment; to run against staging vs production the user must first go to the **Dashboard**, click the env badge, pick, *then* return to wherever they were and launch (`dashboard-view.ts:335-357`; env read at execute time only). For a tool whose whole point is running tests against environments, "which environment am I about to run against?" is invisible at the moment of launch (the console banner/meta never names the environment — `test-console-view.ts:447-498`).

### MAJOR

**M1 — Use Case → Feature → run is three modals/surfaces for what is one intent.**
"Make this idea testable and run it" requires: create-UC modal → (navigate) → detail → generate-feature (→ slug modal) → editor → (navigate back) → Run. The second-feature **SlugPromptModal** is a full extra modal for a single text field (`generate-feature-modal.ts:74-133`). The first feature is silently named `happy-path` with no chance to rename — inconsistent and surprising.

**M2 — Suite-by-Tag-Expression is powerful but undiscoverable.**
Authors type tags as free chips in the feature editor (`feature-editor-structured.ts:31-84`) and separately type a raw boolean string `@smoke and not @wip` into a suite modal text field (`create-suite-modal.ts:62-71`). Nothing connects the two: there is no tag palette, no "tags in this vault" picker in the suite modal, no "which suites would include this scenario" hint in the editor, no autocomplete of *operators*. The live "Matches N" preview is good but only validates after you already know the syntax. A user must hold the entire tag vocabulary in their head.

**M3 — Rename identity warning is passive and easily missed.**
Renaming a scenario silently mints a new Scenario Reference and drops history (ADR-0022/US-056). The only signal is one `!` line buried in the validation strip *after* the rename is already committed to disk (`feature-editor-format.ts:163-180`, surfaced via `validationDisplayEntries`). There is no confirm, no undo affordance, no "this scenario has 47 runs of history" weight before the destructive edit. For a BDD workbench whose value is per-scenario history, this is under-protected.

**M4 — The Feature editor's structured/raw split is binary and opaque.**
A file with a single comment or `Rule:` block silently loses structured editing entirely (`feature-editor-view.ts:128-133`, `:207-220`). The user gets a banner explaining *why* (good) but no way to edit the un-modellable parts structurally and the rest richly. The toggle is whole-file. There is also no "convert to structured" assist (e.g., strip/relocate the comment).

**M5 — Run feedback is text-only; the console is a log, not a result.**
The console shows raw stdout lines and a one-line banner. There is no per-scenario pass/fail list, no progress (N of M scenarios), no clickable failed-scenario → jump-to-feature, no inline screenshot/trace preview. The summary is regex-lifted from Playwright text (`test-console-format.ts:35-52`). For "watch the run," the experience is staring at a terminal dump until a banner appears.

**M6 — Evidence and the console are two unconnected surfaces around one run.**
"Open evidence" is a single button that depends on async timing (`test-console-view.ts:347-355`); if it hasn't fired, the button is disabled with a reason. The console never shows the run's own result counts inline as evidence — the user must open a *separate note* to see what the console just streamed. The loop's last hop is a context switch to read what already happened on screen.

### MINOR

**Mi1 — Created Suite opens its raw note** (`create-suite-modal.ts:154`), same dead-end pattern as C1, with no "Run this suite now" affordance.

**Mi2 — Five KPI tiles all navigate to the same Use Cases explorer** (`dashboard-rows.ts:80-85`) — no per-status drill-down, so "Failing: 3" can't be clicked to see *which* three.

**Mi3 — Re-run only re-runs the last scope** (`test-console-view.ts:245-249`); there is no "re-run only failed scenarios," the single highest-value re-run in any test workbench.

**Mi4 — "Detect missing steps" and "Generate step definitions" are two adjacent buttons** doing overlapping work (`use-case-detail-view.ts:441-448`); generate already detects internally (`use-case-detail-rows.ts:256-274`). Two buttons for one mental model.

**Mi5 — Visual identity is effectively zero.** Tables, banners, and chips are all default Obsidian. Status is communicated by a `data-status` text label + a faint border accent. Nothing in the loop *reads* as a BDD workbench — no Given/When/Then rhythm, no run-state pulse, no suite/tag visual language.

---

## 3. Redesign opportunities (bold, concrete)

### 3.1 Make the loop a **pipeline**, not a hub of dead-ends (fixes C1, M1, Mi1)
Replace "create → open raw note → go find the next thing" with **forward affordances baked into every artifact's landing surface.**

- **New Use Case opens the detail cockpit, not the raw note.** The cockpit already exists (`UseCaseDetailView`); just route `create` there. The raw note stays one click away ("Open note" already in the header).
- **A persistent "Loop rail" / next-step strip** at the top of each authoring surface: a 5-node progress indicator (Use Case · Feature · Steps · Suite · Run) that lights up as the artifact gains each capability, with the *next* node as a live button. On the detail view: "0 features → Generate feature"; in the feature editor: "steps undefined → Generate step definitions" then "ready → ▶ Run this feature"; after a run: "→ Open evidence." This is the single highest-leverage change: it turns 8 manual hops into a guided spine that always shows one obvious next action.
- **Run button inside the Feature editor toolbar.** The editor is where authoring ends; it must be where running begins. Add ▶ Run (this feature) and ✓ Validate next to Structured/Raw (`feature-editor-view.ts:198`).

### 3.2 A **Step Definitions surface** — close the C2 cliff (fixes C2, Mi4)
The biggest unguided gap deserves a first-class surface, not a Notice.

- Collapse "Detect missing steps" + "Generate step definitions" into **one "Steps" action** that opens a **Pending Steps panel**: every undefined step across the Use Case (or feature), each with "Generate stub" and "Open `<stepfile>:<line>`" that jumps straight into the `.testrunner` step file at the new stub. Show implemented vs pending as a progress bar ("12 of 15 steps defined").
- After "Generate," **open the step file at the inserted stub** automatically. **`stepFile` alone is not enough to jump to a line** (reviewer catch, Codex 2026-06-21): `GenerateStepDefinitionsResult` returns only `generatedSteps`, `stepFile`, and `appended` — no line offsets — and the service may append a block to an *existing* file or create *multiple* stubs. To implement `Open <stepfile>:<line>` reliably (especially in the existing-file / multi-stub case) the workstream must **return the insertion location(s) from the service/event result** (line ranges per generated stub), not depend on `stepFile` + ad-hoc scanning. With that, the user lands *on the code to write*, not at a count.
- Surface the same panel from the console's missing-steps hint (make the hint a button, not prose — `test-console-format.ts:59-65`).

### 3.3 **Run-time environment selector + visible target** (fixes C3)
- Add an **environment chip to every launch surface and to the console header.** The console banner/meta should read "Running Test Suite Smoke · staging · 00:12" so the target is never a guess.
- Offer a **"Run against…" affordance** (modifier-click or a split-button caret on Run) that opens the existing `EnvironmentPickerModal` and runs once against the chosen env without changing the persisted active one. **This is NOT UI-only** (reviewer catch, Codex 2026-06-21): `ExecuteTestRequest` carries only `scope`/`target`, `RunLauncher.launch` forwards them unchanged, and `execute()` builds the child env from `runEnv(settings)`, which always reads `settings.sut.active`. A per-run override therefore needs **an optional environment field threaded through `ExecuteTestRequest` → `RunLauncher` → `runEnv`** (so the override is honoured without mutating the persisted active env). Treat it as execution-request + env-building plumbing, not just opening the picker at launch.

### 3.4 **Tag-aware authoring** — make Suites discoverable (fixes M2)
- In the **suite modal**, replace the bare text field with a **tag-expression builder**: a vault-wide tag palette (the `listKnownTags` data already feeds the editor datalist — `feature-editor-view.ts:157`), operator buttons (`and` / `or` / `not`), and the live "Matches N" preview already present (`create-suite-modal.ts:113`). Clicking tags composes the expression; the raw string stays editable for power users.
- In the **feature editor**, show **"Included in N suites"** under each scenario's tag chips. **This needs a NEW projection, not `scenarioCounter`** (reviewer catch, Codex 2026-06-21): `FeatureInsightService.scenarioCounter()` / the `SuiteDashboardView` call (`suite-dashboard-view.ts:104`) evaluate *one* suite's tag expression against the *whole feature corpus* and return an aggregate matched count — not whether *this* scenario belongs to each suite. The editor badge must instead **load all suites and evaluate each suite's tag expression against this scenario's effective tags** (a per-scenario membership projection over the suite set), so authors see the consequence of a tag immediately.
- Add a vault-level **Tag glossary** view (lightweight) listing every tag, its scenario count, and the suites that use it.

### 3.5 **Protect scenario identity** (fixes M3)
- When a structured-editor scenario rename would drop history, **intercept on blur with an inline confirm** ("Scenario *Checkout* has recorded run history — renaming starts fresh. [Rename] [Keep name]"). **An exact "47 runs" count is not available today** (reviewer catch, Codex 2026-06-21): `ScenarioHistoryService` exposes only `latestStatuses()` / `flakiness()`, and its `recent` window is trimmed to the configured history depth — so a scenario with more runs than the retention depth would show a capped/incorrect number, or require ad-hoc log scanning from the editor. So either **add a dedicated history-count/read API** (total runs per Scenario Reference) if we want the exact weight, or **soften the copy** to "has recorded history" / "N+ recent runs". Keep the passive strip as a backstop, but make the destructive case a deliberate choice, not an after-the-fact footnote.

### 3.6 **A real run/result surface, not a terminal** (fixes M5, M6, Mi3)
Reframe the Test Console as a **Run view** with two panes:

- **Live results pane:** a scenario checklist that fills in as scenarios report (running → pass/fail), a progress count (N of M), elapsed, and the environment. Raw output collapses behind a "Show output log" disclosure (keep it — it's essential for debugging, but it's not the *primary* read).
- **Inline result + evidence:** on terminal, render the result counts and **failed-scenario rows that link straight to the feature** *and* embed the evidence summary inline (the Evidence note already aggregates this — `evidence-explorer-rows.ts`). "Open evidence" becomes "the evidence is already here; open the full note for traces/screenshots."
- **"Re-run failed only"** alongside Re-run (`test-console-view.ts:239`): the per-scenario history that powers the roll-up already knows which scenarios failed. **This is NOT free in the current plumbing** (reviewer catch, Codex 2026-06-21): `ExecutionScope` is only `use-case\|feature\|suite\|all\|demo` (`test-run.ts:10-12`) and `RunLauncher.launch` forwards a single scope/target (`run-launcher.ts:46-50`) — there is no scenario/failure-set scope today. Delivering this requires **either a new `ExecutionScope` failure-set (a list of Scenario References) threaded through the runner command, or a generated temporary tag/grep filter** for the failing scenarios, plus the matching event/evidence handling. Highest-value micro-interaction in the loop, but it carries real runner work — not just a button.

### 3.7 **Light visual identity** (fixes Mi5) — native + a thin BDD skin
Stay 100% on Obsidian CSS variables (the contract), but layer a *light, consistent identity* expressed only through accent, rhythm, and iconography:

- **A run-state accent token** (one accent var mapped to passing/failing/running/cancelled) applied consistently to the loop rail, KPI tiles, console banner, suite/UC status cells, and Evidence rows — so "green/red/amber" is one language across all five surfaces, always paired with the existing text label (color-blind-safe contract preserved).
- **A Gherkin rhythm** in the structured editor: subtle Given/When/Then keyword tinting and a left "spine" connecting steps, so a scenario *reads* like Gherkin, not a stack of inputs.
- **Lucide iconography** already used in the console (`setIcon`) extended to a small, consistent set per stage (use-case, feature, suite, run, evidence) used in the loop rail, tab icons, and headers — the "light identity" is largely *consistent iconography + one accent system*, which costs no theme divergence.
- **Status as a chip, not a word in a cell** — a single shared status-chip component (text + accent dot) across UC table, suite table, console, evidence. One micro-component unifies the visual language.

### 3.8 IA restructure — SUPERSEDED by the decided Test Hub shell (B1/T1)
**This section's "separate Workbench leaf" is superseded** by §0/T1 in `00-redesign-plan.md`: the
decided IA is **one Test Hub shell with a Plan/Build/Run/Review rail** (01-§3.1), not a second
parallel leaf. The authoring loop is **not** its own shell — it lives *inside* that one shell:
Use Cases/Features under **Build**, Suites/Console under **Run**, Evidence/Runs under **Review**
(the editor stays the native `.feature` handler the shell links into). B1 implementers must target
the single Test Hub shell; treat 03-R9 below as "host the loop in the B1 shell," not "build a
separate Workbench." The IDE-like "loop in one window" intent is preserved — it is realised by B1,
not by a competing leaf.

---

## 4. Prioritized recommendations

| # | Recommendation | Impact | Effort | Risk | Dependencies |
|---|---|---|---|---|---|
| R1 | **Loop rail / next-step spine** on every authoring surface; create-UC opens the cockpit, not the raw note (§3.1) | H | M | Low — additive; reuses existing services/events | None (uses existing derive/listFeatures/runLauncher) |
| R2 | **Pending Steps panel** + auto-open step file at generated stub; merge detect+generate into one "Steps" action (§3.2) | H | M | Med — needs a `.testrunner` step-file open path **and `GenerateStepDefinitionsResult` extended to return per-stub insertion line ranges** (today: only `generatedSteps`/`stepFile`/`appended`, no offsets — Codex catch) | StepDefinitionService (must return insertion locations); workspace open-at-line |
| R3 | **Run view** rebuild: per-scenario live results, progress, inline evidence, environment shown (§3.6 minus re-run-failed) | H | H | Med — depends on per-scenario event/stream granularity | Per-scenario history/events; PostRunCoordinator |
| R4 | **Re-run failed only** (§3.6) | H | M | **Med** — needs a NEW failure-set `ExecutionScope` (or generated temp tag/grep) + runner-command/event/evidence changes; existing scope plumbing is `use-case\|feature\|suite\|all\|demo` only | Scenario History (US-057); **new** `ExecutionScope` + RunLauncher/runner-command threading |
| R5 | **Run-time environment selector + env chip on console/launch** (§3.3) | H | M | **Med** — not UI-only: needs an optional env threaded through `ExecuteTestRequest` → `RunLauncher` → `runEnv` (which today only reads `settings.sut.active`) | EnvironmentPickerModal; **`ExecuteTestRequest` + `runEnv`** changes |
| R6 | **Tag-expression builder + "in N suites" in editor + tag glossary** (§3.4) | M | M | Low for the builder (reuses `listKnownTags` + the live preview); **Med for "in N suites"** — needs a NEW per-scenario suite-membership projection (evaluate each suite's expression against the scenario's tags), not `scenarioCounter`'s corpus aggregate (Codex catch) | `FeatureInsightService` (tags); **new** suite-membership projection over the suite set |
| R7 | **Inline rename-identity confirm** (§3.5) — soften copy to "has recorded history", OR add a history-count API if an exact weight is wanted (current service caps `recent` at history depth — Codex catch) | M | M | Med — editor commit is currently fire-and-forget on blur | Scenario History (+ optional new count API); feature-editor commit path |
| R8 | **Light identity system:** shared status-chip, run-state accent token, Gherkin rhythm, consistent stage icons (§3.7) | M | M | Low — pure CSS/var + small shared component; theme-safe | styles.css; keep `var(--…)` contract |
| R9 | **= B1 (the decided Test Hub shell)** — host the loop's surfaces under Build/Run/Review in the one shell; NOT a separate Workbench leaf (§3.8 superseded, T1) | H | H | High — large IA change; ADR for the shell | **B1** (00-plan); all views; main.ts wiring |
| R10 | **Per-status KPI drill-down** + Suite/UC create open with a Run affordance (§Mi1, Mi2) | L | L | Low | DashboardNavTarget union; explorer filter param |

Suggested sequencing: **R1 → R2 → R5 → R4 → R6/R8 → R3 → R7 → R9**. R1, R2, R5, R8 are high-value, low-risk and establish the redesign vocabulary; R3 and R9 are the ambitious payoffs that the early wins de-risk.

---

## 5. Open questions for the product owner

1. **How bold on IA?** Is the single **Workbench leaf** (R9) in scope for this redesign, or do we keep the multi-leaf model and unify it only via the **loop rail** (R1)? This is the biggest fork.
2. **Per-scenario live results (R3)** depend on the runner emitting per-scenario events mid-run, not just terminal counts. Do we have (or can we add) that stream granularity, or must the live Run view stay output-log-based until a scenario reports?
3. **Run-time environment override (R5):** acceptable to run against a non-active environment *without* changing the persisted active, or does the single-active-environment model (per glossary) need to remain the only source of truth?
4. **Rename protection (R7):** confirm-on-rename adds friction to a fast structured editor. Is a blocking confirm acceptable for the history-bearing case, or should it stay advisory-only and instead offer a post-hoc "re-attach history" repair?
5. **Step-definition surface (R2):** how much should the Hub reveal of `.testrunner/src/steps`? A read-only "open at stub" jump is low-risk; an in-Hub step-file *editor* is a much larger commitment — where's the line?
6. **Identity ceiling (R8):** "light identity" — how far can we push beyond pure native? Is a single custom accent token + iconography set acceptable, or must we stay strictly within stock Obsidian status colors?
7. **First-feature slug:** keep the silent `happy-path` default, or always prompt (consistency) vs. always default (speed)? Affects M1's modal-collapse.
