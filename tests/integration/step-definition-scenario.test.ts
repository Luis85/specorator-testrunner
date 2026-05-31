import { describe, expect, it } from "vitest";
import { DefaultSettingsService } from "../../src/application/services/settings-service";
import { DefaultSpecificationService } from "../../src/application/services/specification-service";
import { DefaultStepDefinitionService } from "../../src/application/services/step-definition-service";
import { DefaultUseCaseService } from "../../src/application/services/use-case-service";
import { DefaultPathSafetyPolicy } from "../../src/domain/policies/path-safety-policy";
import { unsafeVaultPath as vp } from "../../src/domain/value-objects/vault-path";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "../fakes";

/**
 * RV-4 / UC-010 — Generate Step Definition Stub (command path).
 *
 * Drives the SAME two-step sequence the "Generate Step Definitions" command in
 * `main.ts` runs — `SpecificationService.detectMissingSteps` then
 * `StepDefinitionService.generate(..., detectionEventId)` — over a real
 * `FakeVaultFileSystem`. Asserts the event order from the Event Catalog §5 /
 * RV-4 and that `stepdefinition.generated.causationId` chains to the originating
 * `specification.missingSteps.detected` event (Event Catalog §19), so the
 * command's causation wiring can't silently regress.
 */

const FEATURE = vp("Specifications/features/UC-001-demo.feature");
const STEP_FILE = ".testrunner/src/steps/UC-001-demo.steps.ts";

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus, events, types } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const useCases = new DefaultUseCaseService(settings, fs, bus, silentLogger);
  const specification = new DefaultSpecificationService(settings, useCases, fs, bus, silentLogger);
  const stepDefinitions = new DefaultStepDefinitionService(settings, fs, bus, silentLogger);
  return { specification, stepDefinitions, fs, events, types };
};

describe("UC-010 generate-step-definitions command path", () => {
  it("detects then stubs the undefined steps, chaining causationId", async () => {
    const { specification, stepDefinitions, fs, events, types } = build();
    fs.files.set(
      FEATURE,
      `Feature: Demo
  Scenario: S
    Given I open the local example page
    When I click the "Continue" button
    Then I have not implemented this
`,
    );
    // One of the three steps is already defined by hand.
    fs.files.set(
      ".testrunner/src/steps/example.steps.ts",
      `When("I click the {string} button", async () => {});`,
    );

    // Step 1 — detection (as the command does first).
    const detected = await specification.detectMissingSteps(FEATURE);
    expect(detected.ok).toBe(true);
    if (!detected.ok) return;
    expect(detected.value.missingSteps).toEqual([
      "I open the local example page",
      "I have not implemented this",
    ]);

    // Step 2 — generation, threading the detection event id as causationId.
    const generated = await stepDefinitions.generate(
      FEATURE,
      detected.value.missingSteps,
      detected.value.detectionEventId,
    );
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    expect(generated.value.stepFile).toBe(STEP_FILE);
    expect(generated.value.generatedSteps).toEqual([
      "I open the local example page",
      "I have not implemented this",
    ]);

    // The two RV-4 events fire in order…
    expect(types()).toEqual(["specification.missingSteps.detected", "stepdefinition.generated"]);
    // …and the result event is causally linked to the detection (Catalog §5/§19).
    const detectionEvent = events.find((e) => e.type === "specification.missingSteps.detected");
    const generatedEvent = events.find((e) => e.type === "stepdefinition.generated");
    expect(generatedEvent?.causationId).toBe(detectionEvent?.id);

    // The stub file lands at the runner steps path and is pending.
    expect(fs.files.get(STEP_FILE)).toContain(`throw new Error("Pending");`);
  });

  it("re-running the command is non-destructive once stubs are implemented", async () => {
    const { specification, stepDefinitions, fs, types } = build();
    fs.files.set(FEATURE, "Feature: Demo\n  Scenario: S\n    Given a step to define\n");

    const first = await specification.detectMissingSteps(FEATURE);
    expect(first.ok && first.value.missingSteps).toEqual(["a step to define"]);
    if (!first.ok) return;
    await stepDefinitions.generate(FEATURE, first.value.missingSteps, first.value.detectionEventId);

    // The generated stub now satisfies the step, so a second pass finds nothing.
    const second = await specification.detectMissingSteps(FEATURE);
    expect(second.ok && second.value.missingSteps).toEqual([]);
    if (!second.ok) return;
    const regen = await stepDefinitions.generate(
      FEATURE,
      second.value.missingSteps,
      second.value.detectionEventId,
    );
    expect(regen.ok && regen.value.generatedSteps).toEqual([]);

    // Only one stepdefinition.generated across both passes — no duplicate stubs.
    expect(types().filter((t) => t === "stepdefinition.generated")).toHaveLength(1);
  });
});
