# UX/Design Review 05 — Dashboards, Explorers & Settings

**Scope:** the Test Hub's hub Dashboard, the PRD explorer + builder, and the Settings tab.
**Mandate:** bold redesign, "native + light identity". Focus on each surface's internal
content, hierarchy and components (global/cross-surface nav is another agent's slice).
**Constraints honoured throughout:** desktop-only, natively themed via Obsidian CSS
variables, presentation stays thin over tested pure projections (ADR-0029), no `as`/`!`.

---

## 1. Current state

### 1.1 Hub dashboard (`dashboard-view.ts`, `dashboard-rows.ts`, `dashboard-prd-projection.ts`, `dashboard-recent-runs.ts`)

`DashboardView.render()` (`dashboard-view.ts:168`) paints a single long vertical scroll, in
this fixed order:

1. `<h2>` "Test Hub dashboard" (`:171`) — duplicates the leaf's `getDisplayText()` (`:144`).
2. **Initialize CTA** gate (`:178`) — if the vault isn't set up, a card with one paragraph +
   "Initialize Test Hub" button (`renderInitializeCta`, `:314`) and an early `return`.
3. **Environment badge** top bar (`renderEnvironmentBadge`, `:335`) — a single
   "Environment: `<active>`" pill; a `<button>` opening a fuzzy picker when 2+ envs exist,
   inert `<span>` otherwise.
4. **Quick actions** (`renderQuickActions`, `:366`) — three labelled groups (Create / Run /
   Open) from `QUICK_ACTION_GROUPS`/`QUICK_ACTIONS` (`dashboard-rows.ts:120`), 8 buttons,
   "New Use Case" the lone `mod-cta`.
5. **Guided Tour CTA** banner (`renderTourCta`, `:384`) — conditional "Continue the guided tour".
6. **Onboarding** "Get started" panel (`renderOnboarding`, `:401`) — shown only when
   initialized but `totalUseCases === 0` (`shouldShowOnboarding`, `dashboard-rows.ts:243`);
   a numbered `<ol>` of 3 steps.
7. **Documentation actions** (`renderDocumentationActions`, `:470`) — 3 buttons
   (Getting Started / User Manual / Troubleshooting), **always rendered**.
8. **Coverage** `<h3>` + **KPI tiles** (`:225`) — 5 tiles (Total Use Cases, Specified,
   Automated, Passing, Failing) from `projectDashboard` (`dashboard-rows.ts:56`). Each is a
   `<button>` that navigates to the Use Cases explorer (the only `DashboardNavTarget`,
   `dashboard-rows.ts:10`).
9. **PRDs & roadmap** `<h3>` (`renderPrdSection`, `:260`) — root vision card (id+title `<h4>`,
   italic vision, "`N` sub-PRDs · `M` use cases" line), New PRD / View PRD tree buttons, and a
   flat `<ul>` of direct children ("`id`: title (`N` UCs) — status").
10. **Recent runs** `<h3>` + table (`renderRecentRuns`, `dashboard-recent-runs.ts:11`) —
    "View all runs" button, then a Run / Status / Date table; navigable rows link to Evidence.

KPI tile CSS: a responsive `auto-fit minmax(8rem,1fr)` grid (`styles.css:10`); only Passing /
Failing carry a coloured left border (`styles.css:47-53`); Total/Specified/Automated are
visually identical neutral tiles.

### 1.2 PRD explorer + builder (`prd-explorer-view.ts`, `prd-builder-modal.ts`)

**Explorer** — `renderListHeader` ("PRDs" `<h2>` + "New PRD" `mod-cta`, `live-dashboard-view.ts:50`),
then a recursive `<ul>` tree (`buildPrdTree`, `:36`; `renderNode`, `:125`). Each node row is a
flat flex line: a link-button "`id`: title (`N` UCs)", a status pill, a "＋ sub-PRD"
link-button, and (non-root only) a "Delete" link-button. Nesting is shown by a left border +
indent (`styles.css:1009`). Empty state is one line (`:113`). Delete is **immediate** — no
confirm — reporting kept-files via Notice (`:169`).

**Builder** — a 7-step modal (`prd-builder-modal.ts:104`): 1 Title+Parent+Domains, 2 Research,
3 Vision, 4 Scope (in/out lists), 5 Success (an **explainer paragraph only**, no input,
`:315`), 6 Assign Use Cases, 7 Review. Navigation is Previous/Next/Cancel with Create on
step 7 only (`renderButtons`, `:356`). The step `<h2>` title comes from `prdBuilderStepTitle`.
Errors render as a red `error-text` paragraph per field (`renderError`, `:136`). Review is a
flat list of `"Label: value"` lines (`prdReviewLines`, `prd-builder.ts:143`).

### 1.3 Settings (`settings-tab.ts`, `settings-environments.ts`, `settings-maintenance.ts`, `settings-rows.ts`, `add-environment-modal.ts`, `settings-shared.ts`)

`getSettingDefinitions()` (`settings-tab.ts:253`) emits, top to bottom, a **flat list of
groups**: Folders (7 path fields), Runner (browser toggles + install), History (depth),
System under test (active-env dropdown + one block per environment + Add), Maintenance
(validate / repair / **reset**), Continuous integration (generate workflow / check readiness).

- **Environments** (`settings-environments.ts`): each env is a bordered block
  (`.e2e-test-hub-env-block`) with Base URL, an Authentication-variables editor (key + password
  value + remove-icon rows, `renderAuthVarRow:167`), and a Remove-environment row with a
  **two-click arm/disarm confirm** (`wireRemoveEnvironmentButton:225`). The active env's remove
  button is disabled with a reason. Save-blocking validation errors render inline above the
  active-env row (`activeEnvironmentRow:51`, `renderSutErrors:365`).
- **Browser matrix** (`browsersRow`, `settings-tab.ts:336`): 3 inline label+toggle pairs; the
  sole-remaining browser's toggle is disabled.
- **Maintenance/CI** (`settings-maintenance.ts`): each action is a button + an inline checklist
  result (`actionWithResultRow`, `settings-shared.ts:83`); reset is a warning-styled two-click
  confirm; generate-workflow surfaces an explicit "Overwrite workflow" follow-up on conflict.
- Persistence: per-field debounce (600ms) + blur-flush, validated authoritatively by the
  service, with re-sync-on-reject (`persistPath:298`, etc.).

### 1.4 Live refresh (`live-dashboard-view.ts`, `live-refresh.ts`)

A shared `LiveRefresh` coalesces re-renders for a declared event set; the dashboard refreshes
on a broad `REFRESH_ON` list (`dashboard-view.ts:33`). Re-render = full `container.empty()`
rebuild. There is **no visible "updating/just-updated" feedback** — the panel silently
repaints.

---

## 2. Pain points & inconsistencies

### Critical

- **C1 — KPI tiles don't tell a story; the headline number is missing.** The 5 tiles
  (`dashboard-rows.ts:57-63`) are five equal raw counts. There is no overall health roll-up
  (the product's whole point per ADR-0017 `@wip`-aware KPI roll-up), no pass-rate %, no
  "X failing needs attention", no trend/delta. Passing and Failing are shown as absolute
  counts with no denominator, so "3 Passing" is unreadable without mentally fetching "of how
  many". The single most important fact — *is my product green right now?* — is nowhere on the
  hub. This is the highest-leverage gap for a "richer KPI storytelling" redesign.
- **C2 — Every KPI tile navigates to the same place.** `DashboardNavTarget` is the single
  literal `"use-cases"` (`dashboard-rows.ts:10`); `kpi()` hard-codes `navigateTo: "use-cases"`
  (`:83`). Clicking "Failing" should land on the failing Use Cases, but lands on the full
  unfiltered list. The tiles *look* like filters (they're buttons, they have status colour) but
  behave identically — a learned-helplessness affordance. The code comments even call this "the
  honest V1 drill-down", i.e. a known shortcut.
- **C3 — The hub buries its own lede under onboarding/docs chrome.** On a populated vault the
  first ~4 sections a user scrolls past (`render()` order, `:202-218`) are env badge, 8
  quick-action buttons, and 3 always-present documentation buttons — *before* the KPIs
  (`:225`) and recent runs (`:248`) that are the actual dashboard. The status of the product is
  below the fold; the "how to read a manual" buttons are above it. Documentation actions render
  unconditionally (`renderDocumentationActions:470`) even for an expert on their 500th run.

### Major

- **M1 — Quick-action bar is 8 flat buttons masquerading as 3 intents.** The Create / Run /
  Open grouping (`dashboard-rows.ts:120-188`) is semantically right but visually weak: every
  button except "New Use Case" is the same neutral chrome (`styles.css:576`). "Run all tests"
  and "Run demo" sit with equal weight though one is a smoke check and one drives the whole
  SUT; "Generate documentation" is filed under *Create* (a deliberate-but-surprising choice,
  commented at `:136`). There's no primary "Run" affordance even though running tests is the
  hub's core verb.
- **M2 — Recent-runs table is thin and under-actionable.** Three columns (Run / Status / Date,
  `dashboard-recent-runs.ts:38`) with no result counts (passed/failed/total are available
  upstream but dropped), no environment, no duration, no re-run action, no scope. "Run" shows a
  raw `RUN-<timestamp>` id (`test-run.ts:74`) — not human-scannable. Errored runs become inert
  rows with a tooltip (`:79`), a dead-end with no "why" and no retry.
- **M3 — PRD explorer node row is an undifferentiated button soup.** Each row
  (`prd-explorer-view.ts:125`) packs 3–4 link-buttons (open / ＋ sub-PRD / Delete) at identical
  visual weight as inline text-coloured links (`styles.css:121`), wrapping on narrow panels
  (`flex-wrap`, `styles.css:1019`). Destructive **Delete sits inline with no confirm**
  (`:153-161`) — one mis-click silently deletes a PRD (the Notice only reports *after*). This is
  inconsistent with the rest of the app, which uses two-click arm/disarm for destructive actions
  (env-remove, reset).
- **M4 — PRD builder is a 7-step wizard with a dead step and weak validation surfacing.**
  Step 5 "Success" collects nothing — it's an explainer paragraph (`:315`) — so the user clicks
  Next through an empty step. The progress is a bare `<h2>` step title with **no step counter,
  no progress bar, no clickable step list** (`render:107`), so "where am I / how many left" is
  invisible. Next is never disabled on invalid input; validation only fires at Create
  (`create:390`) — a user can walk all 7 steps then be bounced by a missing title via a Notice.
  The Review step is flat `"Label: value"` text (`prd-builder.ts:143`) with no way to jump back
  to a section to fix it.
- **M5 — Dashboard PRD section and PRD explorer tell the same story twice, both flatly.** The
  hub's "PRDs & roadmap" (`renderPrdSection:260`) renders only the root + its *direct* children
  as a flat `<ul>` ("roadmap" is a misnomer — there's no ordering/release framing,
  `dashboard-prd-projection.ts`), duplicating the explorer's top two levels with no added
  insight (no coverage/automation roll-up per PRD, which is the one thing a dashboard could add
  that the tree can't).
- **M6 — Settings is one long flat scroll of 7 peer groups with a danger zone mixed in.**
  `getSettingDefinitions()` (`settings-tab.ts:253`) presents Folders, Runner, History, SUT,
  Maintenance, CI as equal siblings with no IA grouping (e.g. "rarely touched paths" vs
  "everyday SUT/run config"). **Reset Test Hub sits as the third row of "Maintenance"**
  (`settings-maintenance.ts:42`) next to benign validate/repair — a destructive
  remove-the-runtime action with no visual "danger zone" separation beyond the warning button
  style.

### Minor

- **m1 — Redundant `<h2>` heading.** `render()` paints "Test Hub dashboard" (`:171`) identical
  to `getDisplayText()` (`:144`); the leaf tab already labels the view.
- **m2 — Environment badge is invisible until you need it and inert when you don't.** With one
  env it's a non-interactive `<span>` (`:341`); the active environment — the thing every run
  executes against — gets a small grey pill in a top bar, no base-URL preview, no "switch"
  affordance discoverability.
- **m3 — No "live refresh" feedback.** `LiveRefresh` repaints silently (`live-refresh.ts`);
  after a run completes the hub just changes under the user with no "updated just now"
  acknowledgement, undercutting the live-dashboard value proposition.
- **m4 — Empty/first-run states are plain text lines.** "No PRDs yet…" (`prd-explorer-view.ts:113`),
  "No Test Runs yet…" (`dashboard-recent-runs.ts:21`) are bare `<p>`s with no illustration,
  no inline CTA (the recent-runs empty state could offer "Run demo" right there).
- **m5 — Auth variable values are password-masked but unlabelled at block scope.** The
  key/value rows (`renderAuthVarRow:167`) have aria-labels but no visible column headers; a
  block with several secrets reads as anonymous dot-rows.
- **m6 — Status vocabulary is inconsistent across surfaces.** PRD status pills theme only
  `active`/`deprecated` (`styles.css:1034-1042`); KPI statuses are `passing`/`failing`; run
  statuses are `passed`/`failed`/`errored`/`cancelled`. Three overlapping-but-different status
  lexicons with three different colour rules.

---

## 3. Redesign opportunities (bold, native + light identity)

### 3.1 A redesigned hub "home" — lead with health, defer chrome

Restructure `render()` into a clear above-the-fold hero and a deferable below-the-fold:

- **Health hero (new, top).** One large card answering "is my product green?": a big
  **pass-rate ring/bar** over the **automated Use Cases** (`passing ÷ automatedUseCases`,
  `@wip` already excluded upstream), the timestamp of the last run, and a one-line verdict
  ("12 of 16 automated Use Cases passing · 2 failing · 2 in progress"). **The "last run"
  verdict needs a run-history source, not the dashboard snapshot** (reviewer catch, Codex
  2026-06-21): `projectDashboardSnapshot()` builds `recentRuns` only from each UC's
  `lastTestRun` (`traceability-service.ts:117-126`), which is written *only* when evidence
  links back to Use Cases (`evidence-generation-service.ts:185-206`), and **errored runs are
  skipped** by post-run import (`post-run-coordinator.ts:194-196`). So if the latest run fails
  to spawn or produces no linked evidence, the hero would report the previous evidence-linked
  run as "latest". **And the existing run-history layer does NOT close this gap** (reviewer
  catch, Codex 2026-06-21): `DefaultRunHistoryService.list()` also scans
  `Test Evidence/YYYY/MM/<runId>/summary.md` (evidence-backed), and `PostRunCoordinator.onTerminal()`
  skips spawn-`errored` runs before evidence generation — so it omits the same no-evidence
  terminal runs. A reliable last-run verdict therefore needs a **durable execution log that
  records every terminal run at spawn/terminate (incl. spawn-errors and cancels), independent
  of evidence** — which does not exist today. So either **add that durable execution source**,
  or **drop the last-run line from R1**. **Choose the
  denominator deliberately** (reviewer catch, Codex 2026-06-21): `passing ÷ (passing+failing)`
  is only a *terminal* pass/fail rate — it silently drops `implemented` UCs (scenarios ran
  but not fully green), which the KPI model (`projectDashboardSnapshot`, ADR-0017) counts as
  *automated*. Using `passing ÷ (passing+failing)` would therefore **overstate** health
  whenever any UC is mid-implementation. Use `passing ÷ automatedUseCases` for an honest
  "automated health", or, if a terminal rate is wanted, label it explicitly as such. This is
  the identity moment — a single confident, theme-native focal
  element. **Caveat — do NOT label the health with the active environment** (reviewer catch,
  Codex 2026-06-21): the roll-up aggregates from Use Case **automation status**
  (`traceability-service.ts:128-134`), and `TestRunSummary` / the evidence link carry **no
  environment field** (`test-run.ts:73-80`; `evidence-generation-service.ts:198-205` writes
  only runId/status/date/scope/evidencePath). A vault that switches prod→staging after a prod
  run would show prod-derived counts mislabelled "staging." So either (a) **omit the env
  label** (recommended for V1 — the hero states product automation health, env-agnostic), or
  (b) first **add an environment dimension** to runs/evidence/history and attribute counts per
  environment. This is a model decision, not a freebie (see §6/00-plan).
- **Demote docs + onboarding.** Collapse the 3 documentation buttons into a single overflow
  "Help ▾" / move them to a footer; show onboarding/tour CTAs *only* in the empty/first-run
  state, never on a populated hub (`render:216-218`).
- **Order by intent:** Health hero → primary actions (Run / New Use Case) → KPIs → Recent runs
  → PRD roll-up. Push paths/docs to the bottom.

### 3.2 Richer KPI storytelling

- **Reframe the 5 raw counts as a funnel with denominators.** Total → Specified → Automated →
  Passing, each as "`N` of `Total` (`%`)" with a thin progress bar, so the *drop-off* (the
  coverage gap) is the story. Keep Failing as a distinct alert tile only when `> 0`.
- **Make tiles real filters (fixes C2).** Widen `DashboardNavTarget` to a discriminated set
  (`use-cases:all` | `use-cases:failing` | `use-cases:unspecified` | …) and pass a filter the
  Use Cases explorer honours. All projection logic stays in `dashboard-rows.ts` (testable),
  the view stays thin.
- **Add a delta vs. last run** ("Passing 12 ▲1"). **A delta needs a DURABLE prior value, not
  the projection layer** (reviewer catch, Codex 2026-06-21): `projectDashboard(snapshot)`
  receives only the current `DashboardSnapshot`, and the view rebuilds it from
  `TraceabilityService.snapshot()` on every render — so an in-memory "prior snapshot" is gone
  after an Obsidian reload (and absent the first render after open). Either **persist a
  previous-snapshot / KPI-history source** (e.g. a small stored last-snapshot the projection
  diffs against), or **explicitly scope the delta to live-session-only feedback** (show it
  only when a `testrun.completed` fired this session, hide it otherwise). Pick one — don't
  imply a free in-memory diff.

### 3.3 PRD explorer + builder

- **Explorer:** replace the inline button row with a quiet primary target (the whole row /
  title navigates) plus a hover/▾ actions menu for ＋ sub-PRD / Delete; gate Delete behind the
  same two-click arm/disarm used everywhere else (consistency with env-remove/reset). Add a
  **per-PRD coverage chip** (e.g. "8/10 UCs passing") so the tree earns its place as more than a
  folder list. Give nesting a real disclosure-triangle treatment, not just a border.
- **Builder:** add a **persistent step rail** (1–7 with titles, current highlighted, completed
  checkable) so position is always visible; **validate per-step** and disable Next until valid;
  **drop or merge the dead Success step** (step 5) into the note-creation summary; make the
  Review step's lines **clickable to jump back** to the owning step. Surface field errors
  inline next to the field, not as a top paragraph.

### 3.4 Settings IA

- **Restructure into a clear hierarchy:** group everyday config (System under test, Runner,
  History) at top; collapse "Folders" (7 path fields, rarely touched) into a collapsible
  "Advanced / vault layout" section; and carve out an explicit **Danger zone** at the bottom
  holding Reset (and visually separating it from validate/repair, which belong in a benign
  "Diagnostics" group with CI readiness).
- **Environments as cards with summary + edit:** render each environment as a compact card
  (name · active badge · base-URL preview · "`N` secrets") that expands to the full editor,
  instead of always-expanded blocks. Add visible "Name / Value" column headers to the auth
  editor and a "secrets are injected verbatim / referenced as CI secrets" caption once per
  block, not per row.

### 3.5 Danger / validation UX

- **Unify destructive affordance:** every destructive action (PRD delete, env remove, reset)
  should use the same two-click arm/disarm component already proven in
  `settings-environments.ts:225` / `settings-maintenance.ts:88` — PRD delete (M3) is the
  outlier to fix.
- **Unify validation feedback:** the inline checklist / inline error-list pattern
  (`settings-shared.ts`, `renderSutErrors`) is good — extend it to the PRD builder (which still
  uses ad-hoc `error-text` paragraphs and end-of-wizard Notices) so the whole product speaks one
  validation language (✓/✗/! rows with `aria-live`).

### 3.6 Live-refresh feedback

Add a subtle "Updated just now / Updating…" affordance to `LiveDashboardView` (a timestamp +
brief highlight on the changed section) so the live hub *feels* live — currently its best
feature is invisible.

---

## 4. Prioritized recommendations

| # | Recommendation | Impact | Effort | Risk | Dependencies |
|---|---|---|---|---|---|
| R1 | Health hero card leading the hub (pass-rate over `automatedUseCases`; **no env label** and **last-run verdict from run-history, not the snapshot's evidence-linked `lastTestRun`** — §3.1 caveats) | H | M | Low–Med | Snapshot provides the pass/fail counts; the **last-run verdict needs a run-history/test-execution source** (snapshot `lastTestRun` skips errored/evidence-less runs) |
| R2 | KPI funnel with denominators/%/bars + Failing-only-when-`>0` | H | M | Low | Pure projection change; CSS |
| R3 | Make KPI tiles real filters (widen `DashboardNavTarget`, honour filter in UC explorer) | H | M | Med | Cross-surface: Use Cases explorer must accept a filter (coordinate with explorer owner) |
| R4 | Reorder hub: health/actions/KPIs/runs first; docs+onboarding deferred to footer/empty-state | H | L | Low | None |
| R5 | Gate PRD Delete behind two-click arm/disarm (reuse settings component) | H | L | Low | Extract shared confirm helper from settings |
| R6 | Settings IA: Advanced (paths) collapsible + explicit Danger zone for Reset | M | M | Low | `getSettingDefinitions` grouping; declarative + legacy render parity |
| R7 | PRD builder: step rail, per-step validation, drop dead Success step, clickable Review | M | M | Med | `prd-builder` projections; modal flow rework |
| R8 | Richer recent-runs (counts, env, duration, re-run, friendly run label) | M | M | Med | Needs run summary to carry counts/env/duration (upstream `TestRunSummary`) |
| R9 | Per-PRD coverage chip in explorer + roadmap roll-up on hub | M | M | Med | Needs per-PRD pass/fail roll-up (traceability service) |
| R10 | Environment cards (summary→expand) + auth column headers/caption | M | M | Low | `settings-environments` render rework |
| R11 | Live-refresh "updated just now" feedback | M | L | Low | `LiveDashboardView`/`LiveRefresh` |
| R12 | Unify destructive + validation affordances into shared components | M | M | Low | Touches PRD builder, explorer, settings |
| R13 | Richer empty/first-run states with inline CTAs + identity illustration | L | L | Low | None |
| R14 | Remove redundant hub `<h2>`; tighten status-vocabulary/colour consistency | L | L | Low | None |

---

## 5. Open questions for the product owner

1. **Health hero metric, denominator & environment attribution:** is the headline "pass rate
   of automated Use Cases" — and if so, **`passing ÷ automatedUseCases`** (honest; includes
   mid-implementation `implemented` UCs) or `passing ÷ (passing+failing)` (a *terminal* rate
   that drops `implemented` and overstates health — §3.1 caveat)? Or a coverage-weighted
   figure that also penalises unspecified/unautomated Use Cases? This decides whether the hero
   rewards green tests or honest coverage. **And** — since runs/evidence carry no environment
   today (§3.1 caveat) — do we ship the hero env-agnostic for V1, or add a run-environment
   dimension so health can be attributed per environment?
2. **KPI filter drill-downs (R3):** are we willing to add a filter contract to the Use Cases
   explorer so "Failing" lands on failing UCs? Without it, the tiles stay decorative.
3. **"Roadmap" framing:** the hub section labelled "roadmap" only lists direct sub-PRDs. Should
   the dashboard surface a *real* roadmap (Story Map release slices / walking skeleton per
   ADR-0027/0030), or stay a PRD roll-up and rename the section to avoid the roadmap promise?
4. **PRD builder length:** is the 7-step wizard the right model, or should PRD creation be a
   lighter single-form-with-sections (title+vision+scope) that opens the note for the rest?
   The dead Success step suggests the wizard outgrew its inputs.
5. **Settings audience:** who edits the 7 folder paths in practice? If "almost never", they can
   be collapsed/hidden behind Advanced; if power-users relocate vaults often, they stay visible.
6. **Recent-runs depth:** how much do we surface inline (counts/env/duration/re-run) vs. defer
   to the Evidence Explorer? This sets where the "actionable" line is drawn.
7. ~~**Identity system**~~ — **DECIDED (§0/T2): a default Specorator brand teal** (`--spec-accent`,
   shipped in A1). The hero/KPIs draw the brand token, not theme-only — staying strictly within
   Obsidian variables is no longer an option. Express identity through that accent + layout +
   typography + iconography.
