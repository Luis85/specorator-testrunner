import type { Prd } from "../../domain/entities/prd";

/**
 * Pure state machine capturing the 7-step PRD builder wizard state.
 * Steps: 1=domains, 2=research, 3=vision, 4=scope, 5=success, 6=assign-UCs, 7=review
 */
export interface PrdBuilderState {
  /** Current step (1-7) */
  currentStep: number;
  /** PRD title */
  title: string;
  /** Optional parent PRD ID for sub-PRDs */
  parentPrdId?: string;
  /** Selected domains from listDomains() */
  selectedDomains: string[];
  /** Research findings (free text, optional) */
  research: string;
  /** PRD vision statement (required) */
  vision: string;
  /** Items in scope */
  scopeIn: string[];
  /** Items out of scope */
  scopeOut: string[];
  /** Selected use case IDs to assign to this PRD */
  selectedUcs: string[];
  /** Field-level error messages (keyed by field name) */
  errorMessages: Record<string, string>;
}

/**
 * Helper to get the title/label for a given PRD builder step.
 */
export function prdBuilderStepTitle(step: number): string {
  switch (step) {
    case 1:
      return "Domains";
    case 2:
      return "Research";
    case 3:
      return "Vision";
    case 4:
      return "Scope";
    case 5:
      return "Success Metrics";
    case 6:
      return "Assign Use Cases";
    case 7:
      return "Review";
    default:
      return "Unknown Step";
  }
}

/**
 * Resolves the parent for a new PRD, shared by the builder UI and
 * {@link DefaultPrdService.create} so both agree on the single-root invariant
 * (ADR-0026). An explicit parent (e.g. the Explorer's "＋ sub-PRD" action) always
 * wins. Otherwise, when PRDs already exist the new PRD defaults to a child of the
 * root (PRD-000 if present, else the first parentless PRD) so it can never be
 * accidentally created as a second root; with no PRDs yet it stays parentless and
 * becomes the root product vision. Pure: no I/O.
 */
export const resolveParentPrdId = (
  explicit: string | undefined,
  prds: Prd[],
): string | undefined => {
  if (explicit !== undefined) return explicit;
  if (prds.length === 0) return undefined;
  return (
    prds.find((p) => p.id === "PRD-000")?.id ??
    prds.find((p) => p.parentPrdId === undefined)?.id ??
    prds[0]?.id
  );
};

/**
 * Adds a user-entered domain to the available options (deduped, sorted) and marks
 * it selected. This keeps the Domains step usable in a PRD-first vault — or for a
 * brand-new domain — where the option list derived from existing Use Cases would
 * otherwise be empty and block the required selection. A blank value is a no-op.
 * Pure: no I/O.
 */
export const addDomainOption = (
  available: string[],
  selected: string[],
  raw: string,
): { available: string[]; selected: string[] } => {
  const value = raw.trim();
  if (value === "") return { available, selected };
  const nextAvailable = available.includes(value)
    ? available
    : [...available, value].sort((a, b) => a.localeCompare(b));
  const nextSelected = selected.includes(value) ? selected : [...selected, value];
  return { available: nextAvailable, selected: nextSelected };
};
