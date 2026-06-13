import { describe, expect, it } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultUseCaseService, nextUseCaseId } from "../src/application/services/use-case-service";
import { buildDemoUseCaseNote } from "../src/application/content/demo-content";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import type { UseCase, UseCaseStatus } from "../src/domain/entities/use-case";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { buildNote } from "../src/shared/utils/frontmatter";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus, types, events } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const service = new DefaultUseCaseService(settings, fs, bus, silentLogger);
  return { service, fs, types, events };
};

describe("nextUseCaseId", () => {
  it("starts at UC-001 and increments past the highest existing id", () => {
    expect(nextUseCaseId([])).toBe("UC-001");
    expect(
      nextUseCaseId([
        { id: "UC-001" } as UseCase,
        { id: "UC-003" } as UseCase,
        { id: "not-a-uc" } as UseCase,
      ]),
    ).toBe("UC-004");
  });
});

describe("DefaultUseCaseService", () => {
  it("creates a Use Case with generated frontmatter and emits usecase.created", async () => {
    const { service, fs, types, events } = build();

    const result = await service.create({ title: "Checkout with a saved card" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("UC-001");
    expect(result.value.status).toBe("draft");
    expect(result.value.automationStatus).toBe("not-planned");
    expect(result.value.path).toBe("Use Cases/UC-001 Checkout with a saved card.md");
    expect(fs.files.has(result.value.path)).toBe(true);
    expect(types()).toContain("usecase.created");

    // Event Catalog §4 payload { useCaseId, title, path }; §19 correlationId = useCaseId.
    const created = events.find((e) => e.type === "usecase.created");
    expect(created?.payload).toEqual({
      useCaseId: "UC-001",
      title: "Checkout with a saved card",
      path: "Use Cases/UC-001 Checkout with a saved card.md",
    });
    expect(created?.correlationId).toBe("UC-001");
  });

  it("collapses a multi-line description into a single frontmatter line", async () => {
    const { service } = build();
    const result = await service.create({
      title: "Multi",
      description: "First line.\nSecond line.\n\nThird.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.description).toBe("First line. Second line. Third.");
    // The written note must round-trip the full description (no truncation/corruption).
    const reread = await service.findAll();
    expect(reread.ok && reread.value[0].description).toBe("First line. Second line. Third.");
  });

  it("allocates the next id from existing use cases", async () => {
    const { service, fs } = build();
    fs.files.set(
      "Use Cases/UC-001 Demo.md",
      buildDemoUseCaseNote(vp("Specifications/features/demo.feature")),
    );

    const result = await service.create({ title: "Second" });

    expect(result.ok && result.value.id).toBe("UC-002");
  });

  it("indexes use cases nested in subfolders (recursive)", async () => {
    const { service, fs } = build();
    fs.files.set(
      "Use Cases/archive/UC-002 Old.md",
      buildNote({ type: "use-case", id: "UC-002", title: "Old", status: "deprecated" }, "# UC-002"),
    );

    const all = await service.findAll();
    expect(all.ok && all.value.map((u) => u.id)).toEqual(["UC-002"]);

    // create() must see the nested id so it does not reallocate UC-002.
    const created = await service.create({ title: "New" });
    expect(created.ok && created.value.id).toBe("UC-003");
  });

  it("rejects an empty title", async () => {
    const { service } = build();
    const result = await service.create({ title: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("indexes only use-case notes, sorted by id", async () => {
    const { service, fs } = build();
    fs.files.set(
      "Use Cases/UC-002 Later.md",
      buildNote(
        { type: "use-case", id: "UC-002", title: "Later", status: "specified" },
        "# UC-002",
      ),
    );
    fs.files.set(
      "Use Cases/UC-001 First.md",
      buildNote(
        {
          type: "use-case",
          id: "UC-001",
          title: "First",
          automation_status: "passing",
          feature_file: "f.feature",
        },
        "# UC-001",
      ),
    );
    // Not a use case — must be ignored by the index.
    fs.files.set("Use Cases/Notes.md", buildNote({ type: "test-suite", id: "smoke" }, "# Suite"));

    const result = await service.findAll();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((u) => u.id)).toEqual(["UC-001", "UC-002"]);
    expect(result.value[0].automationStatus).toBe("passing");
    expect(result.value[0].featureFiles).toEqual(["f.feature"]);
  });

  it("findById returns the matching use case or null", async () => {
    const { service, fs } = build();
    fs.files.set(
      "Use Cases/UC-002 Later.md",
      buildNote(
        { type: "use-case", id: "UC-002", title: "Later", status: "specified" },
        "# UC-002",
      ),
    );

    const found = await service.findById("UC-002");
    expect(found.ok && found.value?.id).toBe("UC-002");

    const missing = await service.findById("UC-999");
    expect(missing.ok && missing.value).toBe(null);
  });

  it("drops an unsafe frontmatter path instead of branding it (review P2, ADR-0008)", async () => {
    const { service, fs } = build();
    // Hand-edited / synced frontmatter is untrusted: a traversal/injection path
    // must be validated through vaultPath() and skipped, never surfaced as a
    // branded VaultPath that could reach an fs sink.
    fs.files.set(
      "Use Cases/UC-007.md",
      buildNote(
        {
          type: "use-case",
          id: "UC-007",
          title: "Tampered",
          feature_files: ["Specifications/features/UC-007-ok.feature", "../../etc/passwd"],
        },
        "# UC-007",
      ),
    );

    const found = await service.findById("UC-007");
    expect(found.ok).toBe(true);
    if (!found.ok || !found.value) return;
    // The safe path is kept; the traversal path is dropped.
    expect(found.value.featureFiles).toEqual(["Specifications/features/UC-007-ok.feature"]);
  });

  it("falls back to draft / not-planned for hand-edited enum frontmatter (status: banana)", async () => {
    const { service, fs } = build();
    // Frontmatter is hand-editable, so enum fields can hold anything — they
    // must be validated against the domain unions, never cast blindly.
    fs.files.set(
      "Use Cases/UC-004 Edited.md",
      buildNote(
        {
          type: "use-case",
          id: "UC-004",
          title: "Edited",
          status: "banana",
          automation_status: "totally-automated",
        },
        "# UC-004",
      ),
    );

    const found = await service.findById("UC-004");
    expect(found.ok).toBe(true);
    if (!found.ok || !found.value) return;
    expect(found.value.status).toBe("draft");
    expect(found.value.automationStatus).toBe("not-planned");
  });

  it("drops the lastTestRun projection when last_run_status/scope are invalid (KPI safety)", async () => {
    const { service, fs } = build();
    // An invalid hand-edited last_run_status must NOT default to "passed" —
    // that would inflate the ADR-0017 Passing KPI — so the whole summary is
    // dropped. Same for an invalid scope.
    fs.files.set(
      "Use Cases/UC-005 Bad Status.md",
      buildNote(
        {
          type: "use-case",
          id: "UC-005",
          title: "Bad Status",
          last_run_id: "RUN-2026-06-01-100000",
          last_run_status: "green",
        },
        "# UC-005",
      ),
    );
    fs.files.set(
      "Use Cases/UC-006 Bad Scope.md",
      buildNote(
        {
          type: "use-case",
          id: "UC-006",
          title: "Bad Scope",
          last_run_id: "RUN-2026-06-01-100000",
          last_run_status: "passed",
          last_run_scope: "galaxy",
        },
        "# UC-006",
      ),
    );
    // A valid summary still round-trips (scope is optional).
    fs.files.set(
      "Use Cases/UC-007 Valid.md",
      buildNote(
        {
          type: "use-case",
          id: "UC-007",
          title: "Valid",
          last_run_id: "RUN-2026-06-01-100000",
          last_run_status: "skipped",
        },
        "# UC-007",
      ),
    );

    const all = await service.findAll();
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    const byId = new Map(all.value.map((u) => [u.id, u]));
    expect(byId.get("UC-005")?.lastTestRun).toBeUndefined();
    expect(byId.get("UC-006")?.lastTestRun).toBeUndefined();
    expect(byId.get("UC-007")?.lastTestRun).toMatchObject({
      runId: "RUN-2026-06-01-100000",
      status: "skipped",
    });
  });

  it("update drops the legacy singular feature_file so features aren't duplicated", async () => {
    const { service, fs } = build();
    // A note using the legacy `feature_file` key (e.g. the seeded demo).
    const path = "Use Cases/UC-001 Legacy.md";
    fs.files.set(
      path,
      buildNote(
        {
          type: "use-case",
          id: "UC-001",
          title: "Legacy",
          feature_file: "Specifications/features/UC-001-happy-path.feature",
        },
        "# UC-001",
      ),
    );
    const loaded = await service.findById("UC-001");
    if (!loaded.ok || !loaded.value) throw new Error("expected UC-001");
    expect(loaded.value.featureFiles).toEqual([
      "Specifications/features/UC-001-happy-path.feature",
    ]);

    // Add a second feature and persist.
    await service.update({
      ...loaded.value,
      featureFiles: [
        ...loaded.value.featureFiles,
        vp("Specifications/features/UC-001-feature-2.feature"),
      ],
    });

    // Re-read: no duplication from the old feature_file lingering.
    const reread = await service.findById("UC-001");
    if (!reread.ok || !reread.value) throw new Error("expected UC-001");
    expect(reread.value.featureFiles).toEqual([
      "Specifications/features/UC-001-happy-path.feature",
      vp("Specifications/features/UC-001-feature-2.feature"),
    ]);
    expect(fs.files.get(path)).not.toContain("feature_file:");
  });

  it("update preserves the note body + unknown fields and emits usecase.updated", async () => {
    const { service, fs, types } = build();
    // A note with a hand-written body and a frontmatter field the builder
    // doesn't emit (owner) — both must survive a featureFiles link update.
    const path = "Use Cases/UC-001 Hand Edited.md";
    fs.files.set(
      path,
      buildNote(
        {
          type: "use-case",
          id: "UC-001",
          title: "Hand Edited",
          status: "specified",
          owner: "qa-team",
        },
        "# UC-001\n\n## Notes\n\nHand-written analysis that must not be deleted.",
      ),
    );
    const loaded = await service.findById("UC-001");
    expect(loaded.ok && loaded.value).not.toBeNull();
    if (!loaded.ok || !loaded.value) return;

    const updated = await service.update({
      ...loaded.value,
      featureFiles: [vp("Specifications/features/UC-001-happy-path.feature")],
    });
    expect(updated.ok).toBe(true);

    const note = fs.files.get(path) ?? "";
    expect(note).toContain("Specifications/features/UC-001-happy-path.feature");
    expect(note).toContain("Hand-written analysis that must not be deleted.");
    expect(note).toContain("owner: qa-team"); // unknown field preserved
    expect(types()).toContain("usecase.updated");
  });

  describe("updateMetadata (Wave G §3, UC-005)", () => {
    it("edits title and status, rewrites the H1 like create(), and emits both events", async () => {
      const { service, fs, events } = build();
      const created = await service.create({ title: "Old Title" });
      if (!created.ok) throw new Error("expected create to succeed");
      const path = created.value.path;

      const result = await service.updateMetadata("UC-001", {
        title: "New Title",
        status: "specified",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The updated entity is returned (path/id untouched — no rename).
      expect(result.value.title).toBe("New Title");
      expect(result.value.status).toBe("specified");
      expect(result.value.path).toBe(path);

      const note = fs.files.get(path) ?? "";
      expect(note).toContain("title: New Title");
      expect(note).toContain("status: specified");
      // The body H1 mirrors create()'s `# <id> <title>` format.
      expect(note).toContain("# UC-001 New Title");
      expect(note).not.toContain("Old Title");

      // Event Catalog §4 payloads, correlationId = useCaseId (§19).
      const updated = events.find((e) => e.type === "usecase.updated");
      expect(updated?.payload).toEqual({
        useCaseId: "UC-001",
        path,
        changedFields: ["title", "status"],
      });
      expect(updated?.correlationId).toBe("UC-001");
      const statusChanged = events.find((e) => e.type === "usecase.status.changed");
      expect(statusChanged?.payload).toEqual({
        useCaseId: "UC-001",
        previousStatus: "draft",
        nextStatus: "specified",
      });
      expect(statusChanged?.correlationId).toBe("UC-001");
    });

    it("emits no usecase.status.changed for a title-only edit", async () => {
      const { service, types } = build();
      await service.create({ title: "Original" });

      const result = await service.updateMetadata("UC-001", { title: "Renamed" });

      expect(result.ok).toBe(true);
      expect(types()).toContain("usecase.updated");
      expect(types()).not.toContain("usecase.status.changed");
    });

    it("preserves the hand-written body and unknown frontmatter on retitle", async () => {
      const { service, fs } = build();
      const path = "Use Cases/UC-003 Old.md";
      fs.files.set(
        path,
        buildNote(
          { type: "use-case", id: "UC-003", title: "Old", status: "draft", owner: "po-team" },
          "# UC-003 Old\n\n## Notes\n\nHand-written analysis that must survive.",
        ),
      );

      const result = await service.updateMetadata("UC-003", { title: "Renamed" });

      expect(result.ok).toBe(true);
      const note = fs.files.get(path) ?? "";
      expect(note).toContain("# UC-003 Renamed"); // only the create-format H1 moved
      expect(note).toContain("Hand-written analysis that must survive.");
      expect(note).toContain("owner: po-team");
    });

    it("inserts a title containing $-substitution patterns literally into the H1", async () => {
      const { service, fs } = build();
      const path = "Use Cases/UC-003 Old.md";
      fs.files.set(
        path,
        buildNote(
          { type: "use-case", id: "UC-003", title: "Old", status: "draft" },
          "# UC-003 Old",
        ),
      );

      // `$&` / `$$` / `$1` are String.replace substitution tokens — a string
      // replacement would expand them (`$&` re-inserts the whole old heading,
      // corrupting the note). The function replacement must keep them literal.
      const result = await service.updateMetadata("UC-003", { title: "Cost: $& or $$5 ($1)" });

      expect(result.ok).toBe(true);
      const note = fs.files.get(path) ?? "";
      expect(note).toContain("# UC-003 Cost: $& or $$5 ($1)");
      expect(note).not.toContain("# UC-003 Cost: # UC-003"); // the $& corruption shape
    });

    it("is a no-op (no write, no events) when nothing actually changed", async () => {
      const { service, fs, events } = build();
      const created = await service.create({ title: "Same" });
      if (!created.ok) throw new Error("expected create to succeed");
      const before = fs.files.get(created.value.path);
      const eventCountBefore = events.length;

      const result = await service.updateMetadata("UC-001", { title: "Same", status: "draft" });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.title).toBe("Same");
      expect(fs.files.get(created.value.path)).toBe(before);
      expect(events.length).toBe(eventCountBefore); // no phantom-edit events
    });

    it("rejects an unknown id", async () => {
      const { service } = build();
      const result = await service.updateMetadata("UC-999", { title: "Anything" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects an empty title", async () => {
      const { service } = build();
      await service.create({ title: "Kept" });
      const result = await service.updateMetadata("UC-001", { title: "   " });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects a status outside the UseCaseStatus union (runtime gate)", async () => {
      const { service, types } = build();
      await service.create({ title: "Kept" });
      const result = await service.updateMetadata("UC-001", {
        // UI input can't be trusted to the compile-time union alone.
        status: "shipped" as UseCaseStatus,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
      expect(types()).not.toContain("usecase.updated");
    });
  });

  it("serializes overlapping writes to the same note so read-modify-write can't interleave", async () => {
    const { service, fs } = build();
    const created = await service.create({ title: "Order checkout" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const { id, path } = created.value;

    // Record the note's read/write order. The one-tick delay on the 2nd
    // path-read (the gate resolves before any read runs) makes the overtake
    // deterministic instead of scheduler-dependent; the discriminating power
    // is the natural interleaving of two concurrent read-modify-write
    // sections when nothing serializes them.
    const order: string[] = [];
    let releaseSecondRead: () => void = () => {};
    const secondReadGate = new Promise<void>((resolve) => (releaseSecondRead = resolve));
    let reads = 0;
    const realRead = fs.readFile.bind(fs);
    const realWrite = fs.writeFile.bind(fs);
    fs.readFile = async (p) => {
      if (p === path) {
        reads += 1;
        if (reads === 2) await secondReadGate;
        order.push("read");
      }
      return realRead(p);
    };
    fs.writeFile = async (p, content) => {
      if (p === path) order.push("write");
      return realWrite(p, content);
    };

    // Fire both writers without awaiting. Unserialized, both RMW reads land
    // before either write (observed pre-fix tail: read,read,write,write) —
    // the second write clobbers the first writer's change.
    const first = service.updateMetadata(id, { title: "Renamed by writer one" });
    const second = service.updateMetadata(id, { status: "specified" });
    releaseSecondRead();
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);

    // Serialized sequence (8 ops total):
    //   [0] Writer 1 pre-lock findById → findAll → readFile (outside lock)
    //   [1] Writer 2 pre-lock findById → findAll → readFile (outside lock; gate is
    //       already released so no blocking occurs — the gate only adds a microtask
    //       tick to make scheduling deterministic in the unserialized case)
    //   [2] Writer 1 inside lock: locked findById → findAll → readFile
    //   [3] Writer 1 inside lock: readFile for frontmatter update
    //   [4] Writer 1 inside lock: writeFile
    //   [5] Writer 2 inside lock: locked findById → findAll → readFile
    //   [6] Writer 2 inside lock: readFile for frontmatter update
    //   [7] Writer 2 inside lock: writeFile
    // Without the noteWrites.run wrapper, both writers' reads land before either
    // write (observed: read,read,read,read,read,read,write,write) — the second
    // write clobbers the first writer's change. Fix 1 moves findById inside the
    // lock, adding two more recorded reads (one per writer) vs. the original four.
    expect(order).toEqual(["read", "read", "read", "read", "write", "read", "read", "write"]);
  });
});

describe("domain field and listDomains", () => {
  it("exposes the domain frontmatter field and lists distinct domains", async () => {
    const { service, fs } = build();
    fs.files.set("Use Cases/UC-001 A.md", "---\nid: UC-001\ntype: use-case\ntitle: A\ndomain: Installation\nstatus: specified\n---\n# UC-001 A\n");
    fs.files.set("Use Cases/UC-002 B.md", "---\nid: UC-002\ntype: use-case\ntitle: B\ndomain: Dashboard\nstatus: specified\n---\n# UC-002 B\n");
    fs.files.set("Use Cases/UC-003 C.md", "---\nid: UC-003\ntype: use-case\ntitle: C\ndomain: Dashboard\nstatus: specified\n---\n# UC-003 C\n");

    const all = await service.findAll();
    expect(all.ok && all.value.find((u) => u.id === "UC-001")?.domain).toBe("Installation");

    const domains = await service.listDomains();
    expect(domains.ok && domains.value).toEqual([
      { domain: "Dashboard", count: 2 },
      { domain: "Installation", count: 1 },
    ]);
  });
});
