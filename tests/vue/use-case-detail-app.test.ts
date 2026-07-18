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

  /**
   * Mounts the detail view on a Use Case with ONE Feature whose steps aren't
   * defined yet (the rail's current node is Steps, offering generate-steps),
   * clicks that action, and waits for the resulting allStepsDefined re-read
   * (refreshRail is unconditional, so this always happens) — the shared
   * arrange+act+assert behind the two rail-only-refresh tests below, which
   * differ only in `stepDefinitionService` and their own trailing row
   * assertion (kept local to each `it` per vitest/expect-expect).
   */
  const generateStepsAndExpectRailRefresh = async (
    stepDefinitionService: Record<string, unknown>,
    eventBus?: InMemoryEventBus,
  ): Promise<ReturnType<typeof mountApp>> => {
    const deps = makeDeps({
      ...(eventBus ? { eventBus } : {}),
      traceability: {
        deriveById: vi.fn(async () => ({ ok: true, value: useCase({ featureFiles: [PATH] }) })),
      },
      specificationService: specService(false),
      stepDefinitionService,
    });
    const w = mountApp(deps, ref<UseCaseId | null>("UC-001" as UseCaseId));
    await flushPromises();
    expect(deps.specificationService.allStepsDefined).toHaveBeenCalledTimes(1); // initial load

    await w.get(GENERATE_STEPS_BTN).trigger("click");
    await flushPromises();

    // refreshRail() is unconditional — the rail re-derives (a second
    // allStepsDefined read) regardless of the generate's outcome.
    expect(deps.specificationService.allStepsDefined).toHaveBeenCalledTimes(2);
    return w;
  };

  it("refreshes ONLY the rail after a generate — loopResult is preserved, not cleared (Codex P2s on PR #102, root fix)", async () => {
    const bus = new InMemoryEventBus();
    const w = await generateStepsAndExpectRailRefresh(
      {
        // Mirrors DefaultStepDefinitionService.generate: publishes
        // stepdefinition.generated on the SHARED bus before resolving.
        // REFRESH_ON does not subscribe to it, so this must NOT trigger a
        // full reload — only the explicit refreshRail() call inside the
        // helper above.
        generate: vi.fn(async () => {
          await bus.publish({
            type: "stepdefinition.generated",
            payload: { featurePath: PATH, stepFile: "s", generatedSteps: ["x"] },
          } as unknown as DomainEvent);
          return { ok: true, value: { generatedSteps: ["x"], stepFile: "s" } };
        }),
      },
      bus,
    );

    // loopResult (the outcome's own row) was never cleared: refreshRail()
    // touches only the rail, unlike a full reload() which zeroes loopResult at
    // its very first line.
    expect(checkRows(w)).toHaveLength(1);
    expect(checkRows(w)[0].text()).toContain("Generated 1 step stub in");
  });

  it("multi-feature mixed outcome: one Feature's error AND another's success both survive in loopResult, and the rail stays on Steps (Codex P2 #2 regression, root fix)", async () => {
    const pathA = "Features/UC-001-a.feature" as VaultPath;
    const pathB = "Features/UC-001-b.feature" as VaultPath;
    const deps = makeDeps({
      traceability: {
        deriveById: vi.fn(async () => ({
          ok: true,
          value: useCase({ featureFiles: [pathA, pathB] }),
        })),
      },
      specificationService: specService(false),
      stepDefinitionService: {
        generate: vi.fn(async (path: VaultPath) =>
          path === pathA
            ? {
                ok: false,
                error: { code: "RUNNER_NOT_INSTALLED", message: "bddgen is not installed" },
              }
            : { ok: true, value: { generatedSteps: ["x"], stepFile: "s" } },
        ),
      },
    });
    const w = mountApp(deps, ref<UseCaseId | null>("UC-001" as UseCaseId));
    await flushPromises();

    await w.get(GENERATE_STEPS_BTN).trigger("click");
    await flushPromises();

    // BOTH outcomes survive together: pathA's error did not wipe pathB's
    // success, and vice versa — the exact multi-feature clobber the #102
    // review's second P2 flagged (a full reload() would have cleared
    // loopResult and shown neither).
    const text = checkRows(w).map((row) => row.text());
    expect(text.some((t) => t.includes("Could not generate step definitions"))).toBe(true);
    expect(text.some((t) => t.includes("Generated 1 step stub in"))).toBe(true);
    // The rail stays on Steps: pathA still has an undefined step (its
    // generate failed), so allStepsDefined is (still) false and the action
    // remains — refreshRail() reports current truth, not a verdict "earned"
    // by this generate.
    expect(w.find(GENERATE_STEPS_BTN).exists()).toBe(true);
  });

  it("a failed generate still triggers a rail-only refresh, and its error row survives (Codex P2 on PR #102, root fix: refreshRail is unconditional)", async () => {
    const w = await generateStepsAndExpectRailRefresh({
      generate: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "RUNNER_NOT_INSTALLED", message: "bddgen is not installed" },
      }),
    });

    // refreshRail() never touches loopResult, so the error row survives.
    expect(checkRows(w)).toHaveLength(1);
    expect(checkRows(w)[0].text()).toContain("Could not generate step definitions");
  });

  /**
   * Resolves a deferred generate() call and flushes it through — the shared
   * mechanical tail of the two stale-write-guard tests below, which differ
   * only in WHAT invalidates the in-flight generation (a re-target vs. a
   * same-Use-Case refresh). Each caller still asserts the drop itself
   * (vitest/expect-expect wants the `expect` local to the `it` block).
   */
  const resolveGenerateAndFlush = async (resolveGenerate: (v: unknown) => void): Promise<void> => {
    resolveGenerate({ ok: true, value: { generatedSteps: ["x"], stepFile: "s" } });
    await flushPromises();
  };

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
    await resolveGenerateAndFlush(resolveGenerate);
    expect(checkRows(w)).toHaveLength(0);
  });

  it("drops a generate-steps result after a same-Use-Case refresh", async () => {
    let resolveGenerate!: (v: unknown) => void;
    const bus = new InMemoryEventBus();
    const deps = makeDeps({
      eventBus: bus,
      traceability: {
        deriveById: vi.fn(async () => ({ ok: true, value: useCase({ featureFiles: [PATH] }) })),
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
    const w = mountApp(deps, ref<UseCaseId | null>("UC-001" as UseCaseId));
    await flushPromises();

    await w.get(GENERATE_STEPS_BTN).trigger("click");
    await nextTick();

    // A same-Use-Case refresh (not a re-target) rebuilds the rail mid-generation.
    await bus.publish({ type: "specification.updated" } as unknown as DomainEvent);
    await flushPromises();

    await resolveGenerateAndFlush(resolveGenerate);
    expect(checkRows(w)).toHaveLength(0);
  });

  it("does not reload on specification.missingSteps.detected — item E's subscription was wrong (Fix 2, Codex P2 on PR #102)", async () => {
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

  it("a row-local detect result survives — REFRESH_ON no longer reloads on specification.missingSteps.detected (Fix 2, Codex P2 on PR #102)", async () => {
    const bus = new InMemoryEventBus();
    const deps = makeDeps({
      eventBus: bus,
      traceability: {
        deriveById: vi.fn(async () => ({ ok: true, value: useCase({ featureFiles: [PATH] }) })),
      },
      specificationService: {
        ...specService(true),
        listFeatures: vi.fn().mockResolvedValue({
          ok: true,
          value: [{ path: PATH, label: "UC-001-login.feature" }],
        }),
        // Mirrors production: detectMissingSteps publishes the detection event
        // itself, AWAITED, before its own promise resolves.
        detectMissingSteps: vi.fn(async (path: VaultPath) => {
          await bus.publish({
            type: "specification.missingSteps.detected",
            payload: { featurePath: path, missingSteps: ["Given x"] },
          } as unknown as DomainEvent);
          return {
            ok: true,
            value: { featurePath: path, missingSteps: ["Given x"], detectionEventId: "e1" },
          };
        }),
      },
    });
    const w = mountApp(deps, ref<UseCaseId | null>("UC-001" as UseCaseId));
    await flushPromises();

    await w
      .get('button[aria-label="Detect missing steps in UC-001-login.feature"]')
      .trigger("click");
    await flushPromises();

    // Were REFRESH_ON still subscribed to the detect event (item E), the
    // publish above would synchronously await a reload that rebuilds the
    // FeatureRow's `row` prop, bumping its generation and dropping this
    // write before it ever renders.
    expect(w.text()).toContain("1 step needs a definition");
  });
});
