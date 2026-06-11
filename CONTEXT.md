# Obsidian E2E Test Hub

Markdown-native, local-first BDD workbench inside Obsidian: define Use Cases, write Gherkin specifications, execute Playwright tests via a self-contained `.testrunner`, and review evidence — all without leaving the vault.

## Language

### Product surfaces

**Test Hub**:
The plugin's user-facing workbench inside Obsidian. Encompasses the dashboard, explorers, Test Console, and settings.
_Avoid_: Plugin UI, frontend, workbench.

**.testrunner**:
The self-contained Node project generated into the vault root by the plugin. Holds the Playwright + Cucumber-JS runtime so tests execute identically inside Obsidian and inside CI.
_Avoid_: Runner folder, test directory, test harness.

**Vault**:
The Obsidian vault that contains both the business-facing Markdown artifacts and the `.testrunner` runtime. The vault root and the git repo root are the same path in V1.
_Avoid_: Workspace, project folder.

**Project**:
The unit the Test Hub manages: one Vault = one git repo = one `.testrunner/` = one set of Use Cases, Specifications, Suites, Evidence, and one set of Environments (per ADR-0015). A user who needs to test two different applications uses two separate Vaults. Variations of *the same* application (mobile/desktop, staging/production) are expressed through Suites and Environments, not through projects.
_Avoid_: Workspace, repo, instance.

### Business artifacts

**Use Case**:
A business-facing description of a single capability the System Under Test must support. A Markdown note with frontmatter, identified as `UC-NNN`. May own 0..N **Feature Specifications**. Distinct from "use case" in the generic software-architecture sense.
_Avoid_: Story, requirement, scenario, ticket.

**Feature Specification**:
A `.feature` file in Gherkin that makes part of a Use Case executable. Each Feature belongs to exactly one Use Case; the back-reference is encoded both in the filename (`<UC-id>-<slug>.feature`) and in the Feature's frontmatter. Sharing test logic across Use Cases is done via step definitions and Cucumber `Background`, never via shared Feature files.
_Avoid_: Feature file (informal), spec file, BDD file.

**Test Suite**:
A named collection of scenarios defined by a Cucumber **Tag Expression**. Membership is by tag, never by explicit scenario list.
_Avoid_: Test group, test set, test pack.

**Tag Expression**:
A Cucumber tag-expression string such as `@smoke and not @wip` that determines which scenarios a Test Suite includes. The single source of truth for suite membership.
_Avoid_: Tag list, tag query, filter.

**`@wip` Tag**:
The conventional Cucumber tag for "work in progress." A Feature tagged `@wip` is excluded from the dashboard's KPI roll-up (per ADR-0017) so half-built work does not drag the dashboard red. Granularity is the Feature, not the scenario.
_Avoid_: Draft tag, todo tag, skip tag.

**Test Run**:
A single invocation of the runner against some scope. Identified as `RUN-<timestamp>`. Always has exactly one terminal event: `testrun.completed` (passed/failed), `testrun.failed` (errored), or `testrun.cancelled`. At most one Run is active per Vault at a time (per ADR-0018); a second concurrent Run is rejected with `RUN_IN_PROGRESS` until the active one terminates.
_Avoid_: Test execution, run instance, job.

**Scenario Reference** _(deferred — not yet implemented in V1)_:
A planned natural key for identifying a Cucumber scenario inside the Test Hub: `<featurePath>::<scenarioName>` (and `::row-<index>` for a Scenario Outline example), intended to be stable across runs but **not** across renames — renaming a scenario would produce a new Scenario Reference and lose prior history once. **This concept has no code representation in V1.** Scenario-level identity and history are not tracked; the previously dead `ScenarioReference` type alias is being removed and the term is documented here only as a deferred concept (see V1 Review plan P3-5). Until it lands, the executable unit of identity is the **Feature** (see _Feature Specification_), not the scenario.
_Avoid_: Scenario id, scenario key, test id.

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
The event-observed onboarding checklist: a persistent sidebar view that walks a user through the full V1 loop (Use Case → Feature → Gherkin → step definitions → Suite → Run → Evidence → CI) by observing domain events as the user performs each real action. Distinct from the Initialization Wizard — the wizard scaffolds, the tour teaches. Completing it leaves the user with a self-authored test (the `@tour` greeting scenario against the extended fixture).
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
