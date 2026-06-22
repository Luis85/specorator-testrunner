import { describe, expect, it, vi } from "vitest";
import type { TourActionId } from "../src/domain/onboarding/tour-steps";
import { dispatchTourAction, type TourActionFlows } from "../src/presentation/views/tour-actions";

/**
 * The shared action-id → flow router (used by BOTH the sidebar GuidedTourView and
 * the hub onboarding rail). Each id must fire exactly its one flow — a regression
 * here mis-wires a tour action on every surface at once, so it is asserted
 * directly (the DOM that calls it lives in the coverage-exempt `*-body.ts`).
 */
type SpyFlows = { [K in keyof TourActionFlows]: TourActionFlows[K] & ReturnType<typeof vi.fn> };

const spyFlows = (): SpyFlows => ({
  runDemo: vi.fn<() => void>(),
  openCreateUseCase: vi.fn<() => void>(),
  openUseCases: vi.fn<() => void>(),
  openCreateSuite: vi.fn<() => void>(),
  openSuites: vi.fn<() => void>(),
  openLatestEvidence: vi.fn<() => void>(),
  generateCiWorkflow: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
});

const ROUTING: Record<TourActionId, keyof TourActionFlows> = {
  "run-demo": "runDemo",
  "open-create-use-case": "openCreateUseCase",
  "open-use-cases": "openUseCases",
  "open-create-suite": "openCreateSuite",
  "open-suites": "openSuites",
  "open-latest-evidence": "openLatestEvidence",
  "generate-ci": "generateCiWorkflow",
};

describe("dispatchTourAction", () => {
  for (const [id, flow] of Object.entries(ROUTING) as [TourActionId, keyof TourActionFlows][]) {
    it(`routes "${id}" to ${flow} only`, () => {
      const flows = spyFlows();
      dispatchTourAction(id, flows);
      expect(flows[flow]).toHaveBeenCalledTimes(1);
      for (const other of Object.values(ROUTING)) {
        if (other !== flow) expect(flows[other]).not.toHaveBeenCalled();
      }
    });
  }
});
