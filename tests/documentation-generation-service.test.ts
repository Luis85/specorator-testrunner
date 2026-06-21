import { describe, expect, it } from "vitest";

import {
  buildDocumentation,
  documentationFileName,
} from "../src/application/content/documentation-content";
import { DefaultDocumentationGenerationService } from "../src/application/services/documentation-generation-service";
import type { WorkspacePort } from "../src/application/ports/workspace-port";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import type { VaultPath } from "../src/domain/value-objects/identifiers";
import { ok, type Result } from "../src/shared/result/result";
import { joinVaultPath } from "../src/shared/utils/vault-path";
import { serviceHarness } from "./fakes";

const DOCS = DEFAULT_SETTINGS.paths.documentationPath;

/** In-memory {@link WorkspacePort} recording the file opened (US-046). */
class FakeWorkspace implements WorkspacePort {
  readonly opened: VaultPath[] = [];
  failOpen = false;

  async openFile(path: VaultPath): Promise<Result<void>> {
    if (this.failOpen) {
      return { ok: false, error: { code: "INIT_FAILED", message: "open failed" } };
    }
    this.opened.push(path);
    return ok(undefined);
  }

  async openView(): Promise<Result<void>> {
    return ok(undefined);
  }
}

const makeService = () => {
  const { fs, bus, events, types, settings } = serviceHarness();
  const workspace = new FakeWorkspace();
  const service = new DefaultDocumentationGenerationService(settings, fs, bus, workspace);
  return { service, fs, events, types, workspace };
};

describe("DefaultDocumentationGenerationService.open ensures silently", () => {
  it("creates the target doc if absent and opens it WITHOUT emitting documentation.generated", async () => {
    const { service, fs, events, types, workspace } = makeService();
    // No prior generate(): open() must still work and not emit a generation event.
    const result = await service.open("manual");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fs.files.has(result.value.path)).toBe(true); // ensured silently
    expect(workspace.opened).toEqual([result.value.path]);
    expect(types()).toContain("documentation.opened");
    expect(types()).not.toContain("documentation.generated");
    void events;
  });

  it("materializes the full doc set (hub + guides) so links resolve, without an event", async () => {
    const { service, fs, types } = makeService();
    // Opening before any generate(): the index hub and the other guides must be
    // created too, so the opened doc's links don't dangle.
    const result = await service.open("getting-started");
    expect(result.ok).toBe(true);
    const expected = [
      "Test Hub Documentation.md",
      "Getting Started.md",
      "User Manual.md",
      "Troubleshooting.md",
    ].map((name) => joinVaultPath(DOCS, name));
    for (const path of expected) {
      expect(fs.files.has(path), path).toBe(true);
    }
    expect(types()).not.toContain("documentation.generated");
  });
});

describe("DefaultDocumentationGenerationService.generate (FEAT-024, US-043/044/045)", () => {
  it("writes the full EPIC-011 document set into documentationPath", async () => {
    const { service, fs } = makeService();

    const result = await service.generate();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expected = [
      "Test Hub Documentation.md",
      "Getting Started.md",
      "User Manual.md",
      "Troubleshooting.md",
    ].map((name) => joinVaultPath(DOCS, name));

    expect(result.value.documents).toEqual(expected);
    for (const path of expected) {
      expect(fs.files.has(path)).toBe(true);
    }
  });

  it("emits documentation.generated with the document list", async () => {
    const { service, events, types } = makeService();

    const result = await service.generate();
    expect(result.ok).toBe(true);

    expect(types()).toContain("documentation.generated");
    const event = events.find((e) => e.type === "documentation.generated");
    const payload = event?.payload as { documents: VaultPath[] };
    expect(payload.documents).toHaveLength(4);
  });

  it("is idempotent — skips existing notes and never duplicates content", async () => {
    const { service, fs } = makeService();

    await service.generate();
    const indexPath = joinVaultPath(DOCS, "Test Hub Documentation.md");
    fs.files.set(indexPath, "edited by user");

    const second = await service.generate();
    expect(second.ok).toBe(true);
    // Existing note preserved (skip-existing), not overwritten.
    expect(fs.files.get(indexPath)).toBe("edited by user");
  });
});

