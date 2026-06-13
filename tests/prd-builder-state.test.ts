import { describe, expect, it } from "vitest";
import type { PrdBuilderState } from "../src/application/services/prd-builder";
import { prdBuilderStepTitle } from "../src/application/services/prd-builder";

describe("PrdBuilderState pure state machine", () => {
  const initialState = (): PrdBuilderState => ({
    currentStep: 1,
    title: "",
    parentPrdId: undefined,
    selectedDomains: [],
    research: "",
    vision: "",
    scopeIn: [],
    scopeOut: [],
    selectedUcs: [],
    errorMessages: {},
  });

  it("starts at step 1 with empty fields", () => {
    const state = initialState();
    expect(state.currentStep).toBe(1);
    expect(state.title).toBe("");
    expect(state.selectedDomains).toEqual([]);
    expect(state.errorMessages).toEqual({});
  });

  it("can navigate forward through steps", () => {
    let state = initialState();
    state = { ...state, currentStep: 2 };
    expect(state.currentStep).toBe(2);
    state = { ...state, currentStep: 7 };
    expect(state.currentStep).toBe(7);
  });

  it("can navigate backward through steps", () => {
    let state = { ...initialState(), currentStep: 5 };
    state = { ...state, currentStep: 3 };
    expect(state.currentStep).toBe(3);
  });

  it("can update title", () => {
    let state = initialState();
    state = { ...state, title: "My PRD" };
    expect(state.title).toBe("My PRD");
  });

  it("can update parentPrdId", () => {
    let state = initialState();
    state = { ...state, parentPrdId: "PRD-001" };
    expect(state.parentPrdId).toBe("PRD-001");
  });

  it("can add and remove domains", () => {
    let state = initialState();
    state = { ...state, selectedDomains: ["dashboard"] };
    expect(state.selectedDomains).toEqual(["dashboard"]);
    state = { ...state, selectedDomains: ["dashboard", "api"] };
    expect(state.selectedDomains).toEqual(["dashboard", "api"]);
    state = { ...state, selectedDomains: ["api"] };
    expect(state.selectedDomains).toEqual(["api"]);
  });

  it("can update research and vision", () => {
    let state = initialState();
    state = { ...state, research: "Market analysis shows..." };
    expect(state.research).toBe("Market analysis shows...");
    state = { ...state, vision: "Single source of truth" };
    expect(state.vision).toBe("Single source of truth");
  });

  it("can update scope in/out arrays", () => {
    let state = initialState();
    state = { ...state, scopeIn: ["feature A", "feature B"] };
    expect(state.scopeIn).toEqual(["feature A", "feature B"]);
    state = { ...state, scopeOut: ["legacy system"] };
    expect(state.scopeOut).toEqual(["legacy system"]);
  });

  it("can update selected use cases", () => {
    let state = initialState();
    state = { ...state, selectedUcs: ["UC-001", "UC-002"] };
    expect(state.selectedUcs).toEqual(["UC-001", "UC-002"]);
  });

  it("can store and clear error messages", () => {
    let state = initialState();
    state = { ...state, errorMessages: { vision: "Vision is required" } };
    expect(state.errorMessages.vision).toBe("Vision is required");
    state = { ...state, errorMessages: {} };
    expect(state.errorMessages).toEqual({});
  });

  it("can accumulate multiple error messages", () => {
    let state = initialState();
    state = {
      ...state,
      errorMessages: {
        title: "Title is required",
        vision: "Vision is required",
        scopeIn: "At least one item must be in scope",
      },
    };
    expect(Object.keys(state.errorMessages).length).toBe(3);
  });

  describe("prdBuilderStepTitle", () => {
    it("returns step 1 title: Domains", () => {
      expect(prdBuilderStepTitle(1)).toBe("Domains");
    });

    it("returns step 2 title: Research", () => {
      expect(prdBuilderStepTitle(2)).toBe("Research");
    });

    it("returns step 3 title: Vision", () => {
      expect(prdBuilderStepTitle(3)).toBe("Vision");
    });

    it("returns step 4 title: Scope", () => {
      expect(prdBuilderStepTitle(4)).toBe("Scope");
    });

    it("returns step 5 title: Success Metrics", () => {
      expect(prdBuilderStepTitle(5)).toBe("Success Metrics");
    });

    it("returns step 6 title: Assign Use Cases", () => {
      expect(prdBuilderStepTitle(6)).toBe("Assign Use Cases");
    });

    it("returns step 7 title: Review", () => {
      expect(prdBuilderStepTitle(7)).toBe("Review");
    });
  });
});
