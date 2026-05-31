import type { UseCaseId, VaultPath } from "../../domain/value-objects/identifiers";
import { buildNote } from "../../shared/utils/frontmatter";

export const DEMO_USE_CASE_ID: UseCaseId = "UC-001";
export const DEMO_USE_CASE_TITLE = "Open Example Page";
export const DEMO_USE_CASE_FILE_NAME = "UC-001 Open Example Page.md";
export const DEMO_FEATURE_FILE_NAME = "UC-001-open-example-page.feature";
export const DEMO_SUITE_IDS = ["smoke", "regression"] as const;

/**
 * Demo Feature Specification (TIS §11.10). Plain Gherkin — no YAML frontmatter,
 * so Cucumber parses it directly; the Use Case back-reference lives in the
 * filename and the `@demo @smoke` tags.
 */
export const DEMO_FEATURE_CONTENT = `@demo @smoke
Feature: Open Example Page
  As a new user
  I want to run a working demo test
  So that I can verify the Test Hub installation

  Scenario: Complete the local demo page
    Given I open the local example page
    When I click the "Continue" button
    Then I should see "Test completed"
`;

/** Demo Use Case note (frontmatter schema TIS §10.1). */
export const buildDemoUseCaseNote = (featureFilePath: VaultPath): string =>
  buildNote(
    {
      type: "use-case",
      id: DEMO_USE_CASE_ID,
      title: DEMO_USE_CASE_TITLE,
      status: "specified",
      automation_status: "implemented",
      description: "A new user verifies that the Test Hub demo runs end-to-end.",
      feature_file: featureFilePath,
      suites: [...DEMO_SUITE_IDS],
    },
    `# ${DEMO_USE_CASE_ID} ${DEMO_USE_CASE_TITLE}

> A new user verifies that the Test Hub demo runs end-to-end.

This is the demo Use Case shipped by the Initialization Wizard. It owns a single
Feature Specification that drives a local static HTML fixture over \`file://\`,
so it runs without any network access.

## Feature Specification

- [[${featureFilePath}]]

## How to run it

Run the **Smoke** suite (\`@smoke\`) once the runner is installed. The scenario
opens the example page, clicks **Continue**, and asserts the result text.
`,
  );
