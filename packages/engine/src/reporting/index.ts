// Writes run results to the canonical NDJSON history sidecar and the managed
// frontmatter rollup, and renders the markdown report note.
// See DESIGN.md section 5.
//
// TODO(phase-2): NDJSON history, flakiness scoring, regression detection,
// report-note rendering.

import type { RunResult } from "../types";

export function renderReportNote(_result: RunResult): string {
  throw new Error("renderReportNote: not implemented yet (Phase 2)");
}
