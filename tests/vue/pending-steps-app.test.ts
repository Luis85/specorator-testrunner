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
import type { UseCase } from "../../src/domain/entities/use-case";

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
          // pre-detect — both report the step MISSING so the group stays
          // incomplete and the mod-cta Generate button is ENABLED for the click
          // (the card disables Generate once `missing` is empty). There is NO
          // third, post-generate re-detect (tour-safe, Codex P2 on PR #102) —
          // generate re-projects from the static tier instead.
          return ok({
            featurePath: path,
            missingSteps: ["I do a thing"],
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
    await w.find(".spec-pending-feature-actions button.mod-cta").trigger("click"); // Generate (detect #2, NO post-generate re-detect)
    await flushPromises();
    // Exactly TWO detects: the open auto-verify and the Generate pre-detect. A
    // third, post-generate re-detect would zero-miss on the pending stubs and
    // prematurely complete the Guided Tour's implement-steps step (Codex P2).
    expect(detectCalls).toHaveLength(2);
    expect(w.text()).toContain("Generated 1 step stub in steps/UC-001-a.steps.ts.");
    const inserted = w.findAll(".spec-pending-stub-line.is-inserted");
    expect(inserted).toHaveLength(4); // lines 4-7
  });

  it("surfaces a vault listing failure as an error — NOT the 'everything defined' empty state (Codex P2 on PR #102)", async () => {
    const deps = makeDeps({
      specificationService: {
        listFeatures: async () => err(appError("RUNNER_MISSING_FILE", "bad featureFilesPath")),
        listStepPatterns: async () => [],
        detectMissingSteps: async (path) =>
          ok({ featurePath: path, missingSteps: [], detectionEventId: "e1" }),
      },
    });
    const w = mountApp({ kind: "vault" }, deps);
    await flushPromises();

    // A listing/config/I-O failure must not be hidden as "coverage complete".
    expect(w.text()).toContain("Couldn't load Pending Steps");
    expect(w.text()).toContain("bad featureFilesPath");
    expect(w.text()).not.toContain("No Features with pending steps");
  });

  it("surfaces a failed Use-Case load as an error (Codex P2 on PR #102)", async () => {
    const deps = makeDeps({
      useCaseService: {
        findById: async () => err(appError("VALIDATION_FAILED", "uc load failed")),
      },
    });
    const w = mountApp({ kind: "use-case", useCaseId: "UC-001" }, deps);
    await flushPromises();

    expect(w.text()).toContain("Couldn't load Pending Steps");
    expect(w.text()).toContain("uc load failed");
  });

  it("re-resolves when the targeted Use Case is deleted (Codex P2 on PR #102 — inputs come from settings/use-case, not just specs)", async () => {
    const bus = new InMemoryEventBus();
    let listCalls = 0;
    const deps = makeDeps({
      eventBus: bus,
      specificationService: {
        listFeatures: async () => {
          listCalls += 1;
          return ok([]);
        },
        listStepPatterns: async () => [],
        detectMissingSteps: async (path) =>
          ok({ featurePath: path, missingSteps: [], detectionEventId: "e1" }),
      },
    });
    const w = mountApp({ kind: "vault" }, deps);
    await flushPromises();
    expect(listCalls).toBe(1); // initial load

    // usecase.deleted is now in the refresh set — the panel must re-resolve
    // rather than keep rows/coverage from the old inputs.
    await bus.publish(
      createEvent("usecase.deleted", { useCaseId: "UC-001", path: "UseCases/UC-001.md" }),
    );
    await flushPromises();
    expect(listCalls).toBe(2);
    expect(w).toBeTruthy();
  });

  it("a no-op Generate (bddgen resolves a step the static matcher flags) stays on the bddgen tier — the card flips covered, not back to pending (Codex P2 on PR #102)", async () => {
    const deps = makeDeps({
      specificationService: {
        // Static sees NO patterns → it flags the feature's step as pending, so
        // the vault listing shows it and Generate is enabled.
        listFeatures: async () =>
          ok([{ path: vp("features/UC-001-a.feature"), label: "UC-001-a.feature" }]),
        listStepPatterns: async () => [],
        // bddgen, however, RESOLVES the step (a custom param type / optional
        // syntax the static matcher can't model) → zero missing.
        detectMissingSteps: async (path) =>
          ok({ featurePath: path, missingSteps: [], detectionEventId: "e1" }),
      },
      stepDefinitionService: {
        // Nothing to generate — bddgen already resolved everything.
        generate: async () =>
          ok({ generatedSteps: [], stepFile: vp("steps.ts"), appended: false, insertions: [] }),
      },
    });
    const w = mountApp({ kind: "vault" }, deps);
    await flushPromises();
    // Static flagged it pending → Generate enabled.
    expect(w.find("button.mod-cta").attributes("disabled")).toBeUndefined();

    await w.find("button.mod-cta").trigger("click"); // Generate → no-op
    await flushPromises();

    // The card flips to the bddgen "covered" verdict (empty missing), NOT back
    // to the static tier — which would re-flag the step pending and re-enable
    // Generate right after saying there was nothing to generate.
    expect(w.text()).toContain("Every step has a definition.");
    expect(w.text()).toContain("nothing to generate");
    expect(w.find("button.mod-cta").attributes("disabled")).toBeDefined();
  });

  it("surfaces a Feature read failure for a feature-targeted panel as an error — not the empty 'everything defined' state (Codex P2 on PR #102)", async () => {
    const deps = makeDeps({
      fs: { readFile: async () => err(appError("RUNNER_MISSING_FILE", "feature deleted")) },
    });
    const w = mountApp({ kind: "feature", featurePath: vp("features/UC-001-gone.feature") }, deps);
    await flushPromises();

    expect(w.text()).toContain("Couldn't load");
    expect(w.text()).toContain("UC-001-gone");
    expect(w.text()).not.toContain("No Features with pending steps");
  });

  it("refreshes SIBLING groups after a generate defines a shared step (vault target, Codex P2 on PR #102)", async () => {
    let defined = false;
    const deps = makeDeps({
      specificationService: {
        listFeatures: async () =>
          ok([
            { path: vp("features/UC-001-a.feature"), label: "UC-001-a.feature" },
            { path: vp("features/UC-002-b.feature"), label: "UC-002-b.feature" },
          ]),
        // Both Features share the step "I do a thing"; generating for A defines
        // it for BOTH (the pattern appears once the write lands).
        listStepPatterns: async () =>
          defined ? [{ kind: "expression" as const, source: "I do a thing" }] : [],
        detectMissingSteps: async (path) =>
          ok({ featurePath: path, missingSteps: ["I do a thing"], detectionEventId: "e1" }),
      },
      stepDefinitionService: {
        generate: async () => {
          defined = true; // the write defines the shared step
          return ok({
            generatedSteps: ["I do a thing"],
            stepFile: vp("steps.ts"),
            appended: false,
            insertions: [],
          });
        },
      },
    });
    const w = mountApp({ kind: "vault" }, deps);
    await flushPromises();
    expect(w.findAll(".spec-pending-feature")).toHaveLength(2);
    expect(w.text()).toContain("0 of 1 steps defined");

    await w.findAll("button.mod-cta")[0].trigger("click"); // Generate for Feature A
    await flushPromises();

    // The SIBLING (B) picked up the shared definition — no card is still pending.
    // Without the sibling refresh, B would keep showing "0 of 1".
    expect(w.text()).not.toContain("0 of 1 steps defined");
  });

  it("a re-diff no-op (misses implemented between detect and write) reprojects from CURRENT definitions, not the stale detect (Codex P2 on PR #102)", async () => {
    let implemented = false;
    const deps = makeDeps({
      specificationService: {
        listFeatures: async () =>
          ok([{ path: vp("features/UC-001-a.feature"), label: "UC-001-a.feature" }]),
        // The step is implemented out-of-band between detect and the write.
        listStepPatterns: async () =>
          implemented ? [{ kind: "expression" as const, source: "I do a thing" }] : [],
        detectMissingSteps: async (path) =>
          ok({ featurePath: path, missingSteps: ["I do a thing"], detectionEventId: "e1" }),
      },
      stepDefinitionService: {
        generate: async () => {
          implemented = true; // misses implemented before the write → re-diff no-op
          return ok({
            generatedSteps: [],
            stepFile: vp("steps.ts"),
            appended: false,
            insertions: [],
          });
        },
      },
    });
    const w = mountApp({ kind: "vault" }, deps);
    await flushPromises();
    expect(w.text()).toContain("0 of 1 steps defined");

    await w.find("button.mod-cta").trigger("click"); // Generate → re-diff no-op
    await flushPromises();

    // Reprojected from CURRENT static definitions (which now see the impl) — NOT
    // the stale non-empty detect list, which would keep the card pending.
    expect(w.text()).toContain("Every step has a definition.");
    expect(w.text()).not.toContain("0 of 1 steps defined");
    expect(w.text()).toContain("nothing to generate");
  });

  it("a use-case target whose Use Case was deleted (findById → null) surfaces a not-found error, not 'everything defined' (Codex P2 on PR #102)", async () => {
    const deps = makeDeps({ useCaseService: { findById: async () => ok(null) } });
    const w = mountApp({ kind: "use-case", useCaseId: "UC-404" }, deps);
    await flushPromises();

    expect(w.text()).toContain("Couldn't load");
    expect(w.text()).toContain("UC-404");
    expect(w.text()).toContain("not found");
    expect(w.text()).not.toContain("No Features with pending steps");
  });

  it("surfaces an unreadable LINKED Feature for a use-case target as an error — a scoped target's broken link isn't silently dropped (Codex P2 on PR #102)", async () => {
    const linked = vp("features/UC-001-a.feature");
    const deps = makeDeps({
      useCaseService: {
        findById: async () => ok({ featureFiles: [linked] } as unknown as UseCase),
      },
      // The single linked Feature can't be read (deleted/renamed link).
      fs: { readFile: async () => err(appError("RUNNER_MISSING_FILE", "linked feature deleted")) },
    });
    const w = mountApp({ kind: "use-case", useCaseId: "UC-001" }, deps);
    await flushPromises();

    expect(w.text()).toContain("Couldn't load");
    expect(w.text()).toContain("UC-001-a.feature");
    expect(w.text()).not.toContain("No Features with pending steps");
  });

  it("Verify does NOT mark a feature covered when bddgen reported misses that didn't map to it (Codex P2 on PR #102)", async () => {
    const deps = makeDeps({
      specificationService: {
        listFeatures: async () => ok([]),
        listStepPatterns: async () => [], // static sees the step as MISSING
        // bddgen printed its header (reported misses) but none mapped to this
        // feature's templates → the filtered list is empty.
        detectMissingSteps: async (path) =>
          ok({
            featurePath: path,
            missingSteps: [],
            detectionEventId: "e1",
            bddgenReportedMisses: true,
          }),
      },
    });
    const w = mountApp({ kind: "feature", featurePath: vp("features/UC-001-a.feature") }, deps);
    await flushPromises(); // feature-open auto-verify runs

    // The empty-but-header report must NOT clear the static miss — the card stays
    // on the static tier showing the step pending, not falsely "verified".
    expect(w.text()).toContain("0 of 1 steps defined");
    expect(w.text()).not.toContain("Every step has a definition.");
  });
});
