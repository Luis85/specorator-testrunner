import type { VaultPath } from "../../domain/value-objects/identifiers";

/**
 * The deep-link navigation target (WS-A4/B4, 01-§3.2). A **discriminated union**
 * over every node kind in the artifact graph — NOT an id-only signature (Codex
 * catch): only PRD/UC/SM are id-resolvable; Feature/Suite/Evidence are addressed
 * by their vault note path and a Run by its run id.
 *
 * - `artifact` — a PRD / Use Case / Story Map, resolved via the existing
 *   `findById` classification (`classifyArtifactId`) and opened in its view.
 * - `feature` — a Feature Specification, opened by its `.feature` vault path
 *   (Scenario References encode `featurePath`; the `.feature` editor handles it).
 * - `suite` — a Test Suite note, opened by the vault path the suite carries.
 * - `evidence` — an Evidence note, opened by its `VaultPath`
 *   (`TraceabilityRecord.evidence` is `VaultPath[]`).
 * - `run` — a Test Run, addressed by its `runId`; the navigator resolves the run
 *   to the evidence note it produced (no `findById` on the run history today, so
 *   B4 adds a `findByRunId` lookup) and opens that note.
 */
export type NavigationTarget =
  | { kind: "artifact"; id: string }
  | { kind: "feature"; path: VaultPath }
  | { kind: "suite"; path: VaultPath }
  | { kind: "evidence"; path: VaultPath }
  | { kind: "run"; runId: string };

/** A by-id artifact target (PRD/UC/SM) — the most common deep-link. */
export const artifactTarget = (id: string): NavigationTarget => ({ kind: "artifact", id });

/** A Feature-by-path target (Features open by vault path, not by id). */
export const featureTarget = (path: VaultPath): NavigationTarget => ({ kind: "feature", path });

/** A Suite-by-path target (the note a `TestSuite` carries). */
export const suiteTarget = (path: VaultPath): NavigationTarget => ({ kind: "suite", path });

/** An Evidence-note-by-path target (`TraceabilityRecord.evidence` paths). */
export const evidenceTarget = (path: VaultPath): NavigationTarget => ({ kind: "evidence", path });

/** A Run-by-id target; the navigator opens the evidence the run produced. */
export const runTarget = (runId: string): NavigationTarget => ({ kind: "run", runId });
