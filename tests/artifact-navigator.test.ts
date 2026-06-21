import { describe, expect, it, vi } from "vitest";
import {
  ArtifactNavigator,
  type ArtifactNavigatorDeps,
} from "../src/presentation/navigation/artifact-navigator";
import type { VaultPath } from "../src/domain/value-objects/identifiers";
import { ok, type Result } from "../src/shared/result/result";

const path = (p: string): VaultPath => p as unknown as VaultPath;

const makeDeps = (overrides: Partial<ArtifactNavigatorDeps> = {}): ArtifactNavigatorDeps => ({
  prdService: { findById: vi.fn(async () => ok(null)) },
  useCaseService: { findById: vi.fn(async () => ok(null)) },
  storyMapService: { findById: vi.fn(async () => ok(null)) },
  openUseCaseDetail: vi.fn(),
  openStoryMapBoard: vi.fn(),
  openFile: vi.fn(async (): Promise<Result<void>> => ok(undefined)),
  ...overrides,
});

describe("ArtifactNavigator.openArtifact", () => {
  it("opens a Use Case's detail view by id", async () => {
    const openUseCaseDetail = vi.fn();
    const deps = makeDeps({
      useCaseService: {
        findById: vi.fn(async () => ok({ id: "UC-021", title: "X", path: path("uc.md") })),
      },
      openUseCaseDetail,
    });
    const result = await new ArtifactNavigator(deps).openArtifact("UC-021");
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
    const result = await new ArtifactNavigator(deps).openArtifact("SM-002");
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
    const result = await new ArtifactNavigator(deps).openArtifact("PRD-003");
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
    await new ArtifactNavigator(deps).openArtifact("  UC-021  ");
    expect(openUseCaseDetail).toHaveBeenCalledWith("UC-021");
  });

  it("fails gracefully (no crash, no open) for an unrecognized id", async () => {
    const findUseCase = vi.fn(async () => ok(null));
    const openUseCaseDetail = vi.fn();
    const deps = makeDeps({
      useCaseService: { findById: findUseCase },
      openUseCaseDetail,
    });
    const result = await new ArtifactNavigator(deps).openArtifact("EV-2026");
    expect(result.ok).toBe(false);
    expect(findUseCase).not.toHaveBeenCalled();
    expect(openUseCaseDetail).not.toHaveBeenCalled();
  });

  it("fails gracefully for a recognized-but-missing id (renamed/deleted)", async () => {
    const deps = makeDeps();
    const result = await new ArtifactNavigator(deps).openArtifact("UC-999");
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
    const result = await new ArtifactNavigator(deps).openArtifact("PRD-003");
    expect(result.ok).toBe(false);
  });
});
