// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import FeatureRow from "../../src/presentation/vue/use-case-detail/FeatureRow.vue";
import { USE_CASE_DETAIL_DEPS } from "../../src/presentation/vue/use-case-detail/use-case-detail-deps";
import type { UseCaseDetailDeps } from "../../src/presentation/views/use-case-detail-view";
import type { VaultPath } from "../../src/domain/value-objects/identifiers";

const PATH = "Features/UC-001-login.feature" as VaultPath;
const LABEL = "UC-001-login.feature";
// A FRESH row object each call — the model rebuilds these every refresh, and the
// component is keyed by path, so a new object with the same path is exactly the
// "same-Feature refresh reuses the component" case the guards defend.
const row = (): { path: VaultPath; label: string } => ({ path: PATH, label: LABEL });

const health = (
  over: Partial<{ scenarioCount: number; wipScenarioCount: number }> = {},
): { ok: true; value: Record<string, unknown> } => ({
  ok: true,
  value: {
    scenarioCount: 3,
    wipScenarioCount: 0,
    quarantineScenarioCount: 0,
    featureIsWip: false,
    featureIsQuarantined: false,
    ...over,
  },
});

function makeDeps(over: Record<string, unknown> = {}): UseCaseDetailDeps {
  return {
    featureInsight: { healthFor: vi.fn().mockResolvedValue(health()) },
    specificationService: {
      validate: vi.fn().mockResolvedValue({ ok: true, value: { valid: true, errors: [] } }),
      detectMissingSteps: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { missingSteps: [], detectionEventId: "e1" } }),
    },
    stepDefinitionService: {
      generate: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { generatedSteps: [], stepFile: "s" } }),
    },
    runLauncher: { launch: vi.fn().mockResolvedValue(undefined) },
    navigate: vi.fn(),
    ...over,
  } as unknown as UseCaseDetailDeps;
}

function mountRow(deps: UseCaseDetailDeps) {
  return mount(FeatureRow, {
    props: { row: row() },
    global: { provide: { [USE_CASE_DETAIL_DEPS as symbol]: deps } },
  });
}

const checkRows = (w: ReturnType<typeof mountRow>) =>
  w.findAll(".e2e-test-hub-uc-detail-feature-result .e2e-test-hub-settings-check-row");
const validateButton = (w: ReturnType<typeof mountRow>) =>
  w.get(`button[aria-label="Validate ${LABEL}"]`);

describe("FeatureRow", () => {
  it("loads and renders the health line on mount", async () => {
    const deps = makeDeps();
    const w = mountRow(deps);
    await flushPromises();
    expect(deps.featureInsight.healthFor).toHaveBeenCalledWith(PATH);
    expect(w.find(".e2e-test-hub-uc-detail-feature-health").text()).toContain("3 scenarios");
  });

  it("reloads health when the row prop changes (a refresh reusing the component)", async () => {
    const deps = makeDeps();
    const w = mountRow(deps);
    await flushPromises();
    (deps.featureInsight.healthFor as ReturnType<typeof vi.fn>).mockResolvedValue(
      health({ scenarioCount: 5 }),
    );

    await w.setProps({ row: row() }); // fresh object, same path
    await flushPromises();

    expect(deps.featureInsight.healthFor).toHaveBeenCalledTimes(2);
    expect(w.find(".e2e-test-hub-uc-detail-feature-health").text()).toContain("5 scenarios");
  });

  it("renders the inline validate outcome", async () => {
    const w = mountRow(makeDeps());
    await flushPromises();
    await validateButton(w).trigger("click");
    await flushPromises();
    expect(checkRows(w)).toHaveLength(1);
    expect(checkRows(w)[0].text()).toContain("valid");
  });

  it("drops a validate result that resolves AFTER a refresh (stale-write guard)", async () => {
    let resolveValidate!: (v: unknown) => void;
    const deps = makeDeps({
      specificationService: {
        validate: vi.fn().mockReturnValue(
          new Promise((resolve) => {
            resolveValidate = resolve;
          }),
        ),
        detectMissingSteps: vi.fn(),
      },
    });
    const w = mountRow(deps);
    await flushPromises();

    await validateButton(w).trigger("click");
    await nextTick();
    expect(w.find(".e2e-test-hub-uc-detail-feature-result").text()).toContain("Validating");

    // A refresh reuses the component (fresh row, same path) — clears the result
    // and bumps the generation.
    await w.setProps({ row: row() });
    await flushPromises();

    // The stale validate now resolves; its result must NOT repopulate the row.
    resolveValidate({ ok: true, value: { valid: true, errors: [] } });
    await flushPromises();
    expect(checkRows(w)).toHaveLength(0);
  });

  it("clears an existing inline result on refresh", async () => {
    const w = mountRow(makeDeps());
    await flushPromises();
    await validateButton(w).trigger("click");
    await flushPromises();
    expect(checkRows(w).length).toBeGreaterThan(0);

    await w.setProps({ row: row() });
    await flushPromises();
    expect(checkRows(w)).toHaveLength(0);
  });
});
