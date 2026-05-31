import type { TestSuite } from "../../domain/entities/suite";
import type { VaultPath } from "../../domain/value-objects/identifiers";

/** A Test Suite projected to the columns the suites panel displays (US-023/US-024/US-025). */
export interface SuiteRow {
  id: string;
  name: string;
  tagExpression: string;
  path: VaultPath;
}

/** Pure projection so the suites panel's row shaping is unit-testable. */
export const projectSuiteRows = (suites: TestSuite[]): SuiteRow[] =>
  suites.map((suite) => ({
    id: suite.id,
    name: suite.name,
    tagExpression: suite.tagExpression,
    path: suite.path,
  }));
