import {
  findMissingSteps,
  type StepDefinitionPattern,
} from "../../application/content/step-definitions";
import type { ExecutionScope } from "../../domain/entities/test-run";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";

/**
 * The Pending Steps companion (WS1/C2, spec §3.2): pure projections behind the
 * sidebar panel, so the Vue surface stays a thin render (ADR-0029/0033).
 */

/** What the panel is pointed at — persisted as the leaf's view state (spec D5). */
export type PendingStepsTarget =
  | { kind: "use-case"; useCaseId: string }
  | { kind: "feature"; featurePath: VaultPath }
  | { kind: "vault" };

/** One Feature's step-coverage picture inside the panel. */
export interface PendingFeatureGroup {
  path: VaultPath;
  /** The filename — the panel's row label. */
  label: string;
  totalSteps: number;
  definedSteps: number;
  /** E.g. "12 of 15 steps defined" — rendered next to the progress bar. */
  progressText: string;
  /** The undefined step texts (distinct, first-seen order). */
  missing: string[];
  /**
   * Which signal produced `missing`: the conservative static matcher, or an
   * authoritative bddgen detect (spec D8 — bddgen only on explicit actions).
   */
  tier: "static" | "bddgen";
  /** Every declared step has a definition (and there IS at least one step). */
  complete: boolean;
}

/**
 * Projects one Feature's panel group. `bddgenMissing` is the authoritative
 * missing list when a detect has run (null → static tier via
 * {@link findMissingSteps}).
 */
export const projectPendingFeature = (
  path: VaultPath,
  stepTexts: readonly string[],
  definitions: readonly StepDefinitionPattern[],
  bddgenMissing: readonly string[] | null,
): PendingFeatureGroup => {
  const missing =
    bddgenMissing === null
      ? findMissingSteps([...stepTexts], [...definitions])
      : [...bddgenMissing];
  const missingSet = new Set(missing);
  const definedSteps = stepTexts.filter((text) => !missingSet.has(text)).length;
  const totalSteps = stepTexts.length;
  return {
    path,
    label: path.split("/").pop() ?? path,
    totalSteps,
    definedSteps,
    progressText: `${definedSteps} of ${totalSteps} steps defined`,
    missing,
    tier: bddgenMissing === null ? "static" : "bddgen",
    complete: totalSteps > 0 && missing.length === 0,
  };
};

/**
 * The panel target for a finished run's scope — the console's missing-steps
 * hint opens the panel here. Suite/all/demo runs span features, so they open
 * the vault-wide listing (spec §3.3).
 */
export const pendingStepsTargetForRun = (
  scope: ExecutionScope,
  target: string,
): PendingStepsTarget => {
  if (scope === "use-case") return { kind: "use-case", useCaseId: target };
  if (scope === "feature") return { kind: "feature", featurePath: unsafeVaultPath(target) };
  return { kind: "vault" };
};

/**
 * Reads the persisted `target` off Obsidian's opaque `setState` payload without
 * an unsafe cast — the same idiom as `readPersistedActiveSection`
 * (hub-sections.ts). Null for anything that isn't one of the three shapes; the
 * view then falls back to the vault target.
 */
export const readPersistedPendingStepsTarget = (state: unknown): PendingStepsTarget | null => {
  if (typeof state !== "object" || state === null) return null;
  const target: unknown = (state as Record<string, unknown>).target;
  if (typeof target !== "object" || target === null) return null;
  const record = target as Record<string, unknown>;
  if (record.kind === "vault") return { kind: "vault" };
  if (record.kind === "use-case" && typeof record.useCaseId === "string") {
    return { kind: "use-case", useCaseId: record.useCaseId };
  }
  if (record.kind === "feature" && typeof record.featurePath === "string") {
    return { kind: "feature", featurePath: unsafeVaultPath(record.featurePath) };
  }
  return null;
};
