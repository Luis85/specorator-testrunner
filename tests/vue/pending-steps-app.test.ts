// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import PendingStepsApp from "../../src/presentation/vue/pending-steps/PendingStepsApp.vue";
import {
  PENDING_STEPS_DEPS,
  PENDING_STEPS_TARGET,
  type PendingStepsDeps,
} from "../../src/presentation/vue/pending-steps/pending-steps-deps";
import type { PendingStepsTarget } from "../../src/presentation/views/pending-steps-rows";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import { createEvent } from "../../src/shared/event-bus/create-event";
import { ok, err } from "../../src/shared/result/result";
import { appError } from "../../src/shared/errors/errors";
import type { VaultPath } from "../../src/domain/value-objects/identifiers";

// Brand a plain string as a VaultPath for the fakes — the services return
// branded paths, and tests may use `as` (the use-case-detail-app.test idiom).
const vp = (path: string): VaultPath => path as VaultPath;

const FEATURE = `Feature: Demo\n\nScenario: One\n  Given I do a thing\n`;

const makeDeps = (overrides: Partial<PendingStepsDeps> = {}): PendingStepsDeps => ({
  specificationService: {
    listFeatures: async () =>
      ok([{ path: vp("features/UC-001-a.feature"), label: "UC-001-a.feature" }]),
    listStepPatterns: async () => [],
    detectMissingSteps: async (path) =>
      ok({ featurePath: path, missingSteps: [], detectionEventId: "e1" }),
  },
  stepDefinitionService: {
    generate: async () =>
      ok({ generatedSteps: [], stepFile: vp("steps.ts"), appended: false, insertions: [] }),
  },
  useCaseService: { findById: async () => err(appError("VALIDATION_FAILED", "none")) },
  fs: { readFile: async () => ok(FEATURE) },
  workspace: { openInSystemEditor: async () => ok(undefined) },
  eventBus: new InMemoryEventBus(),
  ...overrides,
});

const mountApp = (target: PendingStepsTarget, deps: PendingStepsDeps) =>
  mount(PendingStepsApp, {
    global: {
      provide: {
        [PENDING_STEPS_DEPS as symbol]: deps,
        [PENDING_STEPS_TARGET as symbol]: ref(target),
      },
    },
  });

describe("PendingStepsApp", () => {
  it("lists statically-incomplete features for the vault target without spawning", async () => {
    const detectCalls: string[] = [];
    let patternLoads = 0;
    const deps = makeDeps({
      specificationService: {
        listFeatures: async () =>
          ok([
            { path: vp("features/UC-001-a.feature"), label: "UC-001-a.feature" },
            { path: vp("features/UC-002-b.feature"), label: "UC-002-b.feature" },
          ]),
        listStepPatterns: async () => {
          patternLoads += 1;
          return [];
        },
        detectMissingSteps: async (path) => {
          detectCalls.push(path);
          return ok({ featurePath: path, missingSteps: [], detectionEventId: "e1" });
        },
      },
    });
    const w = mountApp({ kind: "vault" }, deps);
    await flushPromises();
    expect(w.text()).toContain("UC-001-a.feature");
    expect(w.text()).toContain("0 of 1 steps defined");
    // Vault target never runs bddgen (spec D8)…
    expect(detectCalls).toHaveLength(0);
    // …and the step-definition scan runs ONCE per render, not once per Feature
    // (Codex P2 on PR #102).
    expect(patternLoads).toBe(1);
  });

  it("auto-verifies a feature-targeted open (one bddgen run) and flips to verified", async () => {
    const detectCalls: string[] = [];
    const deps = makeDeps({
      specificationService: {
        listFeatures: async () => ok([]),
        listStepPatterns: async () => [],
        detectMissingSteps: async (path) => {
          detectCalls.push(path);
          return ok({ featurePath: path, missingSteps: [], detectionEventId: "e1" });
        },
      },
    });
    const w = mountApp({ kind: "feature", featurePath: vp("features/UC-001-a.feature") }, deps);
    await flushPromises();
    expect(detectCalls).toEqual(["features/UC-001-a.feature"]);
    expect(w.text()).toContain("verified");
    expect(w.text()).toContain("Every step has a definition.");
  });

  it("generate survives its own stepdefinition.generated event and shows the viewer", async () => {
    const detectCalls: string[] = [];
    const stubFile = `import { createBdd } from "playwright-bdd";\nconst { Given, When, Then } = createBdd();\n\n// stub\nGiven("I do a thing", async ({ page }) => {\n  throw new Error("Pending");\n});\n`;
    // A SHARED bus the generate fake publishes on, exactly like the real
    // service — InMemoryEventBus.publish awaits the panel's own subscription,
    // so without the actionDepth swallow this bumps `generation` mid-action
    // and the success path/viewer never renders (Codex P1 on PR #102). This
    // test FAILS against the unguarded implementation.
    const bus = new InMemoryEventBus();
    const deps = makeDeps({
      eventBus: bus,
      specificationService: {
        listFeatures: async () => ok([]),
        listStepPatterns: async () => [],
        detectMissingSteps: async (path) => {
          detectCalls.push(path);
          // Detect #1 is the feature-open AUTO-verify and #2 the Generate's own
          // detect — both must report the step still MISSING so the group stays
          // incomplete and the mod-cta Generate button is ENABLED for the click
          // (the card disables Generate once `missing` is empty). #3 is the
          // post-generate re-detect: now covered, so the group flips complete.
          return ok({
            featurePath: path,
            missingSteps: detectCalls.length <= 2 ? ["I do a thing"] : [],
            detectionEventId: "e1",
          });
        },
      },
      stepDefinitionService: {
        generate: async () => {
          await bus.publish(
            createEvent("stepdefinition.generated", {
              featurePath: "features/UC-001-a.feature",
              stepFile: "steps/UC-001-a.steps.ts",
              generatedSteps: ["I do a thing"],
            }),
          );
          return ok({
            generatedSteps: ["I do a thing"],
            stepFile: vp("steps/UC-001-a.steps.ts"),
            appended: false,
            insertions: [{ step: "I do a thing", startLine: 4, endLine: 7 }],
          });
        },
      },
      fs: {
        readFile: async (path: string) => ok(path.endsWith(".steps.ts") ? stubFile : FEATURE),
      },
    });
    const w = mountApp({ kind: "feature", featurePath: vp("features/UC-001-a.feature") }, deps);
    await flushPromises(); // initial load + auto-verify (detect #1)
    await w.find(".spec-pending-feature-actions button.mod-cta").trigger("click"); // Generate (detect #2, re-detect #3)
    await flushPromises();
    expect(detectCalls).toHaveLength(3);
    expect(w.text()).toContain("Generated 1 step stub in steps/UC-001-a.steps.ts.");
    const inserted = w.findAll(".spec-pending-stub-line.is-inserted");
    expect(inserted).toHaveLength(4); // lines 4-7
  });
});
