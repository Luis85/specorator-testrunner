// @vitest-environment happy-dom
import "./obsidian-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import TestConsoleApp from "../../src/presentation/vue/test-console/TestConsoleApp.vue";
import { TEST_CONSOLE_DEPS } from "../../src/presentation/vue/test-console/test-console-deps";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import type { TestConsoleDeps } from "../../src/presentation/vue/test-console/test-console-deps";
import type { DomainEvent } from "../../src/domain/events/domain-event";
import type { TestRun } from "../../src/domain/entities/test-run";

const testRun = (over: Partial<TestRun> = {}): TestRun =>
  ({
    id: "run-1",
    scope: "suite",
    target: "Smoke",
    status: "failed",
    startedAt: "2026-07-04T08:00:00Z",
    finishedAt: "2026-07-04T08:01:00Z",
    ...over,
  }) as TestRun;

function makeDeps(over: Partial<TestConsoleDeps> = {}): TestConsoleDeps {
  return {
    eventBus: new InMemoryEventBus(),
    runLauncher: { launch: vi.fn().mockResolvedValue(undefined), cancel: vi.fn() },
    activeRunId: vi.fn().mockReturnValue(null),
    activeRunStartedAt: vi.fn().mockReturnValue(null),
    lastRun: vi.fn().mockReturnValue(null),
    lastEvidence: vi.fn().mockReturnValue(null),
    openEvidence: vi.fn(),
    ...over,
  };
}

const publish = async (bus: InMemoryEventBus, type: string, payload?: unknown): Promise<void> => {
  await bus.publish({ type, payload } as unknown as DomainEvent);
  await nextTick();
};

function mountConsole(deps = makeDeps()): {
  wrapper: ReturnType<typeof mount>;
  bus: InMemoryEventBus;
  deps: TestConsoleDeps;
} {
  const wrapper = mount(TestConsoleApp, {
    global: { provide: { [TEST_CONSOLE_DEPS as symbol]: deps } },
  });
  return { wrapper, bus: deps.eventBus as InMemoryEventBus, deps };
}

const outputText = (wrapper: ReturnType<typeof mount>): string =>
  wrapper.get("pre.e2e-test-hub-console-output").text();
const bannerText = (wrapper: ReturnType<typeof mount>): string =>
  wrapper.get(".spec-banner").text();
const metaText = (wrapper: ReturnType<typeof mount>): string =>
  wrapper.get(".e2e-test-hub-console-meta").text();
function button(wrapper: ReturnType<typeof mount>, label: string) {
  const match = wrapper.findAll("button").find((b) => b.text().includes(label));
  if (match === undefined) throw new Error(`no button labelled "${label}"`);
  return match;
}

