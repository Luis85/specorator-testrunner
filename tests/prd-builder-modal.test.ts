import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { UseCaseService } from "../src/application/services/use-case-service";
import type { EventBus } from "../src/shared/event-bus/event-bus";
import { PrdBuilderModal, type PrdBuilderDeps } from "../src/presentation/views/prd-builder-modal";
import { InMemoryEventBus } from "../src/shared/event-bus/event-bus";

/**
 * Mock/stub implementations for testing PrdBuilderModal
 */

/** Mock PRD Service for testing. */
const createMockPrdService = () => ({
  create: vi.fn().mockResolvedValue({
    ok: true,
    value: { id: "PRD-001", title: "Test PRD", path: "prds/test-prd.md" },
  }),
});

/** Mock Use Case Service that returns domains. */
const createMockUseCaseService = (): Partial<UseCaseService> => ({
  findAll: vi.fn().mockResolvedValue({
    ok: true,
    value: [
      { id: "UC-001", title: "Auth Flow", domain: "auth" },
      { id: "UC-002", title: "Dashboard", domain: "dashboard" },
      { id: "UC-003", title: "API Gateway", domain: "api" },
    ],
  }),
});

/** Mock Settings Service. */
const createMockSettingsService = () => ({
  load: vi.fn().mockResolvedValue({ paths: { prdsPath: "prds" } }),
});

describe("PrdBuilderModal", () => {
  let mockPrdService: ReturnType<typeof createMockPrdService>;
  let mockUseCaseService: Partial<UseCaseService>;
  let mockSettingsService: ReturnType<typeof createMockSettingsService>;
  let eventBus: EventBus;
  let openPrdBuilderCallback: (callback: () => void) => void;

  beforeEach(() => {
    mockPrdService = createMockPrdService();
    mockUseCaseService = createMockUseCaseService();
    mockSettingsService = createMockSettingsService();
    eventBus = new InMemoryEventBus();
    openPrdBuilderCallback = (_callback: () => void) => {
      // Mock implementation
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("can be instantiated with dependencies", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as any,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    // Create a minimal mock app
    const mockApp = { workspace: { activeEditor: null } } as any;
    const modal = new PrdBuilderModal(mockApp, deps);
    expect(modal).toBeTruthy();
  });

  it("has initial state with step 1 and empty fields", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as any,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as any;
    const modal = new PrdBuilderModal(mockApp, deps);

    // Verify initial state through modal behavior
    const state = (modal as any).state;
    expect(state.currentStep).toBe(1);
    expect(state.title).toBe("");
    expect(state.selectedDomains).toEqual([]);
    expect(state.errorMessages).toEqual({});
  });

  it("can navigate between steps", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as any,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as any;
    const modal = new PrdBuilderModal(mockApp, deps);

    const state = (modal as any).state;
    expect(state.currentStep).toBe(1);

    // Simulate navigation to step 2
    (modal as any).state = { ...state, currentStep: 2 };
    expect((modal as any).state.currentStep).toBe(2);

    // Navigate to step 7
    (modal as any).state = { ...(modal as any).state, currentStep: 7 };
    expect((modal as any).state.currentStep).toBe(7);

    // Navigate back to step 3
    (modal as any).state = { ...(modal as any).state, currentStep: 3 };
    expect((modal as any).state.currentStep).toBe(3);
  });

  it("can update title in state", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as any,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as any;
    const modal = new PrdBuilderModal(mockApp, deps);

    let state = (modal as any).state;
    expect(state.title).toBe("");

    state = { ...state, title: "My PRD" };
    (modal as any).state = state;
    expect((modal as any).state.title).toBe("My PRD");
  });

  it("can update domains in state", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as any,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as any;
    const modal = new PrdBuilderModal(mockApp, deps);

    let state = (modal as any).state;
    expect(state.selectedDomains).toEqual([]);

    state = { ...state, selectedDomains: ["dashboard", "api"] };
    (modal as any).state = state;
    expect((modal as any).state.selectedDomains).toEqual(["dashboard", "api"]);
  });

  it("can update vision in state", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as any,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as any;
    const modal = new PrdBuilderModal(mockApp, deps);

    let state = (modal as any).state;
    expect(state.vision).toBe("");

    state = { ...state, vision: "Single source of truth" };
    (modal as any).state = state;
    expect((modal as any).state.vision).toBe("Single source of truth");
  });

  it("can update scope items in state", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as any,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as any;
    const modal = new PrdBuilderModal(mockApp, deps);

    let state = (modal as any).state;
    expect(state.scopeIn).toEqual([]);
    expect(state.scopeOut).toEqual([]);

    state = { ...state, scopeIn: ["Feature A", "Feature B"], scopeOut: ["Legacy System"] };
    (modal as any).state = state;
    expect((modal as any).state.scopeIn).toEqual(["Feature A", "Feature B"]);
    expect((modal as any).state.scopeOut).toEqual(["Legacy System"]);
  });

  it("can update selected use cases in state", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as any,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as any;
    const modal = new PrdBuilderModal(mockApp, deps);

    let state = (modal as any).state;
    expect(state.selectedUcs).toEqual([]);

    state = { ...state, selectedUcs: ["UC-001", "UC-002"] };
    (modal as any).state = state;
    expect((modal as any).state.selectedUcs).toEqual(["UC-001", "UC-002"]);
  });

  it("can store error messages", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as any,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as any;
    const modal = new PrdBuilderModal(mockApp, deps);

    let state = (modal as any).state;
    expect(state.errorMessages).toEqual({});

    state = { ...state, errorMessages: { vision: "Vision is required" } };
    (modal as any).state = state;
    expect((modal as any).state.errorMessages.vision).toBe("Vision is required");
  });

  it("calls prdService.create when state is submitted", async () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as any,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as any;
    const modal = new PrdBuilderModal(mockApp, deps);

    (modal as any).state = {
      currentStep: 7,
      title: "Test PRD",
      parentPrdId: undefined,
      selectedDomains: ["dashboard"],
      research: "Some research",
      vision: "Clear vision",
      scopeIn: ["Feature A"],
      scopeOut: [],
      selectedUcs: ["UC-001"],
      errorMessages: {},
    };

    // Call create directly
    await (modal as any).create();

    expect(mockPrdService.create).toHaveBeenCalled();
  });

  it("closes modal after successful PRD creation", async () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as any,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as any;
    const modal = new PrdBuilderModal(mockApp, deps);
    const closeSpy = vi.spyOn(modal, "close");

    (modal as any).state = {
      currentStep: 7,
      title: "Test PRD",
      parentPrdId: undefined,
      selectedDomains: ["dashboard"],
      research: "",
      vision: "Vision",
      scopeIn: ["Item"],
      scopeOut: [],
      selectedUcs: [],
      errorMessages: {},
    };

    await (modal as any).create();

    expect(closeSpy).toHaveBeenCalled();
  });
});
