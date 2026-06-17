import { describe, expect, it } from "vitest";
import type { PrdBuilderState } from "../src/application/services/prd-builder";
import {
  addDomainOption,
  deriveDomains,
  filterUseCasesByDomains,
  prdBuilderStepTitle,
  prdReviewLines,
  resolveParentPrdId,
  toCreatePrdRequest,
  toggleMembership,
} from "../src/application/services/prd-builder";
import type { Prd } from "../src/domain/entities/prd";
import type { UseCase } from "../src/domain/entities/use-case";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";

const useCase = (over: Partial<UseCase> = {}): UseCase => ({
  id: "UC-001",
  title: "Example",
  status: "specified",
  automationStatus: "implemented",
  featureFiles: [],
  suites: [],
  evidence: [],
  path: unsafeVaultPath("Use Cases/UC-001.md"),
  ...over,
});

const prd = (id: string, parent: string | undefined): Prd => ({
  id,
  title: id,
  status: "draft",
  parentPrdId: parent,
  domains: [],
  vision: "",
  scopeIn: [],
  scopeOut: [],
  displayOrder: 0,
  path: unsafeVaultPath(`PRDs/${id}/${id}.md`),
});

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

describe("resolveParentPrdId", () => {
  const tree = [prd("PRD-000", undefined), prd("PRD-001", "PRD-000")];

  it("returns undefined for the first PRD (it becomes the root)", () => {
    expect(resolveParentPrdId(undefined, [])).toBeUndefined();
  });

  it("defaults an omitted parent under PRD-000 once PRDs exist", () => {
    expect(resolveParentPrdId(undefined, tree)).toBe("PRD-000");
  });

  it("respects an explicit parent (Explorer ＋ sub-PRD)", () => {
    expect(resolveParentPrdId("PRD-001", tree)).toBe("PRD-001");
  });

  it("falls back to the first parentless PRD when PRD-000 is absent", () => {
    expect(resolveParentPrdId(undefined, [prd("PRD-007", undefined)])).toBe("PRD-007");
  });
});

describe("addDomainOption", () => {
  it("adds and selects a brand-new domain (PRD-first vault)", () => {
    expect(addDomainOption([], [], "billing")).toEqual({
      available: ["billing"],
      selected: ["billing"],
    });
  });

  it("keeps the available list sorted", () => {
    expect(addDomainOption(["api", "dashboard"], [], "billing").available).toEqual([
      "api",
      "billing",
      "dashboard",
    ]);
  });

  it("selects an existing option without duplicating it", () => {
    expect(addDomainOption(["api"], [], "api")).toEqual({
      available: ["api"],
      selected: ["api"],
    });
  });

  it("does not re-add an already-selected domain", () => {
    expect(addDomainOption(["api"], ["api"], "api")).toEqual({
      available: ["api"],
      selected: ["api"],
    });
  });

  it("trims input and ignores blanks", () => {
    expect(addDomainOption(["api"], [], "  billing  ").selected).toEqual(["billing"]);
    expect(addDomainOption(["api"], ["api"], "   ")).toEqual({
      available: ["api"],
      selected: ["api"],
    });
  });
});

describe("deriveDomains", () => {
  it("returns the unique, sorted, non-empty domains across Use Cases", () => {
    expect(
      deriveDomains([
        useCase({ domain: "dashboard" }),
        useCase({ domain: "api" }),
        useCase({ domain: "dashboard" }),
      ]),
    ).toEqual(["api", "dashboard"]);
  });

  it("drops Use Cases that carry no domain", () => {
    expect(deriveDomains([useCase({ domain: undefined }), useCase({ domain: "api" })])).toEqual([
      "api",
    ]);
  });

  it("returns an empty list when no Use Case has a domain", () => {
    expect(deriveDomains([useCase({ domain: undefined })])).toEqual([]);
  });
});

describe("filterUseCasesByDomains", () => {
  const ucs = [
    useCase({ id: "UC-001", domain: "auth" }),
    useCase({ id: "UC-002", domain: "dashboard" }),
    useCase({ id: "UC-003", domain: undefined }),
  ];

  it("returns every Use Case when no domain is selected", () => {
    expect(filterUseCasesByDomains(ucs, []).map((uc) => uc.id)).toEqual([
      "UC-001",
      "UC-002",
      "UC-003",
    ]);
  });

  it("keeps only Use Cases whose domain is selected", () => {
    expect(filterUseCasesByDomains(ucs, ["auth"]).map((uc) => uc.id)).toEqual(["UC-001"]);
  });

  it("never matches domainless Use Cases against a selection", () => {
    expect(filterUseCasesByDomains(ucs, ["auth", "dashboard"]).map((uc) => uc.id)).toEqual([
      "UC-001",
      "UC-002",
    ]);
  });
});

describe("toggleMembership", () => {
  it("adds an id that has become present", () => {
    expect(toggleMembership(["a"], "b", true)).toEqual(["a", "b"]);
  });

  it("removes an id that is no longer present", () => {
    expect(toggleMembership(["a", "b"], "a", false)).toEqual(["b"]);
  });

  it("does not duplicate an already-present id", () => {
    expect(toggleMembership(["a"], "a", true)).toEqual(["a"]);
  });

  it("is a no-op when removing an absent id", () => {
    expect(toggleMembership(["a"], "b", false)).toEqual(["a"]);
  });
});

describe("prdReviewLines", () => {
  const base: PrdBuilderState = {
    currentStep: 7,
    title: "Reporting",
    parentPrdId: "PRD-000",
    selectedDomains: ["dashboard", "api"],
    research: "",
    vision: "One source of truth",
    scopeIn: ["charts"],
    scopeOut: ["billing"],
    selectedUcs: ["UC-001"],
    errorMessages: {},
  };

  it("renders one summary line per PRD field, in review order", () => {
    expect(prdReviewLines(base)).toEqual([
      "Title: Reporting",
      "Parent: PRD-000",
      "Domains: dashboard, api",
      "Vision: One source of truth",
      "Scope In: charts",
      "Scope Out: billing",
      "Use Cases: UC-001",
    ]);
  });

  it("shows explicit placeholders for empty fields", () => {
    expect(
      prdReviewLines({
        ...base,
        title: "",
        parentPrdId: undefined,
        selectedDomains: [],
        vision: "",
        scopeIn: [],
        scopeOut: [],
        selectedUcs: [],
      }),
    ).toEqual([
      "Title: (none)",
      "Parent: None (root product vision)",
      "Domains: None",
      "Vision: (none)",
      "Scope In: None",
      "Scope Out: None",
      "Use Cases: None",
    ]);
  });
});

describe("toCreatePrdRequest", () => {
  it("maps the collected wizard fields onto a PrdService.create request", () => {
    expect(
      toCreatePrdRequest({
        currentStep: 7,
        title: "Reporting",
        parentPrdId: "PRD-000",
        selectedDomains: ["dashboard", "api"],
        research: "Market notes",
        vision: "One source of truth",
        scopeIn: ["charts"],
        scopeOut: ["billing"],
        selectedUcs: ["UC-001"],
        errorMessages: {},
      }),
    ).toEqual({
      title: "Reporting",
      parentPrdId: "PRD-000",
      domains: ["dashboard", "api"],
      vision: "One source of truth",
      scopeIn: ["charts"],
      scopeOut: ["billing"],
      research: "Market notes",
    });
  });
});
