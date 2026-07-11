// @vitest-environment happy-dom
import "./obsidian-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import FeatureEditorApp from "../../src/presentation/vue/feature-editor/FeatureEditorApp.vue";
import {
  createFeatureEditorController,
  FEATURE_EDITOR,
  type FeatureEditorController,
  type FeatureEditorDeps,
} from "../../src/presentation/vue/feature-editor/feature-editor-controller";
import type { FeatureSpecification } from "../../src/domain/entities/specification";

const PATH = "Features/UC-001-demo.feature";

const FEATURE = `@demo
Feature: Demo
  A description line.

  Background:
    Given a base state

  @happy
  Scenario: First
    Given I open the page
    When I click it
    Then it works
`;

const OUTLINE = `Feature: Outlined
  Scenario Outline: Math
    Given <a> plus <b>
    Then the result is <sum>

    Examples:
      | a | b | sum |
      | 1 | 2 | 3   |
`;

function makeDeps(over: Partial<FeatureEditorDeps> = {}): FeatureEditorDeps {
  return {
    specifications: {
      announceUpdated: vi.fn().mockResolvedValue(undefined),
      listStepPatterns: vi.fn().mockResolvedValue([]),
      validate: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    },
    featureInsight: { listKnownTags: vi.fn().mockResolvedValue({ ok: true, value: [] }) },
    runLauncher: { launch: vi.fn().mockResolvedValue(undefined) },
    ...over,
  };
}

/** The projected spec, asserted present (the fixtures all parse). */
function specOf(ctrl: FeatureEditorController): FeatureSpecification {
  const spec = ctrl.spec.value;
  if (spec === null) throw new Error("expected a projected spec");
  return spec;
}

/** The first scenario's first Examples block, asserted present. */
function firstExamplesRows(ctrl: FeatureEditorController): string[][] {
  const blocks = specOf(ctrl).scenarios[0].examples ?? [];
  if (blocks.length === 0) throw new Error("expected an Examples block");
  return blocks[0].rows;
}

/** The first button whose visible text matches, asserted present. */
function buttonByText(wrapper: ReturnType<typeof mount>, text: string): DOMWrapper<Element> {
  const match = wrapper.findAll("button").find((button) => button.text() === text);
  if (match === undefined) throw new Error(`no button labelled "${text}"`);
  return match;
}

/** Deps whose SpecificationService validates with the given (or a valid) mock. */
function validatingDeps(
  validate = vi.fn().mockResolvedValue({ ok: true, value: { valid: true, errors: [] } }),
): FeatureEditorDeps {
  return makeDeps({
    specifications: {
      announceUpdated: vi.fn().mockResolvedValue(undefined),
      listStepPatterns: vi.fn().mockResolvedValue([]),
      validate,
    },
  });
}

const hasValidateResult = (wrapper: ReturnType<typeof mount>): boolean =>
  wrapper.find(".e2e-test-hub-feature-editor-validate-result").exists();

async function clickValidate(wrapper: ReturnType<typeof mount>): Promise<void> {
  await wrapper.get('button[aria-label="Validate this feature"]').trigger("click");
  await flushPromises();
}

async function editFeatureName(wrapper: ReturnType<typeof mount>): Promise<void> {
  const name = wrapper.get('input[aria-label="Feature name"]');
  (name.element as HTMLInputElement).value = "Renamed";
  await name.trigger("change");
}

interface Harness {
  ctrl: FeatureEditorController;
  requestSave: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  wrapper: ReturnType<typeof mount>;
}

function mountEditor(data: string, deps = makeDeps(), filePath: string | null = PATH): Harness {
  const requestSave = vi.fn();
  const save = vi.fn().mockResolvedValue(undefined);
  const ctrl = createFeatureEditorController(deps, {
    requestSave,
    save,
    filePath: () => filePath,
  });
  ctrl.setData(data);
  const wrapper = mount(FeatureEditorApp, {
    global: { provide: { [FEATURE_EDITOR as symbol]: ctrl } },
  });
  return { ctrl, requestSave, save, wrapper };
}

