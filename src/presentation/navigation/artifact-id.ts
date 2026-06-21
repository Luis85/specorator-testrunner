/**
 * Pure artifact-id classification for the `openArtifact(id)` deep-link port
 * (01-§3.2, WS-A4). The artifact graph (PRD ↔ Use Case ↔ Story Map ↔ …) keys
 * every node by an immutable, prefixed id (`PRD-NNN` / `UC-NNN` / `SM-NNN`).
 * `classifyArtifactId` maps a raw id to the kind of node it names so the
 * navigator can route to the right view via the matching `findById`. Returns
 * `null` for an unrecognized prefix so a renamed/garbage id falls through to a
 * graceful not-found path rather than guessing a target (mirrors the UC-detail
 * not-found branch).
 */

/** The kinds of artifact the deep-link port can resolve and open. */
export type ArtifactKind = "prd" | "use-case" | "story-map";

/**
 * The prefix → kind table. `UC-` is a Use Case, `PRD-` a PRD, `SM-` a Story
 * Map. `PRD-` is checked before nothing shadows it — the prefixes are disjoint,
 * so order is irrelevant — but a Story-Map-Card id (`SMC-NNN`) must NOT match
 * `SM-`, so the table matches the full prefix including its trailing hyphen.
 */
const PREFIXES: readonly (readonly [string, ArtifactKind])[] = [
  ["PRD-", "prd"],
  ["UC-", "use-case"],
  ["SM-", "story-map"],
];

/**
 * Classifies a raw artifact id into the node kind it names, or `null` when no
 * known prefix matches (a renamed/missing/foreign id). Pure: no I/O. Trims
 * surrounding whitespace so an id lifted from rendered text still resolves.
 */
export const classifyArtifactId = (id: string): ArtifactKind | null => {
  const trimmed = id.trim();
  for (const [prefix, kind] of PREFIXES) {
    if (trimmed.startsWith(prefix) && trimmed.length > prefix.length) return kind;
  }
  return null;
};
