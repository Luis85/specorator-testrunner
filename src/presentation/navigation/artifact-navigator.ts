import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";
import { type ArtifactKind, classifyArtifactId } from "./artifact-id";
import type { ArtifactNavigationPort } from "./artifact-navigation-port";

/** The minimal node a `findById` must yield for the navigator — an id and a note path. */
interface ResolvedNode {
  id: string;
  path: VaultPath;
}

/** A by-id lookup over the graph (structurally satisfied by every `*Service.findById`). */
interface NodeLookup {
  findById(id: string): Promise<Result<ResolvedNode | null>>;
}

/**
 * The narrow slices the navigator needs to resolve and open each artifact kind.
 * Resolution reuses the existing `findById` services (no new lookup), typed down
 * to the id/path it actually reads; the open actions are the composition root's
 * existing leaf-opening flows (`openUseCaseDetail`, `openStoryMapBoard`) and the
 * workspace `openFile` for a PRD note — so the navigator wires them together
 * without re-implementing how a leaf opens (the same altitude rule the other
 * view callbacks follow).
 */
export interface ArtifactNavigatorDeps {
  prdService: NodeLookup;
  useCaseService: NodeLookup;
  storyMapService: NodeLookup;
  /** Opens the Use Case detail view focused on `useCaseId` (composition root). */
  openUseCaseDetail: (useCaseId: string) => void;
  /** Opens the Story Map board focused on `storyMapId` (composition root). */
  openStoryMapBoard: (storyMapId: string) => void;
  /** Opens a vault note (a PRD has no dedicated detail view; open its note). */
  openFile: (path: VaultPath) => Promise<Result<void>>;
}

/**
 * The concrete `openArtifact(id)` deep-link navigator (WS-A4). Classifies the
 * id, resolves the node through the matching `findById`, and opens the right
 * view focused on it. A renamed/missing/unrecognized id resolves to an `err`
 * Result (no crash) — the same not-found tolerance the UC-detail view has for a
 * persisted-but-deleted id. The composition root adapts the `err` to a Notice.
 */
export class ArtifactNavigator implements ArtifactNavigationPort {
  constructor(private readonly deps: ArtifactNavigatorDeps) {}

  async openArtifact(id: string): Promise<Result<void>> {
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

  /** The graceful not-found / unrecognized-id failure (surfaced as a Notice). */
  private unresolved(id: string): Result<void> {
    return err(
      appError("VALIDATION_FAILED", `Could not open "${id}". It may have been renamed or deleted.`),
    );
  }
}
