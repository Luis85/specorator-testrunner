# Specorator Testrunner

Markdown-native, local-first BDD workbench inside Obsidian: define Use Cases, write Gherkin specifications, execute Playwright tests via a self-contained `.testrunner`, and review evidence — all without leaving the vault.

## Language

### Product surfaces

**Test Hub**:
The plugin's user-facing workbench inside Obsidian. Encompasses the dashboard, explorers, Test Console, and settings.
_Avoid_: Plugin UI, frontend, workbench.

**.testrunner**:
The self-contained Node project generated into the vault root by the plugin. Holds the Playwright + playwright-bdd runtime (`bddgen` + `@playwright/test`) so tests execute identically inside Obsidian and inside CI.
_Avoid_: Runner folder, test directory, test harness.

**Vault**:
The Obsidian vault that contains both the business-facing Markdown artifacts and the `.testrunner` runtime. The vault root and the git repo root are the same path in V1.
_Avoid_: Workspace, project folder.

**Project**:
The unit the Test Hub manages: one Vault = one git repo = one `.testrunner/` = one set of Use Cases, Specifications, Suites, Evidence, and one set of Environments (per ADR-0015). A user who needs to test two different applications uses two separate Vaults. Variations of *the same* application (mobile/desktop, staging/production) are expressed through Suites and Environments, not through projects.
_Avoid_: Workspace, repo, instance.

### Business artifacts

**Domain (research)**:
A bounded research context the team investigates — market signals, competitor behaviour, user pain — whose output is **findings**, not committed scope. Distinct from a **PRD**: a Domain is the research layer, a PRD is the committed-solution-scope layer synthesized from one or more Domains (per ADR-0026). Also distinct from "domain" in the DDD sense.
_Avoid_: Bounded context, problem space, research area.

**PRD** _(accepted — see ADR-0026)_:
A Product Requirements Document: the synthesis artifact between Domain research and Use Cases. States a **problem statement plus scope** (not research), drawn from one or more research **Domains**. Identified as `PRD-NNN` (`PRD-000` reserved for the root product vision). Stored one folder per PRD at `<prdsPath>/<id>-<slug>/<id>-<slug>.md`. The middle layer of the **Domain → PRD → Use Case** hierarchy (per ADR-0026).
_Avoid_: Spec, requirement doc, epic, brief.

**Use Case**:
A business-facing description of a single capability the System Under Test must support. A Markdown note with frontmatter, identified as `UC-NNN`. Links to exactly one **PRD** via `prd-id` (per ADR-0026). May own 0..N **Feature Specifications**. Distinct from "use case" in the generic software-architecture sense.
_Avoid_: Story, requirement, scenario, ticket.

**prd-id** _(accepted — see ADR-0026)_:
The Use Case frontmatter field that links a Use Case to its parent **PRD** (a `PRD-NNN` value). The hierarchy is a single-parent tree, so each Use Case names exactly one PRD. Optional until existing Use Cases are backfilled, then required.
_Avoid_: prdRef, parent, prd.

**parent-prd** _(accepted — see ADR-0026)_:
The PRD frontmatter field naming a PRD's parent PRD (a `PRD-NNN` value). The **root PRD** is identified by an **empty** `parent-prd:` field — never the literal `null` — which the read model normalizes to `undefined`.
_Avoid_: parent, parentId, root flag.

**display_order** _(accepted — see ADR-0026)_:
The PRD frontmatter field that orders sibling PRDs. Kept separate from the immutable `PRD-NNN` id so siblings can be reordered **without renaming ids** and breaking cross-references (per ADR-0026).
_Avoid_: order, sort key, sequence, index.

**Story Map** _(accepted — see ADR-0027, extended by ADR-0028)_:
A **sibling overlay to the PRD** (not a node in the Domain → PRD → Use Case tree) that shapes the product journey, vault-local and single-user. Identified as `SM-NNN`, anchored to a product via its `product` field (a PRD id). It holds the facts the single-parent tree was designed not to hold: an audience lane (`users`), an ordered **backbone** (`activities`), task-level **steps**, and ordered **release slices** (`slices`, first = the walking skeleton), over rich **Story Map Cards**. Stored one folder per map at `<storyMapsPath>/<id>-<slug>/<id>-<slug>.md`. Composes *above* an **Example Map** along the shared `UC-NNN` seam; the two are never conflated. Deliberately not interoperable with, or collaborative like, the storymaps.io tool it parallels (ADR-0028).
_Avoid_: Roadmap, backlog, journey map (a journey map is UX research, not this), example map.

**Backbone**:
The ordered list of **activities** across a **Story Map** — the user journey, left to right. An activity is a high-level user goal that may span several PRDs; it cannot be prioritized (only the cards beneath it can). Distinct from a PRD's `scope_in`, which is an unordered set.
_Avoid_: Activities row, epics, columns.

