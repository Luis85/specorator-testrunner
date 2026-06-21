import type { Result } from "../../shared/result/result";

/**
 * The deep-link navigation port (WS-A4, 01-§3.2). One `openArtifact(id)` entry
 * point every node links through, so the artifact graph
 * (PRD ↔ Use Case ↔ Story Map ↔ …) becomes navigable instead of relying on
 * ad-hoc `openView` calls that carry no target id. Given an artifact id
 * (`PRD-NNN` / `UC-NNN` / `SM-NNN`) the implementation resolves it through the
 * existing services and opens the right view focused on that item.
 *
 * Thin presentation depends on THIS interface, not the composition root, so a
 * view never re-implements the resolution/open flow (the same altitude rule the
 * other view callbacks follow). The composition root owns the concrete
 * navigator that knows how leaves open.
 */
export interface ArtifactNavigationPort {
  /**
   * Opens the view focused on the artifact named by `id`. A renamed/missing/
   * unrecognized id resolves to a graceful failure (an `err` Result, surfaced as
   * a Notice by the caller) rather than crashing — the same not-found tolerance
   * the UC-detail view already has for a persisted-but-deleted id.
   */
  openArtifact(id: string): Promise<Result<void>>;
}
