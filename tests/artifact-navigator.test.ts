import { describe, expect, it, vi } from "vitest";
import {
  ArtifactNavigator,
  type ArtifactNavigatorDeps,
} from "../src/presentation/navigation/artifact-navigator";
import {
  artifactTarget,
  evidenceTarget,
  featureTarget,
  runTarget,
  suiteTarget,
} from "../src/presentation/navigation/navigation-target";
import type { RunHistoryEntry } from "../src/application/services/run-history-service";
import type { VaultPath } from "../src/domain/value-objects/identifiers";
import { ok, type Result } from "../src/shared/result/result";

const path = (p: string): VaultPath => p as unknown as VaultPath;

const runEntry = (overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry => ({
  runId: "RUN-001",
  evidencePath: path("Test Evidence/2026/06/RUN-001/summary.md"),
  year: "2026",
  month: "06",
  ...overrides,
});

const makeDeps = (overrides: Partial<ArtifactNavigatorDeps> = {}): ArtifactNavigatorDeps => ({
  prdService: { findById: vi.fn(async () => ok(null)) },
  useCaseService: { findById: vi.fn(async () => ok(null)) },
  storyMapService: { findById: vi.fn(async () => ok(null)) },
  runHistory: { findByRunId: vi.fn(async () => ok(null)) },
  openUseCaseDetail: vi.fn(),
  openStoryMapBoard: vi.fn(),
  openFile: vi.fn(async (): Promise<Result<void>> => ok(undefined)),
  ...overrides,
});

describe("ArtifactNavigator.navigate — artifact targets", () => {
  it("opens a Use Case's detail view by id", async () => {
    const openUseCaseDetail = vi.fn();
    const deps = makeDeps({
      useCaseService: {
        findById: vi.fn(async () => ok({ id: "UC-021", title: "X", path: path("uc.md") })),
      },
      openUseCaseDetail,
    });
    const result = await new ArtifactNavigator(deps).navigate(artifactTarget("UC-021"));
    expect(result.ok).toBe(true);
    expect(openUseCaseDetail).toHaveBeenCalledWith("UC-021");
  });

  it("opens a Story Map's board by id", async () => {
    const openStoryMapBoard = vi.fn();
    const deps = makeDeps({
      storyMapService: {
        findById: vi.fn(async () => ok({ id: "SM-002", title: "M", path: path("sm.md") })),
      },
      openStoryMapBoard,
    });
    const result = await new ArtifactNavigator(deps).navigate(artifactTarget("SM-002"));
    expect(result.ok).toBe(true);
    expect(openStoryMapBoard).toHaveBeenCalledWith("SM-002");
  });

  it("opens a PRD's note by id", async () => {
    const openFile = vi.fn(async (): Promise<Result<void>> => ok(undefined));
    const deps = makeDeps({
      prdService: {
        findById: vi.fn(async () => ok({ id: "PRD-003", title: "P", path: path("prd.md") })),
      },
      openFile,
    });
    const result = await new ArtifactNavigator(deps).navigate(artifactTarget("PRD-003"));
    expect(result.ok).toBe(true);
    expect(openFile).toHaveBeenCalledWith(path("prd.md"));
  });

  it("trims a whitespace-padded id before resolving", async () => {
    const openUseCaseDetail = vi.fn();
    const deps = makeDeps({
      useCaseService: {
        findById: vi.fn(async () => ok({ id: "UC-021", title: "X", path: path("uc.md") })),
      },
      openUseCaseDetail,
    });
    await new ArtifactNavigator(deps).navigate(artifactTarget("  UC-021  "));
    expect(openUseCaseDetail).toHaveBeenCalledWith("UC-021");
  });

  it("fails gracefully (no crash, no open) for an unrecognized id", async () => {
    const findUseCase = vi.fn(async () => ok(null));
    const openUseCaseDetail = vi.fn();
    const deps = makeDeps({
      useCaseService: { findById: findUseCase },
      openUseCaseDetail,
    });
    const result = await new ArtifactNavigator(deps).navigate(artifactTarget("FOO-2026"));
    expect(result.ok).toBe(false);
    expect(findUseCase).not.toHaveBeenCalled();
    expect(openUseCaseDetail).not.toHaveBeenCalled();
  });

  it("fails gracefully for a recognized-but-missing id (renamed/deleted)", async () => {
    const deps = makeDeps();
    const result = await new ArtifactNavigator(deps).navigate(artifactTarget("UC-999"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("UC-999");
    expect(deps.openUseCaseDetail).not.toHaveBeenCalled();
  });

  it("propagates a lookup error result rather than throwing", async () => {
    const deps = makeDeps({
      prdService: {
        findById: vi.fn(async () => ({
          ok: false as const,
          error: { code: "INIT_FAILED" as const, message: "boom" },
        })),
      },
    });
    const result = await new ArtifactNavigator(deps).navigate(artifactTarget("PRD-003"));
    expect(result.ok).toBe(false);
  });
});

describe("ArtifactNavigator.navigate — path targets", () => {
  it("opens a Feature by its vault path", async () => {
    const openFile = vi.fn(async (): Promise<Result<void>> => ok(undefined));
    const deps = makeDeps({ openFile });
    const result = await new ArtifactNavigator(deps).navigate(
      featureTarget(path("Specs/UC-021-checkout.feature")),
    );
    expect(result.ok).toBe(true);
    expect(openFile).toHaveBeenCalledWith(path("Specs/UC-021-checkout.feature"));
  });

  it("opens a Suite by its vault path", async () => {
    const openFile = vi.fn(async (): Promise<Result<void>> => ok(undefined));
    const deps = makeDeps({ openFile });
    const result = await new ArtifactNavigator(deps).navigate(
      suiteTarget(path("Test Suites/Smoke.md")),
    );
    expect(result.ok).toBe(true);
    expect(openFile).toHaveBeenCalledWith(path("Test Suites/Smoke.md"));
  });

  it("opens an Evidence note by its vault path", async () => {
    const openFile = vi.fn(async (): Promise<Result<void>> => ok(undefined));
    const deps = makeDeps({ openFile });
    const result = await new ArtifactNavigator(deps).navigate(
      evidenceTarget(path("Test Evidence/2026/06/RUN-001/summary.md")),
    );
    expect(result.ok).toBe(true);
    expect(openFile).toHaveBeenCalledWith(path("Test Evidence/2026/06/RUN-001/summary.md"));
  });

  it("propagates the workspace failure when a note path is missing/renamed", async () => {
    const deps = makeDeps({
      openFile: vi.fn(async () => ({
        ok: false as const,
        error: { code: "RUNNER_MISSING_FILE" as const, message: "gone" },
      })),
    });
    const result = await new ArtifactNavigator(deps).navigate(
      featureTarget(path("Specs/gone.feature")),
    );
    expect(result.ok).toBe(false);
  });
});

describe("ArtifactNavigator.navigate — run target", () => {
  it("opens the evidence note the run produced", async () => {
    const openFile = vi.fn(async (): Promise<Result<void>> => ok(undefined));
    const deps = makeDeps({
      runHistory: { findByRunId: vi.fn(async () => ok(runEntry())) },
      openFile,
    });
    const result = await new ArtifactNavigator(deps).navigate(runTarget("RUN-001"));
    expect(result.ok).toBe(true);
    expect(openFile).toHaveBeenCalledWith(path("Test Evidence/2026/06/RUN-001/summary.md"));
  });

  it("fails gracefully for a missing/renamed run id", async () => {
    const openFile = vi.fn(async (): Promise<Result<void>> => ok(undefined));
    const deps = makeDeps({
      runHistory: { findByRunId: vi.fn(async () => ok(null)) },
      openFile,
    });
    const result = await new ArtifactNavigator(deps).navigate(runTarget("RUN-gone"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("RUN-gone");
    expect(openFile).not.toHaveBeenCalled();
  });

  it("propagates a run-lookup error result rather than throwing", async () => {
    const deps = makeDeps({
      runHistory: {
        findByRunId: vi.fn(async () => ({
          ok: false as const,
          error: { code: "EVIDENCE_LIST_FAILED" as const, message: "io" },
        })),
      },
    });
    const result = await new ArtifactNavigator(deps).navigate(runTarget("RUN-001"));
    expect(result.ok).toBe(false);
  });
});