**Release Slice**:
A horizontal band of a **Story Map** that groups the Use Cases shipped together in one end-to-end increment — deliberately spanning PRD branches. The topmost slice is the **walking skeleton** (the thinnest shippable end-to-end system). Distinct from a Use Case's branch-local `increment` field.
_Avoid_: Release, sprint, milestone, swimlane.

**Story Map Card** _(rich model — see ADR-0028)_:
A placement on a **Story Map**, encoded as the parser-safe nine-field string `"ref | activity | step | slice | status | points | tags | color | title"`. The `ref` is an **optional** `UC-NNN` (a reference-less card is a free-text story not yet promoted to a Use Case). Alongside the (activity, step, slice) coordinate it carries map-owned planning attributes — a free-text **title**, a hand-set **planning status** (`planned`/`in-progress`/`done`/`blocked`, distinct from a Use Case's run-derived automation status), **story points**, **tags**, and a **color**. A referenced card renders its title plus a resolved, aliased wikilink `[[<note name>\|UC-NNN]]` so titled notes never dangle. The legacy three-field `"UC-NNN | activity | slice"` form (ADR-0027) still parses.
_Avoid_: Ticket, cell. (A reference-less card IS a "story" here, per ADR-0028.)

**Story Map Board** _(see ADR-0029)_:
The interactive visual rendering of a **Story Map** in the main workspace view — a users lane, activity/step columns, and slice rows of card tiles. An editable view over the note frontmatter (the single source of truth); the managed Markdown table is kept in sync. P1 shipped the read-only board; P2 added card drag-and-drop (drag a card to another (activity, step, slice) cell); P3 added structure reordering (drag a column/activity or row/slice header); P3b adds creating structure (a `+` inserts a placeholder activity/slice/step) and renaming any of them in place (double-click a header → edit). All persist through the same debounced, signature-guarded save (interact.js, pointer-based, behind a swappable adapter). Later phases add structure removal + step reorder, inline card editing, and zoom/pan.
_Avoid_: Canvas, whiteboard, grid view.

**Planning Status** _(accepted — see ADR-0028)_:
A **Story Map Card**'s hand-set lifecycle state — one of `planned`, `in-progress`, `done`, `blocked`. Deliberately distinct from a Use Case's **automation** status (passing/failing, derived from test runs): a card can be `planned` while its Use Case has no automation. The map owns this axis; it never mirrors the automation roll-up.
_Avoid_: Automation status, test status, state.

**Feature Specification**:
A `.feature` file in Gherkin that makes part of a Use Case executable. Each Feature belongs to exactly one Use Case; the back-reference is encoded both in the filename (`<UC-id>-<slug>.feature`) and in the Feature's frontmatter. Sharing test logic across Use Cases is done via step definitions (`createBdd()` steps) and Gherkin `Background`, never via shared Feature files.
_Avoid_: Feature file (informal), spec file, BDD file.

**Test Suite**:
A named collection of scenarios defined by a **Tag Expression**. Membership is by tag, never by explicit scenario list.
_Avoid_: Test group, test set, test pack.

**Tag Expression**:
A tag-expression string (Gherkin/BDD standard) such as `@smoke and not @wip` that determines which scenarios a Test Suite includes, evaluated by playwright-bdd at generation. The single source of truth for suite membership.
_Avoid_: Tag list, tag query, filter.

**`@wip` Tag**:
The conventional BDD tag for "work in progress." A Feature tagged `@wip` is excluded from the dashboard's KPI roll-up (per ADR-0017, whose run-state input is now per-scenario history — US-057) so half-built work does not drag the dashboard red. Granularity is the Feature, not the scenario.
_Avoid_: Draft tag, todo tag, skip tag.

**Test Run**:
A single invocation of the runner against some scope. Identified as `RUN-<timestamp>`. Always has exactly one terminal event: `testrun.completed` (passed/failed), `testrun.failed` (errored), or `testrun.cancelled`. At most one Run is active per Vault at a time (per ADR-0018); a second concurrent Run is rejected with `RUN_IN_PROGRESS` until the active one terminates.
_Avoid_: Test execution, run instance, job.

**Scenario Reference** _(implemented — see ADR-0022, US-056)_:
The natural key for a Gherkin scenario: `<featurePath>::<scenarioName>` (and
`::row-<digest>` for a Scenario Outline example). For the key to be
collision-free, scenario names must be unique within a Feature, must not contain
the reserved `::` delimiter, and an Outline's example rows must be distinct (all
three enforced by structural validation, per ADR-0022). The row key is
**content-stable**: `<digest>` derives from the example row's values, not its
position, so reordering example rows never re-attributes a row's history (US-056
resolved ADR-0022's provisional positional `::row-N`). Stable across runs but
**not** across renames — renaming a scenario mints a new Scenario Reference and
drops prior history once; the Feature Editor advises when this will happen.
Computed name-derived at parse time and attached to report results by the
`ScenarioIdentityResolver` (no ID write-back into `.feature` files). It is the
unit of scenario-level identity that per-scenario history (US-057) builds on.
_Avoid_: Scenario id, scenario key, test id.

