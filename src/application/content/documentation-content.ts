import type { TestHubSettings } from "../../domain/settings/settings";

/**
 * Stable identity for a generated doc. The first three map to the
 * `documentation.opened` payload's `documentType` (TIS §12); `index` is the
 * navigational hub the "Open Documentation" command opens (UC-021/022/023).
 */
export type DocumentationType = "getting-started" | "manual" | "troubleshooting" | "index";

/**
 * A doc's `documentType` as carried by `documentation.opened`. The Event Catalog
 * enum is extended to include `index` (TIS §12 / UC-021,022,023): the navigational
 * hub is the natural default entry point for the "Open Documentation" command, so
 * it must be openable and a valid event documentType.
 */
export type OpenableDocumentType = DocumentationType;

/** One generated documentation note. */
export interface DocumentationFile {
  type: DocumentationType;
  fileName: string; // relative to settings.paths.documentationPath
  content: string;
}

/**
 * The EPIC-011 document set written into the user's vault (US-043/044/045):
 * an index/overview hub, a Getting Started guide, a User Manual (core how-tos
 * for the full Requirements→Evidence→CI workflow), and a Troubleshooting guide.
 * Content is intentionally aligned with the V1 flow so the notes are useful the
 * moment initialization completes; builders are pure functions of settings.
 */
export const buildDocumentation = (settings: TestHubSettings): DocumentationFile[] => [
  buildIndexDoc(settings),
  buildGettingStartedDoc(settings),
  buildUserManualDoc(settings),
  buildTroubleshootingDoc(settings),
];

/** File name of a doc by type, so callers (e.g. access) can resolve it. */
export const documentationFileName = (
  settings: TestHubSettings,
  type: DocumentationType,
): string => {
  const file = buildDocumentation(settings).find((doc) => doc.type === type);
  // Every type is always built, so this is total; assert for the type system.
  if (!file) throw new Error(`Unknown documentation type "${type}".`);
  return file.fileName;
};

// US-046 / UC-021,022,023: the index is the entry point the access command
// opens; it links out to every other generated doc.
const buildIndexDoc = (settings: TestHubSettings): DocumentationFile => ({
  type: "index",
  fileName: "Test Hub Documentation.md",
  content: `# Test Hub Documentation

Welcome to the **E2E Test Hub** docs. This vault is a Markdown-native,
local-first BDD workbench: define Use Cases, write Gherkin specifications,
execute Playwright tests, review evidence, and ship a CI pipeline — all from
Obsidian.

## Contents

- [[Getting Started]] — install the runner and run your first test.
- [[User Manual]] — the full Requirements → Evidence → CI workflow and every
  Test Hub command.
- [[Troubleshooting]] — fixes for the problems you are most likely to hit.

## The workflow at a glance

> Requirements → Specification → Automation → Execution → Evidence → CI

1. **Initialize** the Test Hub (ribbon flask icon or **Initialize Test Hub**).
2. **Create a Use Case** and **Generate a Feature** from it.
3. **Run** a suite, use case, or feature.
4. **Review evidence** under \`${settings.paths.evidencePath}/\` and the live
   **Test Hub Dashboard**.
5. **Generate the CI workflow** to run the same suite on every push.
`,
});

// US-043 / UC-022: onboard a brand-new user end to end.
const buildGettingStartedDoc = (settings: TestHubSettings): DocumentationFile => {
  const { paths, runner } = settings;
  return {
    type: "getting-started",
    fileName: "Getting Started.md",
    content: `# Getting Started

Welcome to the **E2E Test Hub**. This guide takes you from an empty vault to a
passing test.

## What initialization created

- \`${paths.useCasesPath}/\` — business-facing Use Cases (\`UC-NNN\`).
- \`${paths.featureFilesPath}/\` — Gherkin Feature Specifications.
- \`${paths.testSuitesPath}/\` — tag-driven Test Suites (Smoke, Regression).
- \`${paths.evidencePath}/\` — audit trail for each Test Run.
- \`${paths.testRunnerPath}/\` — the self-contained Playwright + Cucumber-JS runner.

## Install the runner

The runner is a standalone Node project. Run **Validate Environment** to confirm
Node.js is available, then let initialization (or **Repair Installation**)
install dependencies with \`${runner.installCommand}\` and the Chromium browser
with \`${runner.browserInstallCommand}\`.

## Your first test

1. Open **Use Cases → UC-001 Open Example Page** to see the demo Use Case.
2. Open its Feature Specification under \`${paths.featureFilesPath}/\`.
3. Run **Run Demo Test** to execute it; output streams into the Test Console.

The demo drives a local static HTML fixture over \`file://\`, so it needs no
network access and behaves identically in CI.

## Next steps

- Read the **User Manual** for the full workflow and command reference.
- Read **Troubleshooting** if something does not work as expected.
`,
  };
};

