import { describe, expect, it } from "vitest";
import { DefaultGuidedTourService } from "../src/application/services/guided-tour-service";
import type { TourEventContext } from "../src/domain/onboarding/tour-steps";
import { DEFAULT_SETTINGS, type TestHubSettings } from "../src/domain/settings/settings";
import { createEvent } from "../src/shared/event-bus/create-event";
import { ok } from "../src/shared/result/result";
import { appError } from "../src/shared/errors/errors";
import { recordingEventBus, silentLogger } from "./fakes";

const ctx: TourEventContext = {
  demoUseCaseId: "UC-001",
  demoFeatureFileName: "UC-001-open-example-page.feature",
  defaultSuiteIds: ["smoke", "regression"],
};

const makeAccess = (failSaves = false) => {
  let settings: TestHubSettings = structuredClone(DEFAULT_SETTINGS);
  return {
    access: {
      getSettings: () => settings,
      updateSettings: async (next: TestHubSettings) => {
        if (failSaves) return { ok: false as const, error: appError("SETTINGS_INVALID", "boom") };
        settings = next;
        return ok(undefined);
      },
    },
    current: () => settings,
  };
};

const harness = (failSaves = false) => {
  const { bus, events } = recordingEventBus();
  const { access, current } = makeAccess(failSaves);
  const service = new DefaultGuidedTourService(access, bus, silentLogger, ctx);
  service.start();
  return { bus, events, service, current };
};

const status = (service: DefaultGuidedTourService, id: string) =>
  service.getState().steps.find((step) => step.definition.id === id)?.status;