**Scenario History** _(implemented — see ADR-0022, US-057)_:
The per-scenario record of recent run results, keyed by Scenario Reference. Each
finished run writes a committed, git-mergeable `scenarios.ndjson` per run under
the Evidence partition (ADR-0016); a regenerable `.testrunner/history` index
projects each scenario's latest status + last-N results (configurable
`historyDepth`, default 50) and is rebuilt from the logs (the note's
`testrunner-scenarios` block as fallback). The Use Case automation roll-up
derives from this history (latest status per scenario → Feature → UC), which
**removed the ADR-0017 prior-status "floor" and scope-awareness workaround**:
because each scenario keeps its own last-known status, a targeted rerun can
neither regress nor inflate the roll-up. An upgraded UC with a recorded run but
no history yet keeps its persisted status until its next run backfills history.
_Avoid_: run log (the per-run NDJSON is the *history log*; "Evidence" is the
human note), the floor.

**Evidence**:
A Markdown note under `Test Evidence/` that records the audit trail for one Test Run: result counts, links to reports, screenshots, and traces. Always **links** to artifacts in `.testrunner/reports/`, never duplicates them.
_Avoid_: Test report, results note, output.

**Demo Test**:
The single tagged scenario shipped by the init wizard that exercises the local fixture. Used as the first-run smoke check. Tagged `@smoke @demo`.
_Avoid_: Sample, hello-world test, example test.

**Fixture**:
A local static asset under `.testrunner/src/fixtures/` (currently `example.html`) that the demo test drives via `file://`. There is no fixture HTTP server in V1.
_Avoid_: Mock, stub, test page.

### Process

**Initialization Wizard**:
The first-run modal that scaffolds the vault, generates documentation, creates default suites, installs the runner, and validates. Does **not** auto-run the demo test.
_Avoid_: Onboarding flow, setup screen, first-launch dialog.

**Guided Tour**:
The event-observed onboarding checklist: a persistent sidebar view that walks a user through the full V1 loop (Use Case → Feature → Gherkin → step definitions (`createBdd()`) → Suite → Run → Evidence → CI) by observing domain events as the user performs each real action. Distinct from the Initialization Wizard — the wizard scaffolds, the tour teaches. Completing it leaves the user with a self-authored test (the `@tour` greeting scenario against the extended fixture).
_Avoid_: Tutorial, walkthrough, onboarding wizard.

**System Under Test (SUT)**:
The application that the tests drive. Real usage points at one of several **Environments**; the demo locks the SUT to a local static HTML fixture (`file://`) and ignores environment configuration entirely.
_Avoid_: Target, app under test, AUT.

**Environment**:
A named addressable instance of the SUT (e.g. `staging`, `production`). The Test Hub stores a list of Environments, each with at least a `baseUrl` and optionally a set of credential env vars (per ADR-0014), and tracks one **active environment**. Switching environments is a single action; never edit a URL inline.
_Avoid_: Stage, target, deployment, profile.

**Active Environment**:
The Environment that subsequent test runs will execute against unless an explicit override is given. Persisted in settings; surfaced in the dashboard's top bar.
_Avoid_: Current target, selected env.

### Architectural decisions

**AD-N**:
A short-lived V1 configuration decision recorded inline in `docs/architecture/Solution Design.md §25` (e.g. AD-2 fixes npm, AD-5 fixes Chromium-only). Tactical and parametric.
_Avoid_: ADR (those are different — see below).

**ADR-NNNN**:
A long-form architectural decision record in `docs/adr/`. Hard-to-reverse, shape-defining decisions only. Different in scope and lifecycle from AD-N.
_Avoid_: Architecture note, AD, design note.

### Domain events

**Domain Event**:
A past-tense fact published on the in-process **EventBus** with the envelope defined in `docs/architecture/Event Catalog.md §2`. Events name what happened (`testrun.completed`), not what to do.
_Avoid_: Message, notification, signal.

**Correlation ID**:
A constant identifier shared by all events in one logical flow. For a Test Run, `correlationId = runId`; for the Initialization Wizard, the wizard invocation id; for the Guided Tour, the `tourId`.
_Avoid_: Trace id, request id.
