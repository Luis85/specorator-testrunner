import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useHubStore } from "../../src/presentation/vue/hub/hub-store";

describe("useHubStore", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("toggles the onboarding rail collapse", () => {
    const store = useHubStore();
    expect(store.onboardingCollapsed).toBe(false);
    store.toggleOnboardingCollapsed();
    expect(store.onboardingCollapsed).toBe(true);
    store.toggleOnboardingCollapsed();
    expect(store.onboardingCollapsed).toBe(false);
  });

  it("sets and clears the Use Cases KPI funnel filter", () => {
    const store = useHubStore();
    store.setUseCaseFilter("failing");
    expect(store.useCaseFilter).toBe("failing");
    store.clearUseCaseFilter();
    expect(store.useCaseFilter).toBe("all");
  });

  it("sets the Evidence status filter", () => {
    const store = useHubStore();
    store.setEvidenceFilter("failed");
    expect(store.evidenceFilter).toBe("failed");
  });

  it("grows the Evidence page limit by a page each load-older", () => {
    const store = useHubStore();
    const initial = store.evidenceVisibleLimit;
    store.loadOlderEvidence();
    expect(store.evidenceVisibleLimit).toBeGreaterThan(initial);
  });
});