describe("FeatureEditorApp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens a parseable feature in structured mode with the header populated", () => {
    const { wrapper } = mountEditor(FEATURE);
    expect(wrapper.find(".e2e-test-hub-feature-editor-body").exists()).toBe(true);
    const name = wrapper.get('input[aria-label="Feature name"]').element as HTMLInputElement;
    expect(name.value).toBe("Demo");
    // Structured toggle is the active one.
    expect(wrapper.get('button[aria-pressed="true"]').text()).toBe("Structured");
  });

  it("falls back to raw mode with a banner when the file can't be projected losslessly", () => {
    const { wrapper } = mountEditor("Feature: X\n# a comment the editor can't preserve\n");
    expect(wrapper.find("textarea.e2e-test-hub-feature-editor-raw").exists()).toBe(true);
    expect(wrapper.find(".spec-banner").exists()).toBe(true);
    expect(wrapper.get('button[aria-pressed="true"]').text()).toBe("Raw text");
  });

  it("toggles to raw mode and back to structured", async () => {
    const { wrapper } = mountEditor(FEATURE);
    await wrapper.get('button[aria-pressed="false"]').trigger("click"); // Raw text
    expect(wrapper.find("textarea.e2e-test-hub-feature-editor-raw").exists()).toBe(true);
    await wrapper.get('button[aria-pressed="false"]').trigger("click"); // Structured
    expect(wrapper.find(".e2e-test-hub-feature-editor-body").exists()).toBe(true);
  });

  it("keeps raw editing in sync with data and requests a save on each keystroke", async () => {
    const { ctrl, requestSave, wrapper } = mountEditor(FEATURE);
    await wrapper.get('button[aria-pressed="false"]').trigger("click"); // Raw text
    const textarea = wrapper.get("textarea.e2e-test-hub-feature-editor-raw");
    (textarea.element as HTMLTextAreaElement).value = "Feature: Renamed\n";
    await textarea.trigger("input");
    expect(ctrl.data.value).toBe("Feature: Renamed\n");
    expect(requestSave).toHaveBeenCalled();
  });

  it("commits a feature-name edit back into the raw data and requests a save", async () => {
    const { ctrl, requestSave, wrapper } = mountEditor(FEATURE);
    const name = wrapper.get('input[aria-label="Feature name"]');
    (name.element as HTMLInputElement).value = "Renamed";
    await name.trigger("change");
    expect(ctrl.data.value).toContain("Feature: Renamed");
    expect(requestSave).toHaveBeenCalled();
  });

  it("adds a tag through the tag editor and serialises it into the data", async () => {
    const { ctrl, wrapper } = mountEditor(FEATURE);
    const input = wrapper.get('input[aria-label="Feature tags"]');
    await input.setValue("smoke");
    await input.trigger("change");
    expect(ctrl.data.value).toContain("@smoke");
  });

  it("edits a step's text and serialises the change", async () => {
    const { ctrl, wrapper } = mountEditor(FEATURE);
    const step = wrapper.findAll('input[aria-label="Step text"]')[0];
    (step.element as HTMLInputElement).value = "I open the new page";
    await step.trigger("change");
    expect(ctrl.data.value).toContain("I open the new page");
  });

  it("appends a scenario via the + Scenario button", async () => {
    const { ctrl, wrapper } = mountEditor(FEATURE);
    const before = specOf(ctrl).scenarios.length;
    await buttonByText(wrapper, "+ Scenario").trigger("click");
    expect(specOf(ctrl).scenarios.length).toBe(before + 1);
  });

  it("renders an Examples grid for a Scenario Outline and can add a row", async () => {
    const { ctrl, wrapper } = mountEditor(OUTLINE);
    expect(wrapper.find(".e2e-test-hub-feature-editor-examples").exists()).toBe(true);
    const rowsBefore = firstExamplesRows(ctrl).length;
    await buttonByText(wrapper, "+ row").trigger("click");
    expect(firstExamplesRows(ctrl).length).toBe(rowsBefore + 1);
  });

  it("flushes the save then launches a Feature-scoped run", async () => {
    const deps = makeDeps();
    const { save, wrapper } = mountEditor(FEATURE, deps);
    await wrapper.get('button[aria-label="Run this feature"]').trigger("click");
    await flushPromises();
    expect(save).toHaveBeenCalled();
    expect(deps.runLauncher.launch).toHaveBeenCalledWith({ scope: "feature", target: PATH });
  });

  it("renders the inline validate outcome after ✓ Validate", async () => {
    const deps = validatingDeps();
    const { wrapper } = mountEditor(FEATURE, deps);
    await clickValidate(wrapper);
    expect(hasValidateResult(wrapper)).toBe(true);
    expect(deps.specifications.validate).toHaveBeenCalled();
  });

  it("clears a showing validate result once a structured field is edited", async () => {
    const { wrapper } = mountEditor(FEATURE, validatingDeps());
    await clickValidate(wrapper);
    expect(hasValidateResult(wrapper)).toBe(true);

    // Editing any structured field must retire the now-stale result — the
    // imperative view detached it by rebuilding the editor on every commit.
    await editFeatureName(wrapper);
    expect(hasValidateResult(wrapper)).toBe(false);
  });

  it("drops an in-flight validate result when a structured edit lands mid-flight", async () => {
    let resolveValidate: (result: unknown) => void = () => {};
    const validate = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveValidate = resolve;
      }),
    );
    const { wrapper } = mountEditor(FEATURE, validatingDeps(validate));
    await clickValidate(wrapper); // validate is now awaiting (pending row showing)

    // A structured edit lands before validation resolves; its result is now for
    // pre-edit content and must be dropped, not rendered under the edited UI.
    await editFeatureName(wrapper);

    resolveValidate({ ok: true, value: { valid: true, errors: [] } });
    await flushPromises();
    expect(hasValidateResult(wrapper)).toBe(false);
  });
});
