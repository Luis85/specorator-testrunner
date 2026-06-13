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
