import type { RunHistoryEntry } from "../../application/services/run-history-service";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";
import { type ArtifactKind, classifyArtifactId } from "./artifact-id";
import type { ArtifactNavigationPort } from "./artifact-navigation-port";
import type { NavigationTarget } from "./navigation-target";

/** The minimal node a `findById` must yield for the navigator — an id and a note path. */
interface ResolvedNode {
  id: string;
  path: VaultPath;
}

/** A by-id lookup over the graph (structurally satisfied by every `*Service.findById`). */
interface NodeLookup {
  findById(id: string): Promise<Result<ResolvedNode | null>>;
}

/** The run-by-id lookup (WS-B4): resolves a run to the evidence note it produced. */
interface RunLookup {
  findByRunId(runId: string): Promise<Result<RunHistoryEntry | null>>;
}

/**
 * The narrow slices the navigator needs to resolve and open each target kind.
 * Resolution reuses the existing `findById` services (no new lookup for
 * PRD/UC/SM), typed down to the id/path it actually reads, plus the WS-B4
 * `findByRunId` run lookup for the Evidence↔Run hop; the open actions are the
 * composition root's existing leaf-opening flows (`openUseCaseDetail`,
 * `openStoryMapBoard`) and the workspace `openFile` for everything addressed by
 * a vault note path (PRD, Feature, Suite, Evidence, and the run's evidence note)
 * — so the navigator wires them together without re-implementing how a leaf or
 * note opens (the same altitude rule the other view callbacks follow).
 */
export interface ArtifactNavigatorDeps {
  prdService: NodeLookup;
  useCaseService: NodeLookup;
  storyMapService: NodeLookup;
  runHistory: RunLookup;
  /** Opens the Use Case detail view focused on `useCaseId` (composition root). */
  openUseCaseDetail: (useCaseId: string) => void;
  /** Opens the Story Map board focused on `storyMapId` (composition root). */
  openStoryMapBoard: (storyMapId: string) => void;
  /** Opens a vault note (PRD/Feature/Suite/Evidence have no dedicated id-keyed leaf). */
  openFile: (path: VaultPath) => Promise<Result<void>>;
}

/**
 * The concrete deep-link navigator (WS-A4/B4). Routes a {@link NavigationTarget}
 * to the right open flow: an `artifact` target is classified and resolved
 * through the matching `findById`; `feature`/`suite`/`evidence` targets open
 * their vault note by path; a `run` target resolves to the evidence note it
 * produced (via `findByRunId`) and opens that. A renamed/missing/unrecognized
 * target resolves to an `err` Result (no crash) — the same not-found tolerance
 * the UC-detail view has for a persisted-but-deleted id. The composition root
 * adapts the `err` to a Notice.
 */
export class ArtifactNavigator implements ArtifactNavigationPort {
  constructor(private readonly deps: ArtifactNavigatorDeps) {}

  navigate(target: NavigationTarget): Promise<Result<void>> {
    switch (target.kind) {
      case "artifact":
        return this.openArtifact(target.id);
      case "feature":
      case "suite":
      case "evidence":
        // All three are addressed by a vault note path: open the note (the same
        // affordance the explorers already use), now reachable through the one
        // unified port. The workspace surfaces a missing/renamed path itself.
        return this.deps.openFile(target.path);
      case "run":
        return this.openRun(target.runId);
    }
  }

  private async openArtifact(id: string): Promise<Result<void>> {
    const kind = classifyArtifactId(id);
    if (kind === null) return this.unresolved(id);
    return this.openByKind(kind, id.trim());
  }

  private openByKind(kind: ArtifactKind, id: string): Promise<Result<void>> {
    switch (kind) {
      case "prd":
        return this.openPrd(id);
      case "use-case":
        return this.openUseCase(id);
      case "story-map":
        return this.openStoryMap(id);
    }
  }

  private async openPrd(id: string): Promise<Result<void>> {
    const found = await this.deps.prdService.findById(id);
    if (!found.ok) return found;
    if (found.value === null) return this.unresolved(id);
    // A PRD has no dedicated detail view; open its note (the PRD explorer row's
    // existing affordance), now reachable by id from anywhere.
    return this.deps.openFile(found.value.path);
  }

  private async openUseCase(id: string): Promise<Result<void>> {
    const found = await this.deps.useCaseService.findById(id);
    if (!found.ok) return found;
    if (found.value === null) return this.unresolved(id);
    this.deps.openUseCaseDetail(found.value.id);
    return ok(undefined);
  }

  private async openStoryMap(id: string): Promise<Result<void>> {
    const found = await this.deps.storyMapService.findById(id);
    if (!found.ok) return found;
    if (found.value === null) return this.unresolved(id);
    this.deps.openStoryMapBoard(found.value.id);
    return ok(undefined);
  }

  /**
   * Opens "the run that produced this evidence" (WS-B4): resolves the run by id
   * (the run history has no other by-id lookup) and opens the evidence note the
   * run wrote. A missing/renamed run id falls through to the graceful not-found.
   */
  private async openRun(runId: string): Promise<Result<void>> {
    const found = await this.deps.runHistory.findByRunId(runId);
    if (!found.ok) return found;
    if (found.value === null) return this.unresolved(runId);
    return this.deps.openFile(found.value.evidencePath);
  }

  /** The graceful not-found / unrecognized-id failure (surfaced as a Notice). */
  private unresolved(id: string): Result<void> {
    return err(
      appError("VALIDATION_FAILED", `Could not open "${id}". It may have been renamed or deleted.`),
    );
  }
}
