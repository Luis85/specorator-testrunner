import { describe, expect, it } from "vitest";
import { DefaultDemoContentService } from "../src/application/services/demo-content-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DEMO_FEATURE_CONTENT, DEMO_USE_CASE_ID } from "../src/application/content/demo-content";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus } from "./fakes";

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus, events, types } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const service = new DefaultDemoContentService(settings, fs, bus);
  return { service, fs, events, types };
};

describe("DefaultDemoContentService", () => {
  it("writes the demo feature + use case and emits the creation events", async () => {
    const { service, fs, types } = build();

    const result = await service.generate();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fs.files.get(result.value.featurePath)).toBe(DEMO_FEATURE_CONTENT);
    expect(fs.files.has(result.value.useCasePath)).toBe(true);
    expect(types()).toContain("usecase.created");
    expect(types()).toContain("specification.created");
    expect(types()).toContain("specification.linkedToUseCase");
  });

  it("emits no phantom creation events when the demo files already exist (re-init)", async () => {
    const { service, fs, events } = build();
    const first = await service.generate();
    expect(first.ok).toBe(true);
    const eventCountAfterFirst = events.length;
    const filesAfterFirst = new Map(fs.files);

    // Re-running init / a UC-024 reset over kept content skips the existing
    // notes, so the created events must not be replayed for them either.
    const second = await service.generate();

    expect(second.ok).toBe(true);
    expect(fs.files).toEqual(filesAfterFirst);
    expect(events.length).toBe(eventCountAfterFirst);
  });

  it("emits only the missing file's events when one demo file was deleted", async () => {
    const { service, fs, events } = build();
    const first = await service.generate();
    if (!first.ok) throw new Error("expected generate to succeed");
    // The user deleted the demo USE CASE but kept the feature: only the use
    // case is re-created, so only usecase.created may fire again.
    fs.files.delete(first.value.useCasePath);
    const eventCountAfterFirst = events.length;

    const second = await service.generate();

    expect(second.ok).toBe(true);
    const replayed = events.slice(eventCountAfterFirst);
    expect(replayed.map((e) => e.type)).toEqual(["usecase.created"]);
    expect(replayed[0]?.payload).toMatchObject({ useCaseId: DEMO_USE_CASE_ID });
  });
});
