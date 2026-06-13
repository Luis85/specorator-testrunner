import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { UseCaseService } from "../src/application/services/use-case-service";
import type { PrdService } from "../src/application/services/prd-service";
import { PrdBuilderModal, type PrdBuilderDeps } from "../src/presentation/views/prd-builder-modal";
import type { App } from "obsidian";

// Type alias for accessing private members in tests
type ModalWithPrivates = Record<string, unknown>;

/** Mock PRD Service for testing. */
const createMockPrdService = () => ({
  create: vi.fn().mockResolvedValue({
    ok: true,
    value: { id: "PRD-001", title: "Test PRD", path: "prds/test-prd.md" },
  }),
  findAll: vi.fn().mockResolvedValue({ ok: true, value: [] }),
});

/** Mock Use Case Service that returns domains and accepts PRD links. */
const createMockUseCaseService = (): Partial<UseCaseService> => ({
  findAll: vi.fn().mockResolvedValue({
    ok: true,
    value: [
      { id: "UC-001", title: "Auth Flow", domain: "auth", path: "Use Cases/UC-001.md" },
      { id: "UC-002", title: "Dashboard", domain: "dashboard", path: "Use Cases/UC-002.md" },
      { id: "UC-003", title: "API Gateway", domain: "api", path: "Use Cases/UC-003.md" },
    ],
  }),
  assignToPrd: vi.fn().mockResolvedValue({ ok: true, value: { id: "UC-001" } }),
});

