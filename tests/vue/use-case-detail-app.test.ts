// @vitest-environment happy-dom
import "./obsidian-dom";
import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import UseCaseDetailApp from "../../src/presentation/vue/use-case-detail/UseCaseDetailApp.vue";
import {
  USE_CASE_DETAIL_DEPS,
  USE_CASE_DETAIL_ID,
} from "../../src/presentation/vue/use-case-detail/use-case-detail-deps";
import { OBSIDIAN_APP } from "../../src/presentation/vue/obsidian-app";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import type { UseCaseDetailDeps } from "../../src/presentation/views/use-case-detail-view";
import type { UseCaseId, VaultPath } from "../../src/domain/value-objects/identifiers";

const PATH = "Features/UC-001-login.feature" as VaultPath;

const useCase = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "UC-001",
  title: "Login",
  status: "specified",
  automationStatus: "planned",
  featureFiles: [],
  suites: [],
  evidence: [],
  path: "UseCases/UC-001.md",
  ...over,
});

// A fresh SpecificationService slice; `allStepsDefined` drives whether the loop
// rail's current node is Steps (false → the generate-steps action appears).
const specService = (allStepsDefined: boolean): Record<string, unknown> => ({
  allStepsDefined: vi.fn().mockResolvedValue(allStepsDefined),
  listFeatures: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  validate: vi.fn(),
  detectMissingSteps: vi
    .fn()
    .mockResolvedValue({ ok: true, value: { missingSteps: ["Given x"], detectionEventId: "e" } }),
});

function makeDeps(over: Record<string, unknown> = {}): UseCaseDetailDeps {
  return {
    traceability: {
      deriveById: vi.fn(async (id: string) => ({ ok: true, value: useCase({ id }) })),
    },
    prdService: {
      findById: vi.fn().mockResolvedValue({ ok: true, value: null }),
      findAll: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    },
    storyMapService: { findAll: vi.fn().mockResolvedValue({ ok: true, value: [] }) },
    specificationService: specService(true),
    stepDefinitionService: {
      generate: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { generatedSteps: ["x"], stepFile: "s" } }),
    },
    featureInsight: {
      healthFor: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          scenarioCount: 0,
          wipScenarioCount: 0,
          quarantineScenarioCount: 0,
          featureIsWip: false,
          featureIsQuarantined: false,
        },
      }),
    },
    runLauncher: { launch: vi.fn().mockResolvedValue(undefined) },
    openGenerateFeature: vi.fn(),
    openCreateSuite: vi.fn(),
    navigate: vi.fn(),
    workspace: {
      openView: vi.fn(),
      openFile: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    },
    useCaseService: {},
    eventBus: new InMemoryEventBus(),
    ...over,
  } as unknown as UseCaseDetailDeps;
}

function mountApp(deps: UseCaseDetailDeps, id: ReturnType<typeof ref<UseCaseId | null>>) {
  return mount(UseCaseDetailApp, {
    global: {
      provide: {
        [USE_CASE_DETAIL_DEPS as symbol]: deps,
        [USE_CASE_DETAIL_ID as symbol]: id,
        [OBSIDIAN_APP as symbol]: {},
      },
    },
  });
}

const GENERATE_STEPS_BTN =
  'button[aria-label="Generate step definitions — the next step for this Use Case"]';
const checkRows = (w: ReturnType<typeof mountApp>) => w.findAll(".e2e-test-hub-settings-check-row");

describe("UseCaseDetailApp", () => {
  it("shows the empty prompt when no Use Case is targeted", async () => {
    const w = mountApp(makeDeps(), ref<UseCaseId | null>(null));
    await flushPromises();
    expect(w.text()).toContain("Open a Use Case to see its Feature Specifications");
  });

  it("renders the loaded Use Case header", async () => {
    const w = mountApp(makeDeps(), ref<UseCaseId | null>("UC-001" as UseCaseId));
    await flushPromises();
    expect(w.find("h2").text()).toBe("UC-001 — Login");
    expect(w.text()).toContain("Status: specified");
    expect(w.text()).toContain("Automation: planned");
  });

  it("drops the stale Use Case view before a re-target load resolves", async () => {
    let resolveRetarget!: (v: unknown) => void;
    const deps = makeDeps({
      traceability: {
        deriveById: vi
          .fn()
          .mockImplementationOnce(async () => ({ ok: true, value: useCase({ id: "UC-001" }) }))
          .mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                resolveRetarget = resolve;
              }),
          ),
      },
    });
    const id = ref<UseCaseId | null>("UC-001" as UseCaseId);
    const w = mountApp(deps, id);
    await flushPromises();
    expect(w.find("h2").text()).toBe("UC-001 — Login");

    // Re-target to a different Use Case; its load is still pending.
    id.value = "UC-002" as UseCaseId;
    await flushPromises();
    // The stale UC-001 header (and its Open/Edit/Run actions) must be gone.
    expect(w.find("h2").exists()).toBe(false);
    expect(w.text()).toContain("Loading");

    resolveRetarget({ ok: true, value: useCase({ id: "UC-002", title: "Signup" }) });
    await flushPromises();
    expect(w.find("h2").text()).toBe("UC-002 — Signup");
  });

  it("renders the loop-rail generate-steps result", async () => {
    // A Feature exists but its steps aren't defined → the rail's current node is
    // Steps, offering the generate action.
    const deps = makeDeps({
      traceability: {
        deriveById: vi.fn(async () => ({ ok: true, value: useCase({ featureFiles: [PATH] }) })),
      },
      specificationService: specService(false),
    });
    const w = mountApp(deps, ref<UseCaseId | null>("UC-001" as UseCaseId));
    await flushPromises();

    await w.get(GENERATE_STEPS_BTN).trigger("click");
    await flushPromises();
    expect(checkRows(w).some((r) => r.text().includes("Generated 1 step stub"))).toBe(true);
  });

  it("drops a generate-steps result that resolves AFTER a re-target (stale-write guard)", async () => {
    let resolveGenerate!: (v: unknown) => void;
    const deps = makeDeps({
      traceability: {
        deriveById: vi.fn(async (id: string) => ({
          ok: true,
          value:
            id === "UC-002"
              ? useCase({ id: "UC-002", featureFiles: [] })
              : useCase({ featureFiles: [PATH] }),
        })),
      },
      specificationService: specService(false),
      stepDefinitionService: {
        generate: vi.fn().mockReturnValue(
          new Promise((resolve) => {
            resolveGenerate = resolve;
          }),
        ),
      },
    });
    const id = ref<UseCaseId | null>("UC-001" as UseCaseId);
    const w = mountApp(deps, id);
    await flushPromises();

    await w.get(GENERATE_STEPS_BTN).trigger("click");
    await nextTick();

    // Re-target to another Use Case before the generation resolves.
    id.value = "UC-002";
    await flushPromises();

    // The stale generation now resolves — its result must NOT land under the new rail.
    resolveGenerate({ ok: true, value: { generatedSteps: ["x"], stepFile: "s" } });
    await flushPromises();
    expect(checkRows(w)).toHaveLength(0);
  });
});
