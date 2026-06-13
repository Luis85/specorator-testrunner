import type { VaultPath } from "../value-objects/identifiers";

/** A PRD identifier, e.g. "PRD-001". The root product-vision PRD is "PRD-000". */
export type PrdId = string;

export const PRD_STATUSES = ["draft", "active", "deprecated"] as const;
export type PrdStatus = (typeof PRD_STATUSES)[number];

export const isPrdStatus = (value: unknown): value is PrdStatus =>
  typeof value === "string" && (PRD_STATUSES as readonly string[]).includes(value);

/**
 * Read model for a PRD note. A PRD is a synthesis artifact that defines solution
 * scope above Use Cases. The root PRD (PRD-000) has no parent (`parentPrdId` undefined).
 */
export interface Prd {
  id: PrdId;
  title: string;
  status: PrdStatus;
  /** Undefined for the root PRD; otherwise the parent PRD id. */
  parentPrdId?: PrdId;
  /** Research domains this PRD synthesizes from. Optional for the root PRD. */
  domains: string[];
  vision: string;
  scopeIn: string[];
  scopeOut: string[];
  /** Sibling ordering without mutating immutable ids. */
  displayOrder: number;
  /** Folder-relative note path: <prdsPath>/<folder>/<folder>.md */
  path: VaultPath;
}
