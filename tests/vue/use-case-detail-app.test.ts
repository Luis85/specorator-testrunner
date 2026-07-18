// @vitest-environment happy-dom
import "./obsidian-dom";
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
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
import type { DomainEvent } from "../../src/domain/events/domain-event";

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
// rail's current node is Steps (false → the "Open pending steps" action appears).
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
    openPendingSteps: vi.fn(),
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

// WS1/C2: the loop rail's Steps stage now opens the Pending Steps companion.
const OPEN_PENDING_STEPS_BTN =
  'button[aria-label="Open pending steps — the next step for this Use Case"]';

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
    id.value = "UC-002";
    await flushPromises();
    // The stale UC-001 header (and its Open/Edit/Run actions) must be gone.
    expect(w.find("h2").exists()).toBe(false);
    expect(w.text()).toContain("Loading");

    resolveRetarget({ ok: true, value: useCase({ id: "UC-002", title: "Signup" }) });
    await flushPromises();
    expect(w.find("h2").text()).toBe("UC-002 — Signup");
  });

  it("clears the view during a same-Use-Case refresh (destructive event safe)", async () => {
    let resolveReload!: (v: unknown) => void;
    const bus = new InMemoryEventBus();
    const deps = makeDeps({
      eventBus: bus,
      traceability: {
        deriveById: vi
          .fn()
          .mockImplementationOnce(async () => ({ ok: true, value: useCase({ id: "UC-001" }) }))
          .mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                resolveReload = resolve;
              }),
          ),
      },
    });
    const w = mountApp(deps, ref<UseCaseId | null>("UC-001" as UseCaseId));
    await flushPromises();
    expect(w.find("h2").exists()).toBe(true);

    // The displayed Use Case is deleted — a same-id refresh whose actions are now
    // invalid. The view must drop them while the reload awaits, not keep them live.
    // Fire-and-forget: awaiting publish would block on the deferred reload, but the
    // `loading` state is set synchronously before reload's first await.
    void bus.publish({
      type: "usecase.deleted",
      payload: { useCaseId: "UC-001" },
    } as unknown as DomainEvent);
    await flushPromises();
    expect(w.find("h2").exists()).toBe(false);
    expect(w.text()).toContain("Loading");

    resolveReload({ ok: true, value: null });
    await flushPromises();
    expect(w.text()).toContain("was not found");
  });

  it("the loop rail's Steps action opens the Pending Steps companion for this Use Case (WS1/C2)", async () => {
    const openPendingSteps = vi.fn();
    const deps = makeDeps({
      traceability: {
        deriveById: vi.fn(async () => ({ ok: true, value: useCase({ featureFiles: [PATH] }) })),
      },
      // steps NOT defined → the rail's current node is Steps, offering the action.
      specificationService: specService(false),
      openPendingSteps,
    });
    const w = mountApp(deps, ref<UseCaseId | null>("UC-001" as UseCaseId));
    await flushPromises();

    await w.get(OPEN_PENDING_STEPS_BTN).trigger("click");

    expect(openPendingSteps).toHaveBeenCalledWith({ kind: "use-case", useCaseId: "UC-001" });
  });

  it("a Feature row's merged Steps button opens the companion for that Feature (WS1/C2)", async () => {
    const openPendingSteps = vi.fn();
    const deps = makeDeps({
      traceability: {
        deriveById: vi.fn(async () => ({ ok: true, value: useCase({ featureFiles: [PATH] }) })),
      },
      specificationService: {
        ...specService(true),
        listFeatures: vi.fn().mockResolvedValue({
          ok: true,
          value: [{ path: PATH, label: "UC-001-login.feature" }],
        }),
      },
      openPendingSteps,
    });
    const w = mountApp(deps, ref<UseCaseId | null>("UC-001" as UseCaseId));
    await flushPromises();

    await w
      .get('button[aria-label="Open pending steps for UC-001-login.feature"]')
      .trigger("click");

    expect(openPendingSteps).toHaveBeenCalledWith({ kind: "feature", featurePath: PATH });
  });

  it("does not reload on specification.missingSteps.detected — REFRESH_ON deliberately excludes it (Fix 2, Codex P2 on PR #102)", async () => {
    const bus = new InMemoryEventBus();
    const deriveById = vi.fn(async () => ({ ok: true, value: useCase({ id: "UC-001" }) }));
    const deps = makeDeps({ eventBus: bus, traceability: { deriveById } });
    const w = mountApp(deps, ref<UseCaseId | null>("UC-001" as UseCaseId));
    await flushPromises();
    expect(deriveById).toHaveBeenCalledTimes(1);

    await bus.publish({
      type: "specification.missingSteps.detected",
      payload: { featurePath: PATH, missingSteps: [] },
    } as unknown as DomainEvent);
    await flushPromises();

    // No subscriber, so no reload: the view must not even flicker to `loading`.
    expect(deriveById).toHaveBeenCalledTimes(1);
    expect(w.find("h2").exists()).toBe(true);
  });
});
