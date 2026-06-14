import type { SuiteId, VaultPath } from "../value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/** Test Suite domain entity (TIS §6.7). Membership is by tag, never explicit. */
export interface TestSuite {
  id: SuiteId;
  name: string;
  description?: string;
  tagExpression: string; // tag expression per AD-4 (e.g. "@smoke and not @wip")
  path: VaultPath;
}

/**
 * Invariant-enforcing factory for {@link TestSuite} (ADR-0011 / AD-4, DOM-M1).
 *
 * A Suite's tag expression IS its membership — its single source of truth — so
 * both `name` and `tagExpression` must be non-blank. A suite with an empty tag
 * expression would resolve to "" and run nothing meaningful, so it is rejected
 * here at construction. This is the one place the rule lives; both creation
 * (from user input) and parsing (from stored frontmatter) route through it.
 */
export const createSuite = (params: {
  id: SuiteId;
  name: string;
  description?: string;
  tagExpression: string;
  path: VaultPath;
}): Result<TestSuite> => {
  if (params.name.trim() === "") {
    return err(appError("VALIDATION_FAILED", "A Test Suite name is required."));
  }
  if (params.tagExpression.trim() === "") {
    return err(appError("VALIDATION_FAILED", "A Test Suite tag expression is required."));
  }
  return ok({
    id: params.id,
    name: params.name,
    ...(params.description !== undefined ? { description: params.description } : {}),
    tagExpression: params.tagExpression,
    path: params.path,
  });
};