// US-044 / UC-021: the reference manual — core concepts and how-tos for every
// step of the workflow, plus the command surface.
const buildUserManualDoc = (settings: TestHubSettings): DocumentationFile => {
  const { paths, runner } = settings;
  return {
    type: "manual",
    fileName: "User Manual.md",
    content: `# User Manual

The Test Hub turns requirements into executable specifications:

> Requirements → Specification → Automation → Execution → Evidence → CI

## Core concepts

- **Use Case** — a business-facing capability (\`UC-NNN\`). Owns 0..N Feature
  Specifications.
- **Feature Specification** — a \`.feature\` file in Gherkin. Each Feature belongs
  to exactly one Use Case (filename \`<UC-id>-<slug>.feature\`).
- **Test Suite** — a named set of scenarios selected by a Cucumber **tag
  expression** (e.g. \`@smoke and not @wip\`). Membership is by tag, never an
  explicit list.
- **Test Run** — one invocation of the runner against a scope.
- **Evidence** — a Markdown note recording the audit trail for a Run; it links
  to reports, never duplicates them.

## How to: create a Use Case

Run **New Use Case**, give it a title, and the plugin writes a \`UC-NNN\` note
into \`${paths.useCasesPath}/\`. Browse them from the **Open Use Cases** view.

## How to: generate a Feature

Run **Generate Feature from Use Case**, pick a Use Case, and a Gherkin
\`.feature\` scaffold is written under \`${paths.featureFilesPath}/\` and linked
back to the Use Case. **Validate Feature** checks the Gherkin; **Detect Missing
Steps** lists step definitions you still need.

## How to: organize Suites

Initialization creates two suites:

- **Smoke** — \`@smoke\` critical-path scenarios.
- **Regression** — \`@regression\` the full regression set (empty until you tag scenarios).

Create more with **New Test Suite** (a tag expression). Tag a Feature
\`@wip\` to keep half-built work out of the dashboard roll-up.

## How to: run tests

The \`${paths.testRunnerPath}/\` folder is a standalone Node project. Locally it runs
with \`${runner.defaultRunCommand}\`; in CI it runs with \`${runner.ciRunCommand}\` —
identical behavior in both places. Use the commands:

- **Run Demo Test**, **Run All Tests**
- **Run Suite…**, **Run Use Case…**, **Run Feature…** (pick from a list)
- **Cancel Test Run** stops the single active run.

Output streams live into the **Open Test Console** view.

## How to: review evidence and the dashboard

When a run finishes, its report is imported and a linked **Evidence** note is
written under \`${paths.evidencePath}/\` (toggle in settings). **Import Report for
Last Run** re-runs that import. **Open Dashboard** shows live KPI tiles (total /
specified / automated / passing / failing) and recent runs.

## How to: set up CI

Run **Generate CI Workflow** to write a GitHub Actions workflow that installs
the runner and runs the suite on every push; **Overwrite CI Workflow** replaces
an existing one. **Check CI Readiness** reports anything still missing.

## Settings

Open **Settings → E2E Test Hub** to review folder locations, runner commands,
and environments. Use **Reset to defaults** to restore the shipped configuration.

## Logs and privacy (ADR-0019)

When file logging is enabled, the plugin writes logs under \`${settings.logging.path}/\`.
Logs can capture environment details and run output, so **exclude them from
Obsidian Sync and version control** to avoid leaking them across machines or into
your repository: add the logs folder to your \`.gitignore\` and to the Obsidian
Sync *excluded files* list. Lower the **log level** (or disable file logging) in
settings if you don't need a persistent trail.
`,
  };
};

// US-045 / UC-023: self-service the common failure modes.
const buildTroubleshootingDoc = (settings: TestHubSettings): DocumentationFile => {
  const { paths, runner } = settings;
  return {
    type: "troubleshooting",
    fileName: "Troubleshooting.md",
    content: `# Troubleshooting

## Node.js is not installed

The runner needs **Node.js ${settings.ci.nodeVersion}+**. Install it from
<https://nodejs.org>, restart Obsidian, and re-run **Validate Environment**.

## Dependencies or browsers are missing

The runner installs dependencies with \`${runner.installCommand}\` and the
Chromium browser with \`${runner.browserInstallCommand}\`. The first install
downloads a browser (~150 MB) and can take a few minutes. Run **Repair
Installation** to re-sync.

## The demo test cannot find the fixture

The demo drives \`${paths.testRunnerPath}/src/fixtures/example.html\` over
\`file://\`. If the fixture is missing, repair the runner from the Test Hub.

## A vault path with spaces or non-ASCII characters breaks the runner

Keep the vault path simple. The plugin validates generated paths, but the
surrounding filesystem path matters too.

## Reports are not importing

Reports are written under \`${paths.testRunnerPath}/reports/\` and linked from
\`${paths.evidencePath}/\`. Confirm a Test Run actually completed before expecting
evidence, then run **Import Report for Last Run**.

## CI is not ready

Run **Check CI Readiness** — it lists what is missing (e.g. a generated
workflow). Run **Generate CI Workflow** to create one.
`,
  };
};