describe("DefaultGuidedTourService", () => {
  it("completes create-use-case on a non-demo usecase.created and persists", async () => {
    const { bus, events, service, current } = harness();
    await bus.publish(
      createEvent("usecase.created", { useCaseId: "UC-002", title: "Greet", path: "x.md" }),
    );
    expect(status(service, "create-use-case")).toBe("done");
    expect(current().onboarding.completedSteps).toContain("create-use-case");
    const started = events.find((event) => event.type === "tour.started");
    const completed = events.find((event) => event.type === "tour.step.completed");
    expect(started).toBeDefined();
    expect(completed?.correlationId).toBe(current().onboarding.tourId);
    expect((completed?.payload as { via: string }).via).toBe("event");
  });

  it("ignores the shipped demo artifacts", async () => {
    const { bus, service } = harness();
    await bus.publish(
      createEvent("usecase.created", { useCaseId: "UC-001", title: "Demo", path: "d.md" }),
    );
    await bus.publish(
      createEvent("suite.created", {
        suiteId: "smoke",
        name: "Smoke Suite",
        path: "s.md",
        tagExpression: "@smoke",
      }),
    );
    // Neither demo artifact completes its step: run-demo (step 1) still holds
    // the active slot, so both steps stay unsettled.
    expect(status(service, "run-demo")).toBe("active");
    expect(status(service, "create-use-case")).toBe("pending");
    expect(status(service, "create-suite")).toBe("pending");
  });

  it("completes implement-steps only after generated THEN zero-missing", async () => {
    const { bus, service } = harness();
    await bus.publish(
      createEvent("specification.missingSteps.detected", {
        featurePath: "f.feature",
        missingSteps: [],
      }),
    );
    expect(status(service, "implement-steps")).not.toBe("done");
    await bus.publish(
      createEvent("stepdefinition.generated", {
        featurePath: "f.feature",
        stepFile: "s.ts",
        generatedSteps: ["a"],
      }),
    );
    await bus.publish(
      createEvent("specification.missingSteps.detected", {
        featurePath: "f.feature",
        missingSteps: [],
      }),
    );
    expect(status(service, "implement-steps")).toBe("done");
  });

  it("gates run-own-test on create-suite being done", async () => {
    const { bus, service } = harness();
    const runOwnSuite = async () => {
      await bus.publish(createEvent("suite.executed", { suiteId: "tour", runId: "RUN-9" }));
      await bus.publish(
        createEvent("testrun.completed", {
          runId: "RUN-9",
          status: "passed",
          durationMs: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
        }),
      );
    };
    await runOwnSuite();
    expect(status(service, "run-own-test")).not.toBe("done");

    await bus.publish(
      createEvent("suite.created", {
        suiteId: "tour",
        name: "Tour",
        path: "t.md",
        tagExpression: "@tour",
      }),
    );
    await runOwnSuite();
    expect(status(service, "run-own-test")).toBe("done");
  });

  it("arms review-evidence on evidence.generated and completes via markDone", async () => {
    const { bus, events, service } = harness();
    expect(service.getState().steps.find((s) => s.definition.id === "review-evidence")?.armed).toBe(
      false,
    );
    await bus.publish(
      createEvent("evidence.generated", {
        runId: "RUN-1",
        evidencePath: "Test Evidence/x.md",
        linkedUseCases: [],
      }),
    );
    expect(service.getState().steps.find((s) => s.definition.id === "review-evidence")?.armed).toBe(
      true,
    );
    const done = await service.markDone("review-evidence");
    expect(done.ok).toBe(true);
    expect(status(service, "review-evidence")).toBe("done");
    const completed = events.filter((event) => event.type === "tour.step.completed");
    expect((completed.at(-1)?.payload as { via: string }).via).toBe("manual");
  });

  it("rejects markDone on an event-completed step and skip on a non-skippable step", async () => {
    const { service } = harness();
    expect((await service.markDone("create-use-case")).ok).toBe(false);
    expect((await service.skip("create-suite")).ok).toBe(false);
  });

  it("skips a skippable step, persists, and publishes tour.step.skipped", async () => {
    const { events, service, current } = harness();
    const skipped = await service.skip("run-demo");
    expect(skipped.ok).toBe(true);
    expect(status(service, "run-demo")).toBe("skipped");
    expect(current().onboarding.skippedSteps).toContain("run-demo");
    expect(events.some((event) => event.type === "tour.step.skipped")).toBe(true);
  });

  it("publishes tour.completed once every step is done or skipped", async () => {
    const { bus, events, service } = harness();
    // Skip the skippable steps, complete the rest through their events.
    for (const id of [
      "run-demo",
      "detect-missing-steps",
      "implement-steps",
      "review-evidence",
      "generate-ci",
    ] as const) {
      await service.skip(id);
    }
    await bus.publish(
      createEvent("usecase.created", { useCaseId: "UC-002", title: "Greet", path: "x.md" }),
    );
    await bus.publish(
      createEvent("specification.linkedToUseCase", {
        useCaseId: "UC-002",
        featurePath: "f.feature",
      }),
    );
    await bus.publish(
      createEvent("specification.validation.completed", {
        featurePath: "f.feature",
        valid: true,
        errors: [],
        tags: ["@tour"],
      }),
    );
    await bus.publish(
      createEvent("suite.created", {
        suiteId: "tour",
        name: "Tour",
        path: "t.md",
        tagExpression: "@tour",
      }),
    );
    await bus.publish(createEvent("suite.executed", { suiteId: "tour", runId: "RUN-1" }));
    await bus.publish(
      createEvent("testrun.completed", {
        runId: "RUN-1",
        status: "passed",
        durationMs: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
      }),
    );
    expect(service.getState().completed).toBe(true);
    expect(events.filter((event) => event.type === "tour.completed")).toHaveLength(1);
  });

  it("keeps progress in memory when persistence fails", async () => {
    const { bus, service, current } = harness(true);
    await bus.publish(
      createEvent("usecase.created", { useCaseId: "UC-002", title: "Greet", path: "x.md" }),
    );
    expect(status(service, "create-use-case")).toBe("done");
    expect(current().onboarding.completedSteps).toEqual([]);
  });

  it("restart clears progress and mints a new tourId", async () => {
    const { bus, service, current } = harness();
    await bus.publish(
      createEvent("usecase.created", { useCaseId: "UC-002", title: "Greet", path: "x.md" }),
    );
    const firstTourId = current().onboarding.tourId;
    const restarted = await service.restart();
    expect(restarted.ok).toBe(true);
    // A fresh tour starts at step 1 again; the completed step is cleared.
    expect(status(service, "run-demo")).toBe("active");
    expect(status(service, "create-use-case")).toBe("pending");
    expect(current().onboarding.completedSteps).toEqual([]);
    expect(current().onboarding.tourId).not.toBe(firstTourId);
  });

  it("dismiss persists and is reflected in state", async () => {
    const { service, current } = harness();
    await service.dismiss();
    expect(service.getState().dismissed).toBe(true);
    expect(current().onboarding.dismissed).toBe(true);
  });

  it("initializes from persisted progress, dropping unknown step ids", () => {
    const { bus } = recordingEventBus();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.onboarding.completedSteps = ["create-use-case", "no-such-step"];
    const service = new DefaultGuidedTourService(
      { getSettings: () => settings, updateSettings: async () => ok(undefined) },
      bus,
      silentLogger,
      ctx,
    );
    expect(status(service, "create-use-case")).toBe("done");
    expect(service.getState().steps).toHaveLength(10);
  });
});
