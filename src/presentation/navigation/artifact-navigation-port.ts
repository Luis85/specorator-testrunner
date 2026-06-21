import type { Result } from "../../shared/result/result";
import type { NavigationTarget } from "./navigation-target";

/**
 * The deep-link navigation port (WS-A4/B4, 01-§3.2). One `navigate(target)`
 * entry point every node links through, so the artifact graph
 * (PRD ↔ Use Case ↔ Feature ↔ Suite ↔ Run ↔ Evidence ↔ Story Map) becomes
 * navigable instead of relying on ad-hoc `openView`/`openOrNotice` calls that
 * carry no shared target.
 *
 * The target is a **discriminated union** (`NavigationTarget`), NOT an id-only
 * signature (Codex catch): only PRD/UC/SM are id-resolvable via `findById`;
 * Feature/Suite/Evidence are addressed by their vault path and a Run by its id
 * (resolved to the evidence note it produced). The implementation routes each
 * kind to the right open flow.
 *
 * Thin presentation depends on THIS interface, not the composition root, so a
 * view never re-implements the resolution/open flow (the same altitude rule the
 * other view callbacks follow). The composition root owns the concrete
 * navigator that knows how leaves/notes open.
 */
export interface ArtifactNavigationPort {
  /**
   * Opens the view/note for `target`. A renamed/missing/unrecognized target
   * resolves to a graceful failure (an `err` Result, surfaced as a Notice by the
   * caller) rather than crashing — the same not-found tolerance the UC-detail
   * view already has for a persisted-but-deleted id.
   */
  navigate(target: NavigationTarget): Promise<Result<void>>;
}
