import type { TestHubSettings } from "../../domain/settings/settings";

/** One generated documentation note. */
export interface DocumentationFile {
  fileName: string; // relative to settings.paths.documentationPath
  content: string;
}

/**
 * Getting Started, User Manual, Troubleshooting (per G5: three docs, no
 * Reference). Content is intentionally aligned with the V1 flow so the notes
 * are useful the moment initialization completes.
 */
export const buildDocumentation = (settings: TestHubSettings): DocumentationFile[] => {
  const { paths, runner } = settings;
  return [
    {
      fileName: "Getting Started.md",
      content: `# Getting Started

Welcome to the **E2E Test Hub**. This vault is now a Markdown-native,
local-first BDD workbench: you define Use Cases, write Gherkin specifications,
execute Playwright tests, and review evidence — all without leaving Obsidian.

## What initialization created

- \`${paths.useCasesPath}/\` — business-facing Use Cases (\`UC-NNN\`).
- \`${paths.featureFilesPath}/\` — Gherkin Feature Specifications.
- \`${paths.testSuitesPath}/\` — tag-driven Test Suites (Smoke, Regression).
- \`${paths.evidencePath}/\` — audit trail for each Test Run.
- \`${paths.testRunnerPath}/\` — the self-contained Playwright + Cucumber-JS runner.

## Your first test

1. Open **Use Cases → UC-001 Open Example Page** to see the demo Use Case.
2. Open its Feature Specification under \`${paths.featureFilesPath}/\`.
3. Once the runner is installed, run the **@smoke** suite to execute the demo.

The demo drives a local static HTML fixture over \`file://\`, so it needs no
network access and behaves identically in CI.

## Next steps

- Read the **User Manual** for the full workflow.
- Read **Troubleshooting** if something does not work as expected.
`,
    },
    {
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

## Suites

Initialization creates two suites:

- **Smoke** — \`@smoke\` critical-path scenarios.
- **Regression** — \`@regression\` the full regression set (empty until you tag scenarios).

Tag a Feature \`@wip\` to keep half-built work out of the dashboard roll-up.

## The runner

The \`${paths.testRunnerPath}/\` folder is a standalone Node project. Locally it runs
with \`${runner.defaultRunCommand}\`; in CI it runs with \`${runner.ciRunCommand}\` —
identical behavior in both places.

## Settings

Open **Settings → E2E Test Hub** to review folder locations, runner commands,
and environments. Use **Reset to defaults** to restore the shipped configuration.
`,
    },
    {
      fileName: "Troubleshooting.md",
      content: `# Troubleshooting

## Node.js is not installed

The runner needs **Node.js ${settings.ci.nodeVersion}+**. Install it from
<https://nodejs.org>, restart Obsidian, and re-run validation.

## Dependencies or browsers are missing

The runner installs dependencies with \`${runner.installCommand}\` and the
Chromium browser with \`${runner.browserInstallCommand}\`. The first install
downloads a browser (~150 MB) and can take a few minutes.

## The demo test cannot find the fixture

The demo drives \`${paths.testRunnerPath}/src/fixtures/example.html\` over
\`file://\`. If the fixture is missing, repair the runner from the Test Hub.

## A vault path with spaces or non-ASCII characters breaks the runner

Keep the vault path simple. The plugin validates generated paths, but the
surrounding filesystem path matters too.

## Reports are not importing

Reports are written under \`${paths.testRunnerPath}/reports/\` and linked from
\`${paths.evidencePath}/\`. Confirm a Test Run actually completed before expecting
evidence.
`,
    },
  ];
};
