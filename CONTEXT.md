# Obsidian E2E Test Hub

Markdown-native, local-first BDD workbench inside Obsidian: define Use Cases, write Gherkin specifications, execute Playwright tests via a self-contained `.testrunner`, and review evidence — all without leaving the vault.

## Language

### Product surfaces

**Test Hub**:
The plugin's user-facing workbench inside Obsidian. Encompasses the dashboard, explorers, monitor, and settings.
_Avoid_: Plugin UI, frontend, workbench.

**.testrunner**:
The self-contained Node project generated into the vault root by the plugin. Holds the Playwright + Cucumber-JS runtime so tests execute identically inside Obsidian and inside CI.
_Avoid_: Runner folder, test directory, test harness.

**Vault**:
The Obsidian vault that contains both the business-facing Markdown artifacts and the `.testrunner` runtime. The vault root and the git repo root are the same path in V1.
_Avoid_: Workspace, project folder.

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

**Test Run**:
A single invocation of the runner against some scope. Identified as `RUN-<timestamp>`. Always has exactly one terminal event: `testrun.completed` (passed/failed), `testrun.failed` (errored), or `testrun.cancelled`.
_Avoid_: Test execution, run instance, job.

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

**System Under Test (SUT)**:
The application that the tests drive. Real usage points at one of several **Environments**; the demo locks the SUT to a local static HTML fixture (`file://`) and ignores environment configuration entirely.
_Avoid_: Target, app under test, AUT.

**Environment**:
A named addressable instance of the SUT (e.g. `staging`, `production`). The Test Hub stores a list of environments, each with at least a `baseUrl`, and tracks one **active environment**. Switching environments is a single action; never edit a URL inline. The demo bypasses environments entirely.
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
A constant identifier shared by all events in one logical flow. For a Test Run, `correlationId = runId`; for the Initialization Wizard, the wizard invocation id.
_Avoid_: Trace id, request id.
