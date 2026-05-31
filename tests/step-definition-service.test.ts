import { describe, expect, it } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultStepDefinitionService } from "../src/application/services/step-definition-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

const STEPS_DIR = ".testrunner/src/steps";
const FEATURE = vp("Specifications/features/UC-001-demo.feature");
const STEP_FILE = `${STEPS_DIR}/UC-001-demo.steps.ts`;

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus, events, types } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const service = new DefaultStepDefinitionService(settings, fs, bus, silentLogger);
  return { service, fs, events, types };
};

describe("DefaultStepDefinitionService.generate", () => {
  it("writes a new steps file with one stub per undefined step", async () => {
    const { service, fs, events } = build();

    const result = await service.generate(FEATURE, [
      "I open the local example page",
      "I have not implemented this",
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stepFile).toBe(STEP_FILE);
    expect(result.value.appended).toBe(false);
    expect(result.value.generatedSteps).toEqual([
      "I open the local example page",
      "I have not implemented this",
    ]);

    const written = fs.files.get(STEP_FILE) ?? "";
    expect(written).toContain(`import { Given } from "@cucumber/cucumber";`);
    expect(written).toContain(`Given("I open the local example page"`);
    expect(written).toContain(`Given("I have not implemented this"`);

    const event = events.find((e) => e.type === "stepdefinition.generated");
    expect(event?.payload).toEqual({
      featurePath: FEATURE,
      stepFile: STEP_FILE,
      generatedSteps: ["I open the local example page", "I have not implemented this"],
    });
  });

  it("publishes stepdefinition.generated with causationId set to the detection event id", async () => {
    const { service, events } = build();

    await service.generate(FEATURE, ["a brand new step"], "detect-evt-123");

    const event = events.find((e) => e.type === "stepdefinition.generated");
    expect(event?.causationId).toBe("detect-evt-123");
  });

  it("omits causationId when no detection event id is supplied", async () => {
    const { service, events } = build();

    await service.generate(FEATURE, ["a brand new step"]);

    const event = events.find((e) => e.type === "stepdefinition.generated");
    expect(event?.causationId).toBeUndefined();
  });

  it("is non-destructive: skips steps already defined anywhere under src/steps", async () => {
    const { service, fs, events } = build();
    // A hand-edited steps file already implements one of the two steps.
    fs.files.set(
      `${STEPS_DIR}/existing.steps.ts`,
      `Given("I open the local example page", async function () {});`,
    );

    const result = await service.generate(FEATURE, [
      "I open the local example page",
      "I have not implemented this",
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the genuinely missing step is stubbed; the defined one is left alone.
    expect(result.value.generatedSteps).toEqual(["I have not implemented this"]);
    const written = fs.files.get(STEP_FILE) ?? "";
    expect(written).toContain(`Given("I have not implemented this"`);
    expect(written).not.toContain(`Given("I open the local example page"`);

    const event = events.find((e) => e.type === "stepdefinition.generated");
    expect((event?.payload as { generatedSteps: string[] }).generatedSteps).toEqual([
      "I have not implemented this",
    ]);
  });

  it("returns an empty result and writes nothing when every step is already defined", async () => {
    const { service, fs, types } = build();
    fs.files.set(
      `${STEPS_DIR}/existing.steps.ts`,
      `Given("a defined step", async function () {});`,
    );

    const result = await service.generate(FEATURE, ["a defined step"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.generatedSteps).toEqual([]);
    expect(result.value.appended).toBe(false);
    // No file written and no event published when there is nothing to stub.
    expect(fs.files.has(STEP_FILE)).toBe(false);
    expect(types()).not.toContain("stepdefinition.generated");
  });

  it("appends to (never overwrites) an existing hand-edited steps file for the feature", async () => {
    const { service, fs } = build();
    const handEdited = `import { Given } from "@cucumber/cucumber";\n\nGiven("a handwritten step", async function () {});\n`;
    fs.files.set(STEP_FILE, handEdited);

    const result = await service.generate(FEATURE, ["a fresh step"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.appended).toBe(true);
    const written = fs.files.get(STEP_FILE) ?? "";
    // The user's content is preserved and the new stub is appended below it.
    expect(written).toContain(`Given("a handwritten step"`);
    expect(written).toContain(`Given("a fresh step"`);
    expect(written.indexOf("a handwritten step")).toBeLessThan(written.indexOf("a fresh step"));
    // The import header is NOT re-emitted: a second `import { Given }` would be a
    // duplicate top-level binding and the module would fail to load (review).
    const givenImports = written.match(
      /import\s*\{[^}]*\bGiven\b[^}]*\}\s*from\s*["']@cucumber\/cucumber["']/g,
    );
    expect(givenImports).toHaveLength(1);
  });

  it("includes the import header when appending to a file that lacks it", async () => {
    const { service, fs } = build();
    // A steps file with no cucumber import (e.g. a stray fragment): the append
    // must add the header so the resulting module still loads.
    fs.files.set(STEP_FILE, `// notes, no imports here\n`);

    const result = await service.generate(FEATURE, ["a fresh step"]);

    expect(result.ok).toBe(true);
    const written = fs.files.get(STEP_FILE) ?? "";
    expect(written).toContain(`import { Given } from "@cucumber/cucumber";`);
    expect(written).toContain(`Given("a fresh step"`);
  });

  it("adds the Given import when the existing file only aliases it (review)", async () => {
    const { service, fs } = build();
    // The file imports Cucumber under an ALIAS, so there is no local `Given`
    // binding — the appended stubs call Given(...), so the import must be added.
    fs.files.set(
      STEP_FILE,
      `import { Given as defineStep } from "@cucumber/cucumber";\n\ndefineStep("aliased", async function () {});\n`,
    );

    const result = await service.generate(FEATURE, ["a fresh step"]);

    expect(result.ok).toBe(true);
    const written = fs.files.get(STEP_FILE) ?? "";
    // The real `Given` import is added (the alias binding is a different name, so
    // no duplicate declaration), and the user's aliased import is preserved.
    expect(written).toContain(`import { Given } from "@cucumber/cucumber";`);
    expect(written).toContain(`import { Given as defineStep }`);
    expect(written).toContain(`Given("a fresh step"`);
  });

  it("writes the stub file under .testrunner/src/steps via the VaultFileSystem port", async () => {
    const { service, fs } = build();

    await service.generate(FEATURE, ["some step"]);

    // The only file the service created lives at the runner steps path.
    expect([...fs.files.keys()]).toContain(STEP_FILE);
    expect(STEP_FILE.startsWith(".testrunner/src/steps/")).toBe(true);
  });
});
