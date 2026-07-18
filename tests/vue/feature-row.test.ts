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
const detectButton = (w: ReturnType<typeof mountRow>) =>
  w.get(`button[aria-label="Detect missing steps in ${LABEL}"]`);
const generateButton = (w: ReturnType<typeof mountRow>) =>
  w.get(`button[aria-label="Generate step definitions for ${LABEL}"]`);

/**
 * Mounts the row and clicks Generate, flushing both the mount and the click
 * through — the shared arrange+act behind the no-op/failed generate tests
 * below, which differ only in `deps` and their own trailing assertions (kept
 * local to each `it` per vitest/expect-expect).
 */
async function mountAndGenerate(deps: UseCaseDetailDeps): Promise<ReturnType<typeof mountRow>> {
  const w = mountRow(deps);
  await flushPromises();
  await generateButton(w).trigger("click");
  await flushPromises();
  return w;
}

/** Same shape as {@link mountAndGenerate}, for the Detect button (Part 3). */
async function mountAndDetect(deps: UseCaseDetailDeps): Promise<ReturnType<typeof mountRow>> {
  const w = mountRow(deps);
  await flushPromises();
  await detectButton(w).trigger("click");
  await flushPromises();
  return w;
}

/** Same shape as {@link mountAndGenerate}, for the Validate button. */
async function mountAndValidate(deps: UseCaseDetailDeps): Promise<ReturnType<typeof mountRow>> {
  const w = mountRow(deps);
  await flushPromises();
  await validateButton(w).trigger("click");
  await flushPromises();
  return w;
}

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
    const w = await mountAndValidate(makeDeps());
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
    const w = await mountAndValidate(makeDeps());
    expect(checkRows(w).length).toBeGreaterThan(0);

    await w.setProps({ row: row() });
    await flushPromises();
    expect(checkRows(w)).toHaveLength(0);
  });

  it("emits railStale once the generate outcome commits (#77, root fix: refreshRail() doesn't rebuild this row, so the emit no longer needs gating)", async () => {
    const deps = makeDeps({
      stepDefinitionService: {
        generate: vi
          .fn()
          .mockResolvedValue({ ok: true, value: { generatedSteps: ["x"], stepFile: "s" } }),
      },
    });
    const w = await mountAndGenerate(deps);

    expect(checkRows(w).length).toBeGreaterThan(0);
    expect(w.emitted("railStale")).toHaveLength(1);
  });

  it("emits railStale for a NO-OP generate too, and its row still renders (Codex P2s on PR #102, root fix)", async () => {
    // makeDeps' default generate mock resolves ok with an EMPTY generatedSteps.
    const w = await mountAndGenerate(makeDeps());

    expect(checkRows(w)).toHaveLength(1);
    expect(checkRows(w)[0].text()).toContain("nothing to generate");
    expect(w.emitted("railStale")).toHaveLength(1);
  });

  it("emits railStale for a FAILED generate too, and its error row still renders (Codex P2s on PR #102, root fix)", async () => {
    const deps = makeDeps({
      stepDefinitionService: {
        generate: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: "RUNNER_NOT_INSTALLED", message: "bddgen is not installed" },
        }),
      },
    });
    const w = await mountAndGenerate(deps);

    expect(checkRows(w)).toHaveLength(1);
    expect(checkRows(w)[0].text()).toContain("Could not generate step definitions");
    expect(w.emitted("railStale")).toHaveLength(1);
  });

  it("does not emit railStale for a generate result dropped by a refresh (stale-write guard)", async () => {
    let resolveGenerate!: (v: unknown) => void;
    const deps = makeDeps({
      stepDefinitionService: {
        generate: vi.fn().mockReturnValue(
          new Promise((resolve) => {
            resolveGenerate = resolve;
          }),
        ),
      },
    });
    const w = mountRow(deps);
    await flushPromises();

    await generateButton(w).trigger("click");
    // generateStepDefinitionsOutcome awaits detectMissingSteps (an already-
    // resolved mock) BEFORE reaching the deliberately-pending generate() call;
    // flushPromises (not just one nextTick) drains that hop while still
    // leaving the deferred generate() promise itself unresolved below.
    await flushPromises();
    expect(w.find(".e2e-test-hub-uc-detail-feature-result").text()).toContain(
      "Generating step definitions",
    );

    // A refresh reuses the component (fresh row, same path) — clears the result
    // and bumps the generation before the generate outcome resolves.
    await w.setProps({ row: row() });
    await flushPromises();

    // The stale generate now resolves; it must neither repopulate the row NOR
    // tell the parent to re-derive the rail on its behalf.
    resolveGenerate({ ok: true, value: { generatedSteps: ["x"], stepFile: "s" } });
    await flushPromises();
    expect(checkRows(w)).toHaveLength(0);
    expect(w.emitted("railStale")).toBeUndefined();
  });

  it("emits railStale once a committed DETECT commits too — detect now records a #77 coverage verdict, so it may also change the rail (Codex P2, Part 3)", async () => {
    const w = await mountAndDetect(makeDeps());

    expect(checkRows(w).length).toBeGreaterThan(0);
    expect(w.emitted("railStale")).toHaveLength(1);
  });

  it("does not emit railStale for a detect result dropped by a refresh (stale-write guard, Codex P2, Part 3)", async () => {
    let resolveDetect!: (v: unknown) => void;
    const deps = makeDeps({
      specificationService: {
        validate: vi.fn(),
        detectMissingSteps: vi.fn().mockReturnValue(
          new Promise((resolve) => {
            resolveDetect = resolve;
          }),
        ),
      },
    });
    const w = mountRow(deps);
    await flushPromises();

    await detectButton(w).trigger("click");
    await nextTick();
    expect(w.find(".e2e-test-hub-uc-detail-feature-result").text()).toContain("Detecting");

    // A refresh reuses the component (fresh row, same path) — clears the result
    // and bumps the generation before the detect outcome resolves.
    await w.setProps({ row: row() });
    await flushPromises();

    // The stale detect now resolves; it must neither repopulate the row NOR
    // tell the parent to re-derive the rail on its behalf.
    resolveDetect({ ok: true, value: { missingSteps: [], detectionEventId: "e1" } });
    await flushPromises();
    expect(checkRows(w)).toHaveLength(0);
    expect(w.emitted("railStale")).toBeUndefined();
  });

  it("does not emit railStale for a VALIDATE — it runs no detect/generate and changes no coverage (Codex P2, Part 3)", async () => {
    const w = await mountAndValidate(makeDeps());
    expect(checkRows(w).length).toBeGreaterThan(0);
    expect(w.emitted("railStale")).toBeUndefined();
  });
});
