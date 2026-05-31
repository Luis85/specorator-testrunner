import type { SuiteId } from "../../domain/value-objects/identifiers";
import { buildNote } from "../../shared/utils/frontmatter";

/** Seed for a suite created during initialization. */
export interface DefaultSuiteSeed {
  id: SuiteId;
  name: string;
  description: string;
  tagExpression: string; // Cucumber tag expression per AD-4
}

/** Smoke + Regression, per G1 / UC-001 step 6. */
export const DEFAULT_SUITES: DefaultSuiteSeed[] = [
  {
    id: "smoke",
    name: "Smoke Suite",
    description: "Critical-path tests.",
    tagExpression: "@smoke",
  },
  {
    id: "regression",
    name: "Regression Suite",
    description: "The full regression set. Tag scenarios @regression to include them.",
    tagExpression: "@regression",
  },
];

/** Renders a Test Suite note (frontmatter schema TIS §10.2). */
export const buildSuiteNote = (seed: DefaultSuiteSeed): string =>
  buildNote(
    {
      type: "test-suite",
      id: seed.id,
      title: seed.name,
      description: seed.description,
      tag_expression: seed.tagExpression,
    },
    `# ${seed.name}

${seed.description}

- **Tag expression:** \`${seed.tagExpression}\`

Membership is by tag, never an explicit scenario list. Edit the tag expression
above to change which scenarios this suite includes.
`,
  );
