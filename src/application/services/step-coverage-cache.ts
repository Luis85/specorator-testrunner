import type { StepDefinitionPattern } from "../content/step-definitions";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { fnv1a } from "../../shared/hash/fnv1a";

/** Order-sensitive digest of a string list (JSON-encoded so values can't alias). */
const listDigest = (parts: readonly string[]): string => fnv1a(JSON.stringify(parts)).toString(36);

// JSON-encode each pattern's fields so no separator can alias across them
// (source "a b" + no flags vs source "a" + flags "b" must digest differently).
const patternsDigest = (patterns: readonly StepDefinitionPattern[]): string =>
  listDigest(patterns.map((p) => JSON.stringify([p.kind, p.source, p.flags ?? ""])));

interface CoverageEntry {
  stepTextsHash: string;
  defsHash: string;
  covered: boolean;
}

/**
 * In-memory, per-session record of bddgen coverage verdicts (issue #77): for a
 * Feature whose step texts AND whose loaded step-definition pattern set still
 * hash-match a recorded bddgen run, `allStepsDefined` can serve the
 * authoritative verdict instead of the conservative static heuristic.
 *
 * CONTENT-ADDRESSED ON BOTH INPUTS (spec D6 — deliberate deviation from #77's
 * sketched `defsRevision` event counter): the pattern set is re-hashed on every
 * read, so a step definition edited or deleted OUTSIDE the plugin invalidates
 * the entry — the counter would have missed that (a stale "covered" is the
 * dangerous direction). A miss is always safe: callers fall back to the static
 * heuristic. Nothing is persisted (spec D7).
 *
 * 32-bit digests: a colliding edit could in principle serve a stale verdict
 * (~2^-32 per changed-input read) — accepted; the verdict only gates
 * rail/panel affordances and self-heals on the next detect.
 */
export class StepCoverageCache {
  private readonly entries = new Map<string, CoverageEntry>();

  /** Record a bddgen verdict for the Feature as its inputs looked when bddgen ran. */
  record(
    featurePath: VaultPath,
    stepTexts: readonly string[],
    definitions: readonly StepDefinitionPattern[],
    covered: boolean,
  ): void {
    this.entries.set(featurePath, {
      stepTextsHash: listDigest(stepTexts),
      defsHash: patternsDigest(definitions),
      covered,
    });
  }

  /**
   * The recorded verdict, or null when there is none or either input has since
   * changed (the caller then uses the static heuristic).
   */
  authoritativeCovered(
    featurePath: VaultPath,
    stepTexts: readonly string[],
    definitions: readonly StepDefinitionPattern[],
  ): boolean | null {
    const entry = this.entries.get(featurePath);
    if (entry === undefined) return null;
    if (entry.stepTextsHash !== listDigest(stepTexts)) return null;
    if (entry.defsHash !== patternsDigest(definitions)) return null;
    return entry.covered;
  }
}