describe("DefaultDocumentationGenerationService.open (FEAT-025, US-046)", () => {
  it("opens the documentation hub (index) by default and emits its documentType", async () => {
    const { service, workspace, events, types } = makeService();
    await service.generate();

    const result = await service.open();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Default is the navigational hub (index), now a valid documentation.opened
    // documentType, so users land on the overview that links every guide.
    expect(result.value.documentType).toBe("index");
    expect(workspace.opened).toEqual([result.value.path]);

    expect(types()).toContain("documentation.opened");
    const event = events.find((e) => e.type === "documentation.opened");
    const payload = event?.payload as { path: VaultPath; documentType: string };
    expect(payload).toEqual({ path: result.value.path, documentType: "index" });
  });

  it("opens a specific guide when requested", async () => {
    const { service, workspace } = makeService();
    await service.generate();

    const result = await service.open("troubleshooting");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documentType).toBe("troubleshooting");
    expect(workspace.opened).toEqual([joinVaultPath(DOCS, "Troubleshooting.md")]);
  });

  it("surfaces an error and does not emit when the workspace fails to open", async () => {
    const { service, workspace, types } = makeService();
    await service.generate();
    workspace.failOpen = true;

    const result = await service.open();

    expect(result.ok).toBe(false);
    expect(types()).not.toContain("documentation.opened");
  });
});

describe("documentation content builders (US-043/044/045)", () => {
  const docs = buildDocumentation(DEFAULT_SETTINGS);
  const byType = (type: string) => docs.find((d) => d.type === type)?.content ?? "";

  it("builds index, getting-started, manual and troubleshooting", () => {
    expect(docs.map((d) => d.type)).toEqual([
      "index",
      "getting-started",
      "manual",
      "troubleshooting",
    ]);
  });

  it("index links out to every other generated doc", () => {
    const index = byType("index");
    expect(index).toContain("# Test Hub Documentation");
    expect(index).toContain("[[Getting Started]]");
    expect(index).toContain("[[User Manual]]");
    expect(index).toContain("[[Troubleshooting]]");
  });

  it("getting-started onboards from install to first test (US-043)", () => {
    const guide = byType("getting-started");
    expect(guide).toContain("# Getting Started");
    expect(guide).toContain("Install the runner");
    expect(guide).toContain("Run — Demo Test");
  });

  it("user manual documents the core workflow and commands (US-044)", () => {
    const manual = byType("manual");
    expect(manual).toContain("# User Manual");
    expect(manual).toContain("Build — new Use Case");
    expect(manual).toContain("Build — generate feature from Use Case");
    expect(manual).toContain("Review — open dashboard");
    expect(manual).toContain("Setup — generate CI workflow");
  });

  it("troubleshooting covers common failure modes (US-045)", () => {
    const guide = byType("troubleshooting");
    expect(guide).toContain("# Troubleshooting");
    expect(guide).toContain("Node.js");
    // "Setup — repair installation" wraps across a line in the rendered Markdown.
    expect(guide.replace(/\s+/g, " ")).toContain("Setup — repair installation");
  });

  it("documentationFileName resolves every type", () => {
    expect(documentationFileName(DEFAULT_SETTINGS, "index")).toBe("Test Hub Documentation.md");
    expect(documentationFileName(DEFAULT_SETTINGS, "getting-started")).toBe("Getting Started.md");
    expect(documentationFileName(DEFAULT_SETTINGS, "manual")).toBe("User Manual.md");
    expect(documentationFileName(DEFAULT_SETTINGS, "troubleshooting")).toBe("Troubleshooting.md");
  });

  it("Getting Started and the index point at the Guided Tour", () => {
    const docs = buildDocumentation(DEFAULT_SETTINGS);
    const gettingStarted = docs.find((doc) => doc.type === "getting-started");
    const index = docs.find((doc) => doc.type === "index");
    expect(gettingStarted?.content).toContain("Help — open guided tour");
    expect(index?.content).toContain("Help — open guided tour");
  });
});
