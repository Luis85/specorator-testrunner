// The built-in natural-language step vocabulary. Most scenarios need zero
// custom code. See DESIGN.md section 4 for the full catalog (navigation,
// interaction, waiting, assertions, the (api) state-setup family, data/context).
//
// TODO(phase-1): register handlers against the Driver and add the catalog.

import type { Driver, Target } from "../driver/driver";

export type StepHandler = (driver: Driver, args: string[]) => Promise<void>;

export interface StepDefinition {
  /** A Cucumber Expression, e.g. "the user clicks {target}". */
  expression: string;
  handler: StepHandler;
}

export const builtinSteps: StepDefinition[] = [
  // populated in Phase 1
];

/** Parse a quoted target string into a Target (prefix grammar + smart resolution). */
export function parseTarget(raw: string): Target {
  // TODO(phase-1): parse prefixes (role=, label=, css=, ...), "within", ordinals.
  return { raw };
}
