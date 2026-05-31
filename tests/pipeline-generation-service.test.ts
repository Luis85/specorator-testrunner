import { describe, expect, it } from "vitest";
import { DefaultPipelineGenerationService } from "../src/application/services/pipeline-generation-service";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import { FakeAbsoluteFileSystem, recordingEventBus } from "./fakes";

const build = () => {
  const absoluteFs = new FakeAbsoluteFileSystem();
  const { bus, events, types } = recordingEventBus();
  const service = new DefaultPipelineGenerationService(absoluteFs, bus);
  return { service, absoluteFs, events, types };
};

const workflowAbs = `/vault/${DEFAULT_SETTINGS.ci.workflowPath}`;

describe("DefaultPipelineGenerationService", () => {
  it("writes a GitHub Actions workflow with the BASE_URL variable (US-040, UC-019, ADR-0011)", async () => {
    const { service, absoluteFs, types } = build();

    const result = await service.generate({
      provider: "github-actions",
      settings: DEFAULT_SETTINGS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provider).toBe("github-actions");
    expect(result.value.path).toBe(DEFAULT_SETTINGS.ci.workflowPath);

    const written = absoluteFs.written.get(workflowAbs);
    expect(written).toBeDefined();
    expect(written).toContain("BASE_URL: ${{ vars.E2E_BASE_URL }}");
    expect(written).toContain("npm run test:ci");
    expect(types()).toContain("ci.pipeline.generated");
  });

  it("emits ci.pipeline.generated with the { provider, path } payload", async () => {
    const { service, events } = build();
    await service.generate({ provider: "github-actions", settings: DEFAULT_SETTINGS });
    const event = events.find((e) => e.type === "ci.pipeline.generated");
    expect(event?.payload).toEqual({
      provider: "github-actions",
      path: DEFAULT_SETTINGS.ci.workflowPath,
    });
  });

  it("refuses to clobber an existing workflow unless overwrite is enabled (OQ-005)", async () => {
    const { service, absoluteFs, types } = build();
    absoluteFs.existing.add(workflowAbs);

    const result = await service.generate({
      provider: "github-actions",
      settings: DEFAULT_SETTINGS,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
    // Nothing was written and no event was emitted.
    expect(absoluteFs.written.has(workflowAbs)).toBe(false);
    expect(types()).not.toContain("ci.pipeline.generated");
  });

  it("overwrites an existing workflow when explicitly requested", async () => {
    const { service, absoluteFs } = build();
    absoluteFs.seed(workflowAbs, "stale content");

    const result = await service.generate({
      provider: "github-actions",
      settings: DEFAULT_SETTINGS,
      overwriteExisting: true,
    });

    expect(result.ok).toBe(true);
    expect(absoluteFs.written.get(workflowAbs)).toContain("name: E2E Tests");
  });

  it("does not generate output for non-github providers in V1 (TIS §5.7)", async () => {
    const { service, types } = build();

    for (const provider of ["azure-devops", "none"] as const) {
      const result = await service.generate({ provider, settings: DEFAULT_SETTINGS });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    }
    expect(types()).not.toContain("ci.pipeline.generated");
  });
});
