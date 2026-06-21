/**
 * Pure selection of a PRD's Use Cases for the PRD-explorer deep-link
 * (01-§3.2, WS-A4): the PRD explorer row gains an affordance to jump into the
 * PRD's Use Cases. The view holds the flat `findAll()` list; this projection
 * picks the ones linked to a PRD (by `prd-id`, the single-parent tree, ADR-0026)
 * in a stable, id-sorted order, so the row can open the first/only one through
 * the `openArtifact` port. Pure (no I/O), so it is unit-tested.
 */

/** The minimal Use Case shape this projection needs — its id and PRD link. */
export interface UseCaseOfPrdInput {
  id: string;
  prdId?: string;
}

/**
 * The ids of the Use Cases linked to `prdId`, sorted by id (immutable, so the
 * order is stable across renders). Empty when none link to the PRD.
 */
export const useCaseIdsOfPrd = (useCases: readonly UseCaseOfPrdInput[], prdId: string): string[] =>
  useCases
    .filter((uc) => uc.prdId === prdId)
    .map((uc) => uc.id)
    .sort((a, b) => a.localeCompare(b));

/**
 * The id of the FIRST Use Case linked to `prdId` (the deep-link target for the
 * explorer row's "open its Use Cases" affordance), or `null` when the PRD has
 * none.
 */
export const firstUseCaseIdOfPrd = (
  useCases: readonly UseCaseOfPrdInput[],
  prdId: string,
): string | null => useCaseIdsOfPrd(useCases, prdId)[0] ?? null;
