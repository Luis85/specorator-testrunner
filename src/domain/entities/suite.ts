import type { SuiteId, VaultPath } from "../value-objects/identifiers";

/** Test Suite domain entity (TIS §6.7). Membership is by tag, never explicit. */
export interface TestSuite {
  id: SuiteId;
  name: string;
  description?: string;
  tagExpression: string; // Cucumber tag expression per AD-4 (e.g. "@smoke and not @wip")
  path: VaultPath;
}
