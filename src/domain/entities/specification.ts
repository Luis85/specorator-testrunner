import type { UseCaseId, VaultPath } from "../value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/** Feature Specification domain types (TIS §6.4–§6.6). */

export interface GherkinStep {
  keyword: "Given" | "When" | "Then" | "And" | "But" | "*";
  text: string;
}

export interface ScenarioSpecification {
  name: string;
  tags: string[];
  steps: GherkinStep[];
}

export interface FeatureSpecification {
  path: VaultPath;
  useCaseId: UseCaseId; // required per ADR-0012; orphan features are a validation error
  featureName: string;
  tags: string[];
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
    ...(params.background && params.background.length > 0 ? { background: params.background } : {}),
    scenarios: params.scenarios ?? [],
  });
};
