import type { UseCaseId, VaultPath } from "../value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/** Feature Specification domain types (TIS §6.4–§6.6). */

/** A step's doc-string argument (TIS §6.4; Gherkin `"""` / ``` fences). */
export interface DocString {
  fence: '"""' | "```";
  /** Optional content type after the opening fence, e.g. `"""json`. */
  mediaType?: string;
  /** Body lines, dedented by the opening fence's indentation. */
  lines: string[];
}

/** One `Examples:` table under a Scenario Outline. */
export interface ExamplesBlock {
  tags: string[];
  name?: string;
  /** Column names (the first `|` row). */
  header: string[];
  rows: string[][];
}

/**
 * A step's single argument (TD-002): Gherkin allows at most ONE — a data
 * table or a doc string. The sum type makes the table+docString combination
 * unrepresentable; `serialiseFeature` can no longer emit Gherkin the Gherkin
 * parser refuses to parse.
 */
export type StepArgument =
  | { kind: "table"; rows: string[][] }
  | { kind: "docString"; docString: DocString };

export interface GherkinStep {
  keyword: "Given" | "When" | "Then" | "And" | "But" | "*";
  text: string;
  /** The step's at-most-one argument (TD-002). */
  argument?: StepArgument;
}

/** Convenience accessors so consumers don't re-spell the discriminant. */
export const stepTable = (step: GherkinStep): string[][] | undefined =>
  step.argument?.kind === "table" ? step.argument.rows : undefined;

export const stepDocString = (step: GherkinStep): DocString | undefined =>
  step.argument?.kind === "docString" ? step.argument.docString : undefined;

export interface ScenarioSpecification {
  /** Absent means a plain `Scenario` (backward compatible with V1 literals). */
  keyword?: "Scenario" | "Scenario Outline";
  name: string;
  tags: string[];
  /** Free-text lines under the `Scenario:` line, before the first step. */
  description?: string[];
  steps: GherkinStep[];
  /** `Examples:` blocks (Scenario Outline only). */
  examples?: ExamplesBlock[];
}

/**
 * THE "is this scenario an Outline" predicate (TD-005). Deliberately
 * LENIENT: the `Scenario Outline` keyword OR attached `Examples:` blocks
 * count. The lenient parser attaches Examples to a plain `Scenario:`
 * (malformed Gherkin the parser rejects); treating it as an Outline keeps
 * suite/tag match counts, the editor's Examples grid, and V2 scenario
 * identity (`::row-N`, US-056) in agreement instead of hiding the blocks.
 * Parse-time keyword normalisation was considered and rejected for now: it
 * would change round-trip behaviour for malformed files.
 */
export const isScenarioOutline = (scenario: ScenarioSpecification): boolean =>
  scenario.keyword === "Scenario Outline" || scenario.examples !== undefined;

export interface FeatureSpecification {
  path: VaultPath;
  useCaseId: UseCaseId; // required per ADR-0012; orphan features are a validation error
  featureName: string;
  tags: string[];
  /** Free-text lines under the `Feature:` line. */
  description?: string[];
  background?: GherkinStep[]; // Background steps; run before every scenario
  scenarios: ScenarioSpecification[];
}

/**
 * Invariant-enforcing factory for {@link FeatureSpecification} (ADR-0012, DOM-M1).
 *
 * Enforces the "no orphans" rule: a Feature MUST trace back to exactly one Use
 * Case, so `useCaseId` must be present and non-blank. The type already marks
 * `useCaseId` non-optional, but a plain object literal can still set it to `""`;
 * this factory makes that impossible at construction, returning a
 * `VALIDATION_FAILED` error instead of a bogus, untraceable entity.
 *
 * Note: the lenient Gherkin parser (`parseFeature`) deliberately does NOT go
 * through this factory for orphan filenames — it yields a feature with an empty
 * `useCaseId` so `SpecificationService.validate` can report the orphan with a
 * file/line message (the documented validation path). This factory is the
 * chokepoint for *programmatic* construction, where an empty UC id is a bug.
 */
export const createFeatureSpecification = (params: {
  path: VaultPath;
  useCaseId: UseCaseId;
  featureName: string;
  tags?: string[];
  description?: string[];
  background?: GherkinStep[];
  scenarios?: ScenarioSpecification[];
}): Result<FeatureSpecification> => {
  if (params.useCaseId.trim() === "") {
    return err(
      appError(
        "VALIDATION_FAILED",
        "A Feature Specification must reference a Use Case (no orphans, ADR-0012).",
      ),
    );
  }
  return ok({
    path: params.path,
    useCaseId: params.useCaseId,
    featureName: params.featureName,
    tags: params.tags ?? [],
    ...(params.description && params.description.length > 0
      ? { description: params.description }
      : {}),
    ...(params.background && params.background.length > 0 ? { background: params.background } : {}),
    scenarios: params.scenarios ?? [],
  });
};
