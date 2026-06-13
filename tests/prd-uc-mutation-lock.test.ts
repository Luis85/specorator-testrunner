import { describe, expect, it } from "vitest";
import { DefaultPrdService } from "../src/application/services/prd-service";
import { DefaultUseCaseService } from "../src/application/services/use-case-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

/**
 * Cross-service serialization (ADR-0026): UseCaseService.assignToPrd routes its
 * validate-then-write through PrdService.withMutationLock — the SAME critical
 * section create()/deletePrd() use — so a Use Case→PRD link and a deletion of
 * the same leaf PRD can never interleave into a Use Case pointing at a deleted
 * PRD. The Use Case service borrows the PRD service's lock via the PrdLookup
 * contract (the real composition-root wiring).
 */
const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const prdService = new DefaultPrdService(settings, fs, bus, silentLogger);
  const useCaseService = new DefaultUseCaseService(settings, fs, bus, silentLogger, prdService);
  return { fs, prdService, useCaseService };
};

const seedRoot = (fs: FakeVaultFileSystem) =>
  fs.files.set(
    "PRDs/PRD-000-vision/PRD-000-vision.md",
    ["---", "id: PRD-000", "type: prd", "title: V", "parent-prd:", "---", ""].join("\n"),
  );
const seedLeaf = (fs: FakeVaultFileSystem) =>
  fs.files.set(
    "PRDs/PRD-001-dash/PRD-001-dash.md",
    ["---", "id: PRD-001", "type: prd", "title: Dash", "parent-prd: PRD-000", "---", ""].join("\n"),
  );
const seedUc = (fs: FakeVaultFileSystem) =>
  fs.files.set(
    "Use Cases/UC-001.md",
    ["---", "id: UC-001", "type: use-case", "title: A", "status: specified", "---", ""].join("\n"),
  );

describe("assignToPrd <-> deletePrd serialization (shared PRD mutation lock)", () => {
  it("never leaves a Use Case linked to a deleted PRD under concurrency", async () => {
    const { fs, prdService, useCaseService } = build();
    seedRoot(fs);
    seedLeaf(fs);
    seedUc(fs);

    const [assigned, deleted] = await Promise.all([
      useCaseService.assignToPrd("UC-001", "PRD-001"),
      prdService.deletePrd("PRD-001"),
    ]);

    const prdGone = !fs.files.has("PRDs/PRD-001-dash/PRD-001-dash.md");
    const ucLinked = (fs.files.get("Use Cases/UC-001.md") ?? "").includes("prd-id: PRD-001");
    // The core invariant: the Use Case must never point at a deleted PRD.
    expect(prdGone && ucLinked).toBe(false);

    if (assigned.ok) {
      // assign won → the PRD now has a linked Use Case, so delete must refuse.
      expect(deleted.ok).toBe(false);
      expect(prdGone).toBe(false);
    } else {
      // delete won → assign must reject the now-missing PRD.
      expect(deleted.ok).toBe(true);
    }
  });
});