describe("PrdBuilderModal", () => {
  let mockPrdService: ReturnType<typeof createMockPrdService>;
  let mockUseCaseService: Partial<UseCaseService>;

  const makeDeps = (): PrdBuilderDeps => ({
    prdService: mockPrdService as unknown as PrdService,
    useCaseService: mockUseCaseService as UseCaseService,
  });

  const makeModal = (): PrdBuilderModal => {
    const mockApp = { workspace: { activeEditor: null } } as App;
    return new PrdBuilderModal(mockApp, makeDeps());
  };

  const getState = (modal: PrdBuilderModal): Record<string, unknown> =>
    (modal as unknown as ModalWithPrivates).state as Record<string, unknown>;

  const setState = (modal: PrdBuilderModal, state: Record<string, unknown>): void => {
    (modal as unknown as ModalWithPrivates).state = state;
  };

  const invokeCreate = (modal: PrdBuilderModal): Promise<void> =>
    ((modal as unknown as ModalWithPrivates).create as () => Promise<void>).call(modal);

  beforeEach(() => {
    mockPrdService = createMockPrdService();
    mockUseCaseService = createMockUseCaseService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("can be instantiated with dependencies", () => {
    expect(makeModal()).toBeTruthy();
  });

  it("honors an explicitly provided parent PRD id in initial state", () => {
    const mockApp = { workspace: { activeEditor: null } } as App;
    const modal = new PrdBuilderModal(mockApp, { ...makeDeps(), parentPrdId: "PRD-003" });
    expect((getState(modal) as Record<string, string>).parentPrdId).toBe("PRD-003");
  });

  it("has initial state with step 1 and empty fields", () => {
    const state = getState(makeModal());
    expect((state as Record<string, number>).currentStep).toBe(1);
    expect((state as Record<string, string>).title).toBe("");
    expect((state as Record<string, unknown[]>).selectedDomains).toEqual([]);
    expect((state as Record<string, Record<string, unknown>>).errorMessages).toEqual({});
  });

  it("can navigate between steps", () => {
    const modal = makeModal();
    const state = getState(modal);
    expect((state as Record<string, number>).currentStep).toBe(1);

    setState(modal, { ...state, currentStep: 2 });
    expect((getState(modal) as Record<string, number>).currentStep).toBe(2);

    setState(modal, { ...getState(modal), currentStep: 7 });
    expect((getState(modal) as Record<string, number>).currentStep).toBe(7);

    setState(modal, { ...getState(modal), currentStep: 3 });
    expect((getState(modal) as Record<string, number>).currentStep).toBe(3);
  });

  it("can update title in state", () => {
    const modal = makeModal();
    expect((getState(modal) as Record<string, string>).title).toBe("");

    setState(modal, { ...getState(modal), title: "My PRD" });
    expect((getState(modal) as Record<string, string>).title).toBe("My PRD");
  });

  it("can update domains in state", () => {
    const modal = makeModal();
    expect((getState(modal) as Record<string, unknown[]>).selectedDomains).toEqual([]);

    setState(modal, { ...getState(modal), selectedDomains: ["dashboard", "api"] });
    expect((getState(modal) as Record<string, unknown[]>).selectedDomains).toEqual([
      "dashboard",
      "api",
    ]);
  });

  it("can update vision in state", () => {
    const modal = makeModal();
    expect((getState(modal) as Record<string, string>).vision).toBe("");

    setState(modal, { ...getState(modal), vision: "Single source of truth" });
    expect((getState(modal) as Record<string, string>).vision).toBe("Single source of truth");
  });

  it("can update scope items in state", () => {
    const modal = makeModal();
    expect((getState(modal) as Record<string, unknown[]>).scopeIn).toEqual([]);
    expect((getState(modal) as Record<string, unknown[]>).scopeOut).toEqual([]);

    setState(modal, {
      ...getState(modal),
      scopeIn: ["Feature A", "Feature B"],
      scopeOut: ["Legacy System"],
    });
    expect((getState(modal) as Record<string, unknown[]>).scopeIn).toEqual([
      "Feature A",
      "Feature B",
    ]);
    expect((getState(modal) as Record<string, unknown[]>).scopeOut).toEqual(["Legacy System"]);
  });

  it("can update selected use cases in state", () => {
    const modal = makeModal();
    expect((getState(modal) as Record<string, unknown[]>).selectedUcs).toEqual([]);

    setState(modal, { ...getState(modal), selectedUcs: ["UC-001", "UC-002"] });
    expect((getState(modal) as Record<string, unknown[]>).selectedUcs).toEqual([
      "UC-001",
      "UC-002",
    ]);
  });

  it("can store error messages", () => {
    const modal = makeModal();
    expect((getState(modal) as Record<string, Record<string, unknown>>).errorMessages).toEqual({});

    setState(modal, { ...getState(modal), errorMessages: { vision: "Vision is required" } });
    const msgs = getState(modal).errorMessages as Record<string, string>;
    expect(msgs.vision).toBe("Vision is required");
  });

  it("maps wizard state onto the PrdService.create request", async () => {
    const modal = makeModal();
    setState(modal, {
      currentStep: 7,
      title: "Test PRD",
      parentPrdId: undefined,
      selectedDomains: ["dashboard"],
      research: "Some research",
      vision: "Clear vision",
      scopeIn: ["Feature A"],
      scopeOut: ["Legacy"],
      selectedUcs: [],
      errorMessages: {},
    });

    await invokeCreate(modal);

    expect(mockPrdService.create).toHaveBeenCalledWith({
      title: "Test PRD",
      parentPrdId: undefined,
      domains: ["dashboard"],
      vision: "Clear vision",
      scopeIn: ["Feature A"],
      scopeOut: ["Legacy"],
      research: "Some research",
    });
  });

  it("assigns selected use cases to the new PRD after creation", async () => {
    const modal = makeModal();
    setState(modal, {
      currentStep: 7,
      title: "Test PRD",
      parentPrdId: undefined,
      selectedDomains: ["auth"],
      research: "",
      vision: "Vision",
      scopeIn: ["Item"],
      scopeOut: ["Out"],
      selectedUcs: ["UC-001"],
      errorMessages: {},
    });

    await invokeCreate(modal);

    // Linking is owned by UseCaseService (the note's owner), keyed by UC id.
    expect(mockUseCaseService.assignToPrd).toHaveBeenCalledWith("UC-001", "PRD-001");
  });

  it("closes modal after successful PRD creation", async () => {
    const modal = makeModal();
    const closeSpy = vi.spyOn(modal, "close");
    setState(modal, {
      currentStep: 7,
      title: "Test PRD",
      parentPrdId: undefined,
      selectedDomains: ["dashboard"],
      research: "",
      vision: "Vision",
      scopeIn: ["Item"],
      scopeOut: ["Out"],
      selectedUcs: [],
      errorMessages: {},
    });

    await invokeCreate(modal);

    expect(closeSpy).toHaveBeenCalled();
  });
});
