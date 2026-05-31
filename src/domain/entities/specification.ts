import type { UseCaseId, VaultPath } from "../value-objects/identifiers";

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
