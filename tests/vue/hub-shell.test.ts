// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

// The hosted section bodies + onboarding rail are the existing DOM writers,
// reused via Imperative. Mock them to no-ops so the shell's routing/rail can be
// tested without their data loading or Obsidian DOM.
vi.mock("../../src/presentation/views/overview-hero-body", () => ({
  renderOverviewHeroBody: vi.fn(),
}));
vi.mock("../../src/presentation/views/recent-runs-body", () => ({ renderRecentRunsBody: vi.fn() }));
// The Plan section's PRDs body is now the Vue-native PrdExplorerBody (ADR-0033
// Phase 3); the Plan route mounts it, so stub it to a no-op render — its own
// data loading + subscriptions are covered by prd-explorer-body.test.ts.
vi.mock("../../src/presentation/vue/prds/PrdExplorerBody.vue", () => ({
  default: { name: "PrdExplorerBody", render: () => null },
}));
// The Plan section's Story Maps body is now the Vue-native StoryMapExplorerBody
// (ADR-0033 Phase 3); the Plan route mounts it, so stub it to a no-op render —
// its own data loading + subscriptions are covered by story-map-explorer-body.test.ts.
vi.mock("../../src/presentation/vue/story-maps/StoryMapExplorerBody.vue", () => ({
  default: { name: "StoryMapExplorerBody", render: () => null },
}));
// The Run (Suites) and Build (Use Cases) section bodies are now Vue-native
// (ADR-0033 Phase 3), self-loading only when their /run and /build routes mount
// — these tests never navigate there, so no mocks are needed for them.
// The Review section's Evidence body is now the Vue-native EvidenceExplorerBody
// (ADR-0033 Phase 3); the Review route mounts it, so stub it to a no-op render —
// its own data loading + subscriptions are covered by evidence-explorer-body.test.ts.
vi.mock("../../src/presentation/vue/evidence/EvidenceExplorerBody.vue", () => ({
  default: { name: "EvidenceExplorerBody", render: () => null },
}));
vi.mock("../../src/presentation/views/onboarding-rail-body", () => ({
  renderOnboardingRailBody: vi.fn(),
}));

import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia } from "pinia";
import HubShell from "../../src/presentation/vue/hub/HubShell.vue";
import HubSection from "../../src/presentation/vue/hub/HubSection.vue";
import { HUB_DEPS } from "../../src/presentation/vue/hub/hub-deps";
import { OBSIDIAN_APP } from "../../src/presentation/vue/obsidian-app";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import { renderOnboardingRailBody } from "../../src/presentation/views/onboarding-rail-body";
import type { HubViewDeps } from "../../src/presentation/views/hub-view";

const makeDeps = (): HubViewDeps =>
  ({
    app: {},
    eventBus: new InMemoryEventBus(),
    workspace: { openView: vi.fn() },
    hero: {},
    recentRuns: {},
    prds: {},
    storyMaps: {},
    useCases: {},
    suites: {},
    evidence: {},
    onboarding: {},
  }) as unknown as HubViewDeps;

async function mountHub(initial = "overview") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/:section", component: HubSection },
      { path: "/:pathMatch(.*)*", redirect: `/${initial}` },
    ],
  });
  const wrapper = mount(HubShell, {
    global: {
      plugins: [router, createPinia()],
      provide: { [HUB_DEPS as symbol]: makeDeps(), [OBSIDIAN_APP as symbol]: {} },
    },
  });
  await router.isReady();
  await flushPromises();
  return { wrapper, router };
}

describe("HubShell", () => {
  it("renders the five rail sections with the initial one active", async () => {
    const { wrapper } = await mountHub("overview");
    const nodes = wrapper.findAll(".spec-hub-rail-node");
    expect(nodes.map((n) => n.text())).toEqual(["Overview", "Plan", "Build", "Run", "Review"]);
    expect(wrapper.get(".spec-hub-rail-node.is-active").text()).toBe("Overview");
  });

  it("restores onto the persisted section", async () => {
    const { wrapper, router } = await mountHub("review");
    expect(router.currentRoute.value.path).toBe("/review");
    expect(wrapper.get(".spec-hub-rail-node.is-active").text()).toBe("Review");
  });

  it("switches sections on a rail click", async () => {
    const { wrapper, router } = await mountHub("overview");
    await wrapper.get('button[aria-label^="Plan"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/plan");
    expect(wrapper.get(".spec-hub-rail-node.is-active").text()).toBe("Plan");
  });

  it("does not self-trigger a repaint loop when an async painter fills after emptiness", async () => {
    // The onboarding painter renders nothing synchronously, then fills after a
    // microtask (empty → content). With the paint closure rebuilt on every
    // render, the emptiness event would hand Imperative a fresh closure and loop
    // repaints unboundedly (starving the macrotask queue → hang). A stable
    // computed paint holds identity, so painting is bounded: the initial mount
    // plus the hub's one initial useEventBus refresh — never a runaway.
    const onboarding = vi.mocked(renderOnboardingRailBody);
    onboarding.mockClear();
    onboarding.mockImplementation(
      (el: HTMLElement): Promise<void> =>
        // Synchronously empty; fills after a microtask (the empty → content toggle).
        Promise.resolve().then(() => {
          el.appendChild(document.createElement("div"));
        }),
    );
    await mountHub("overview");
    await flushPromises();
    expect(onboarding.mock.calls.length).toBeLessThanOrEqual(3);
    onboarding.mockReset();
  });

  it("does not carry a section's empty-flag onto the next section's bodies", async () => {
    // Overview's mocked hero/recent-runs painters render nothing, so Imperative
    // reports empty and their slots collapse (is-empty).
    const { wrapper, router } = await mountHub("overview");
    expect(wrapper.findAll(".spec-hub-section-body.is-empty").length).toBeGreaterThan(0);

    // Plan reuses the same HubSection instance; its bodies (prd-roadmap,
    // story-maps) must NOT inherit Overview's stale per-index empty flags — the
    // flags are keyed by body id, so nothing carries over and the Story Maps
    // section is not hidden.
    await router.push("/plan");
    await flushPromises();
    expect(wrapper.findAll(".spec-hub-section-body.is-empty")).toHaveLength(0);
  });
});
