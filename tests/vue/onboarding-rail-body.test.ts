// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import OnboardingRailBody from "../../src/presentation/vue/onboarding/OnboardingRailBody.vue";
import type { OnboardingBodyDeps } from "../../src/presentation/vue/onboarding/onboarding-body-deps";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import type { DomainEvent } from "../../src/domain/events/domain-event";
import type { TourState } from "../../src/application/services/guided-tour-service";

const tourState = (over: Partial<TourState> = {}): TourState => ({
  steps: [],
  completed: false,
  dismissed: false,
  started: false,
  ...over,
});

function makeDeps(
  over: Partial<Record<keyof OnboardingBodyDeps, unknown>> = {},
): OnboardingBodyDeps {
  return {
    isInitialized: vi.fn().mockResolvedValue(true),
    ucCount: vi.fn().mockResolvedValue(5),
    tour: {
      getState: vi.fn().mockReturnValue(tourState({ started: true })),
      dismiss: vi.fn().mockResolvedValue(undefined),
      restart: vi.fn().mockResolvedValue(undefined),
      markDone: vi.fn().mockResolvedValue(undefined),
      skip: vi.fn().mockResolvedValue(undefined),
    },
    dispatchTourAction: vi.fn(),
    openWizard: vi.fn(),
    openCreateUseCase: vi.fn(),
    startTour: vi.fn(),
    eventBus: new InMemoryEventBus(),
    ...over,
  } as unknown as OnboardingBodyDeps;
}

const mountBody = (deps: OnboardingBodyDeps, props: Record<string, unknown> = {}) =>
  mount(OnboardingRailBody, {
    props: { deps, collapsed: false, onToggleCollapsed: vi.fn(), ...props },
  });

describe("OnboardingRailBody", () => {
  it("renders the Initialize CTA on an un-scaffolded vault", async () => {
    const deps = makeDeps({ isInitialized: vi.fn().mockResolvedValue(false) });
    const w = mountBody(deps);
    await flushPromises();
    await w.get(".spec-hub-onboarding-cta").trigger("click");
    expect(deps.openWizard).toHaveBeenCalledOnce();
  });

  it("renders the first-Use-Case branch when initialized with no Use Cases", async () => {
    const deps = makeDeps({
      ucCount: vi.fn().mockResolvedValue(0),
      tour: {
        getState: vi.fn().mockReturnValue(tourState()),
        dismiss: vi.fn(),
        restart: vi.fn(),
        markDone: vi.fn(),
        skip: vi.fn(),
      },
    });
    const w = mountBody(deps);
    await flushPromises();
    const ctas = w.findAll(".spec-hub-onboarding-cta");
    await ctas[0].trigger("click");
    expect(deps.openCreateUseCase).toHaveBeenCalledOnce();
    await ctas[1].trigger("click");
    expect(deps.startTour).toHaveBeenCalledOnce();
  });

  it("renders a retryable error when the Use Case count fails to load", async () => {
    const ucCount = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(5);
    const w = mountBody(makeDeps({ ucCount }));
    await flushPromises();
    expect(w.text()).toContain("Could not load the onboarding rail");
    await w.get('button[aria-label="Retry loading the onboarding rail"]').trigger("click");
    await flushPromises();
    // The retry loaded the tour rail (dismiss action present).
    expect(w.find(".spec-hub-onboarding").exists()).toBe(true);
  });

  it("collapses to nothing when the projection is hidden (dismissed)", async () => {
    const deps = makeDeps({
      tour: {
        getState: vi.fn().mockReturnValue(tourState({ started: true, dismissed: true })),
        dismiss: vi.fn(),
        restart: vi.fn(),
        markDone: vi.fn(),
        skip: vi.fn(),
      },
    });
    const w = mountBody(deps);
    await flushPromises();
    expect(w.find(".spec-hub-onboarding").exists()).toBe(false);
  });

  it("renders the done branch with Dismiss and Restart", async () => {
    const dismiss = vi.fn().mockResolvedValue(undefined);
    const restart = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      tour: {
        getState: vi.fn().mockReturnValue(tourState({ started: true, completed: true })),
        dismiss,
        restart,
        markDone: vi.fn(),
        skip: vi.fn(),
      },
    });
    const w = mountBody(deps);
    await flushPromises();
    await w.get('button[aria-label="Restart the guided tour from the beginning"]').trigger("click");
    expect(restart).toHaveBeenCalledOnce();
    await w.get('button[aria-label="Hide the onboarding rail"]').trigger("click");
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("shows only the header (chevron) when collapsed, and toggles", async () => {
    const onToggleCollapsed = vi.fn();
    const w = mountBody(makeDeps(), { collapsed: true, onToggleCollapsed });
    await flushPromises();
    expect(w.get(".spec-hub-onboarding").classes()).toContain("is-collapsed");
    expect(w.find(".spec-hub-onboarding-body").exists()).toBe(false);
    const toggle = w.get(".spec-hub-onboarding-toggle");
    expect(toggle.text()).toBe("▸");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    await toggle.trigger("click");
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it("reloads on a hub refresh event via useEventBus", async () => {
    const bus = new InMemoryEventBus();
    const isInitialized = vi.fn().mockResolvedValue(true);
    mountBody(makeDeps({ eventBus: bus, isInitialized }));
    await flushPromises();
    expect(isInitialized).toHaveBeenCalledOnce();
    void bus.publish({ type: "tour.step.completed" } as unknown as DomainEvent);
    await flushPromises();
    expect(isInitialized).toHaveBeenCalledTimes(2);
  });
});
