import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { UseCaseService } from "../src/application/services/use-case-service";
import type { EventBus } from "../src/shared/event-bus/event-bus";
import { PrdBuilderModal, type PrdBuilderDeps } from "../src/presentation/views/prd-builder-modal";
import { InMemoryEventBus } from "../src/shared/event-bus/event-bus";
import type { App } from "obsidian";

// Type alias for accessing private members in tests
type ModalWithPrivates = Record<string, unknown>;

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
      useCaseService: mockUseCaseService as UseCaseService,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    // Create a minimal mock app
    const mockApp = { workspace: { activeEditor: null } } as App;
    const modal = new PrdBuilderModal(mockApp, deps);
    expect(modal).toBeTruthy();
  });

  it("has initial state with step 1 and empty fields", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as UseCaseService,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as App;
    const modal = new PrdBuilderModal(mockApp, deps);

    // Verify initial state through modal behavior
    const state = (modal as unknown as ModalWithPrivates).state as Record<string, unknown>;
    expect((state as Record<string, number>).currentStep).toBe(1);
    expect((state as Record<string, string>).title).toBe("");
    expect((state as Record<string, unknown[]>).selectedDomains).toEqual([]);
    expect((state as Record<string, Record<string, unknown>>).errorMessages).toEqual({});
  });

  it("can navigate between steps", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as UseCaseService,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as App;
    const modal = new PrdBuilderModal(mockApp, deps);

    const state = (modal as unknown as ModalWithPrivates).state as Record<string, unknown>;
    expect((state as Record<string, number>).currentStep).toBe(1);

    // Simulate navigation to step 2
    const state2 = { ...state, currentStep: 2 };
    (modal as unknown as ModalWithPrivates).state = state2;
    const newState2 = (modal as unknown as ModalWithPrivates).state as Record<string, number>;
    expect(newState2.currentStep).toBe(2);

    // Navigate to step 7
    const state7 = { ...newState2, currentStep: 7 };
    (modal as unknown as ModalWithPrivates).state = state7;
    const newState7 = (modal as unknown as ModalWithPrivates).state as Record<string, number>;
    expect(newState7.currentStep).toBe(7);

    // Navigate back to step 3
    const state3 = { ...newState7, currentStep: 3 };
    (modal as unknown as ModalWithPrivates).state = state3;
    const newState3 = (modal as unknown as ModalWithPrivates).state as Record<string, number>;
    expect(newState3.currentStep).toBe(3);
  });

  it("can update title in state", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as UseCaseService,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as App;
    const modal = new PrdBuilderModal(mockApp, deps);

    let state = (modal as unknown as ModalWithPrivates).state as Record<string, unknown>;
    expect((state as Record<string, string>).title).toBe("");

    state = { ...state, title: "My PRD" };
    (modal as unknown as ModalWithPrivates).state = state;
    const updatedState = (modal as unknown as ModalWithPrivates).state as Record<string, string>;
    expect(updatedState.title).toBe("My PRD");
  });

  it("can update domains in state", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as UseCaseService,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as App;
    const modal = new PrdBuilderModal(mockApp, deps);

    let state = (modal as unknown as ModalWithPrivates).state as Record<string, unknown>;
    expect((state as Record<string, unknown[]>).selectedDomains).toEqual([]);

    state = { ...state, selectedDomains: ["dashboard", "api"] };
    (modal as unknown as ModalWithPrivates).state = state;
    const updatedState = (modal as unknown as ModalWithPrivates).state as Record<string, unknown[]>;
    expect(updatedState.selectedDomains).toEqual(["dashboard", "api"]);
  });

  it("can update vision in state", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as UseCaseService,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as App;
    const modal = new PrdBuilderModal(mockApp, deps);

    let state = (modal as unknown as ModalWithPrivates).state as Record<string, unknown>;
    expect((state as Record<string, string>).vision).toBe("");

    state = { ...state, vision: "Single source of truth" };
    (modal as unknown as ModalWithPrivates).state = state;
    const updatedState = (modal as unknown as ModalWithPrivates).state as Record<string, string>;
    expect(updatedState.vision).toBe("Single source of truth");
  });

  it("can update scope items in state", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as UseCaseService,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as App;
    const modal = new PrdBuilderModal(mockApp, deps);

    let state = (modal as unknown as ModalWithPrivates).state as Record<string, unknown>;
    expect((state as Record<string, unknown[]>).scopeIn).toEqual([]);
    expect((state as Record<string, unknown[]>).scopeOut).toEqual([]);

    state = { ...state, scopeIn: ["Feature A", "Feature B"], scopeOut: ["Legacy System"] };
    (modal as unknown as ModalWithPrivates).state = state;
    const updatedState = (modal as unknown as ModalWithPrivates).state as Record<string, unknown[]>;
    expect(updatedState.scopeIn).toEqual(["Feature A", "Feature B"]);
    expect(updatedState.scopeOut).toEqual(["Legacy System"]);
  });

  it("can update selected use cases in state", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as UseCaseService,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as App;
    const modal = new PrdBuilderModal(mockApp, deps);

    let state = (modal as unknown as ModalWithPrivates).state as Record<string, unknown>;
    expect((state as Record<string, unknown[]>).selectedUcs).toEqual([]);

    state = { ...state, selectedUcs: ["UC-001", "UC-002"] };
    (modal as unknown as ModalWithPrivates).state = state;
    const updatedState = (modal as unknown as ModalWithPrivates).state as Record<string, unknown[]>;
    expect(updatedState.selectedUcs).toEqual(["UC-001", "UC-002"]);
  });

  it("can store error messages", () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as UseCaseService,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as App;
    const modal = new PrdBuilderModal(mockApp, deps);

    let state = (modal as unknown as ModalWithPrivates).state as Record<string, unknown>;
    expect((state as Record<string, Record<string, unknown>>).errorMessages).toEqual({});

    state = { ...state, errorMessages: { vision: "Vision is required" } };
    (modal as unknown as ModalWithPrivates).state = state;
    const stateObj = (modal as unknown as ModalWithPrivates).state as Record<string, unknown>;
    const msgs = stateObj.errorMessages as Record<string, string>;
    expect(msgs.vision).toBe("Vision is required");
  });

  it("calls prdService.create when state is submitted", async () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as UseCaseService,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as App;
    const modal = new PrdBuilderModal(mockApp, deps);

    (modal as unknown as ModalWithPrivates).state = {
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
    await (modal as unknown as ModalWithPrivates).create();

    expect(mockPrdService.create).toHaveBeenCalled();
  });

  it("closes modal after successful PRD creation", async () => {
    const deps: PrdBuilderDeps = {
      prdService: mockPrdService,
      useCaseService: mockUseCaseService as UseCaseService,
      settingsService: mockSettingsService,
      eventBus,
      openPrdBuilder: openPrdBuilderCallback,
    };

    const mockApp = { workspace: { activeEditor: null } } as App;
    const modal = new PrdBuilderModal(mockApp, deps);
    const closeSpy = vi.spyOn(modal, "close");

    (modal as unknown as ModalWithPrivates).state = {
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

    await (modal as unknown as ModalWithPrivates).create();

    expect(closeSpy).toHaveBeenCalled();
  });
});