describe("TestConsoleApp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the empty state before any run", () => {
    const { wrapper } = mountConsole();
    expect(metaText(wrapper)).toContain("No Test Run yet");
    expect(button(wrapper, "Cancel run").attributes("disabled")).toBeDefined();
    expect(button(wrapper, "Re-run").attributes("disabled")).toBeDefined();
  });

  it("streams a run: running banner, command, output, and live toolbar state", async () => {
    const { wrapper, bus } = mountConsole();
    await publish(bus, "testrun.requested", { scope: "suite", target: "Smoke" });
    await publish(bus, "testrun.started", { runId: "run-1", command: "npx playwright test" });
    await publish(bus, "testrun.output.received", {
      runId: "run-1",
      stream: "stdout",
      line: "Running 3 tests",
    });

    expect(bannerText(wrapper)).toContain("Run in progress");
    expect(metaText(wrapper)).toContain("Running Test Suite Smoke");
    expect(outputText(wrapper)).toContain("$ npx playwright test");
    expect(outputText(wrapper)).toContain("Running 3 tests");
    // Active: Cancel enabled, Re-run disabled.
    expect(button(wrapper, "Cancel run").attributes("disabled")).toBeUndefined();
    expect(button(wrapper, "Re-run").attributes("disabled")).toBeDefined();
  });

  it("marks stderr lines with a distinct class and prefix", async () => {
    const { wrapper, bus } = mountConsole();
    await publish(bus, "testrun.started", { runId: "run-1", command: "run" });
    await publish(bus, "testrun.output.received", {
      runId: "run-1",
      stream: "stderr",
      line: "boom",
    });
    const stderr = wrapper.find("pre.e2e-test-hub-console-output .e2e-test-hub-console-stderr");
    expect(stderr.exists()).toBe(true);
    expect(stderr.text()).toBe("[stderr] boom");
  });

  it("lifts a runner summary into the terminal banner and shows the idle meta", async () => {
    const deps = makeDeps({ lastRun: vi.fn().mockReturnValue(testRun({ status: "failed" })) });
    const { wrapper, bus } = mountConsole(deps);
    await publish(bus, "testrun.started", { runId: "run-1", command: "run" });
    await publish(bus, "testrun.output.received", {
      runId: "run-1",
      stream: "stdout",
      line: "1 failed (2.0s)",
    });
    await publish(bus, "testrun.completed", { runId: "run-1", status: "failed", durationMs: 2000 });

    expect(bannerText(wrapper)).toContain("Run failed (2.0s)");
    expect(bannerText(wrapper)).toContain("1 failed (2.0s)");
    expect(metaText(wrapper)).toContain("Last run: Test Suite Smoke");
    // Idle: Cancel disabled, Re-run enabled.
    expect(button(wrapper, "Cancel run").attributes("disabled")).toBeDefined();
    expect(button(wrapper, "Re-run").attributes("disabled")).toBeUndefined();
  });

  it("enables Open evidence when evidence.generated matches the last run", async () => {
    const openEvidence = vi.fn();
    const deps = makeDeps({
      lastRun: vi.fn().mockReturnValue(testRun({ id: "run-1" })),
      openEvidence,
    });
    const { wrapper, bus } = mountConsole(deps);
    expect(button(wrapper, "Open evidence").attributes("disabled")).toBeDefined();

    await publish(bus, "evidence.generated", { runId: "run-1", evidencePath: "Evidence/run-1.md" });
    const evidenceBtn = button(wrapper, "Open evidence");
    expect(evidenceBtn.attributes("disabled")).toBeUndefined();
    await evidenceBtn.trigger("click");
    expect(openEvidence).toHaveBeenCalledWith("Evidence/run-1.md");
  });

  it("ignores evidence for a run that is not the last one", async () => {
    const deps = makeDeps({ lastRun: vi.fn().mockReturnValue(testRun({ id: "run-1" })) });
    const { wrapper, bus } = mountConsole(deps);
    await publish(bus, "evidence.generated", {
      runId: "other-run",
      evidencePath: "Evidence/other.md",
    });
    expect(button(wrapper, "Open evidence").attributes("disabled")).toBeDefined();
  });

  it("Clear empties the output but keeps the banner", async () => {
    const { wrapper, bus } = mountConsole();
    await publish(bus, "testrun.started", { runId: "run-1", command: "run" });
    await publish(bus, "testrun.output.received", {
      runId: "run-1",
      stream: "stdout",
      line: "hello",
    });
    expect(outputText(wrapper)).toContain("hello");

    await button(wrapper, "Clear").trigger("click");
    expect(outputText(wrapper)).toBe("");
    expect(bannerText(wrapper)).toContain("Run in progress");
  });

  it("Cancel and Re-run drive the shared launcher", async () => {
    const deps = makeDeps({
      lastRun: vi.fn().mockReturnValue(testRun({ scope: "suite", target: "Smoke" })),
    });
    const { wrapper, bus, deps: d } = mountConsole(deps);
    await publish(bus, "testrun.started", { runId: "run-1", command: "run" });
    await button(wrapper, "Cancel run").trigger("click");
    expect(d.runLauncher.cancel).toHaveBeenCalled();

    await publish(bus, "testrun.completed", { runId: "run-1", status: "passed", durationMs: 500 });
    await button(wrapper, "Re-run").trigger("click");
    expect(d.runLauncher.launch).toHaveBeenCalledWith({ scope: "suite", target: "Smoke" });
  });

  it("seeds a running state when opened mid-run", async () => {
    const deps = makeDeps({
      activeRunId: vi.fn().mockReturnValue("run-1"),
      activeRunStartedAt: vi.fn().mockReturnValue(new Date(Date.now() - 5000).toISOString()),
    });
    const { wrapper } = mountConsole(deps);
    await nextTick();
    expect(bannerText(wrapper)).toContain("Run in progress");
    expect(metaText(wrapper)).toContain("Running");
    expect(button(wrapper, "Cancel run").attributes("disabled")).toBeUndefined();
  });
});
