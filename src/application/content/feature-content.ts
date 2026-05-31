import type { UseCase } from "../../domain/entities/use-case";
import type { UseCaseId } from "../../domain/value-objects/identifiers";

/**
 * Feature file naming and starter content (UC-006, ADR-0012). Feature files are
 * plain Gherkin (no YAML frontmatter), mirroring DEMO_FEATURE_CONTENT: the Use
 * Case back-reference lives in the filename (`<UC-id>-<slug>.feature`) and the
 * `@<uc-id-lowercased>` tag.
 */

/** Slugifies free text into a filename-safe, lowercase, dash-joined token. */
export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** `UC-001-happy-path.feature` (ADR-0012). */
export const featureFileName = (useCaseId: UseCaseId, slug: string): string =>
  `${useCaseId}-${slug}.feature`;

/**
 * Picks the slug for the next Feature under a Use Case: `happy-path` for the
 * first Feature, otherwise `feature-<n>` (UC-006 step 3). A caller-supplied slug
 * always wins so a UI prompt can name additional Features.
 */
export const nextFeatureSlug = (useCase: UseCase, requested?: string): string => {
  const explicit = requested ? slugify(requested) : "";
  if (explicit) return explicit;
  return useCase.featureFiles.length === 0
    ? "happy-path"
    : `feature-${useCase.featureFiles.length + 1}`;
};

/**
 * Renders a starter Feature: one placeholder Scenario with Given/When/Then.
 * Tagged `@<uc-id-lowercased>` so the Feature is traceable by tag and
 * runnable via the use-case run scope (TIS §13.2).
 */
export const buildStarterFeature = (useCase: UseCase, slug: string): string => {
  const tag = `@${useCase.id.toLowerCase()}`;
  const title = useCase.title || useCase.id;
  return `${tag}
Feature: ${title}
  ${useCase.description ? useCase.description : `Specification for ${useCase.id}.`}

  Scenario: ${slug.replace(/-/g, " ")}
    Given a precondition
    When an action occurs
    Then an outcome is observed
`;
};
