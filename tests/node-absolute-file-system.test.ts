import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { NodeAbsoluteFileSystem } from "../src/infrastructure/filesystem/node-absolute-file-system";

/**
 * Integration-style adapter tests for the Node `fs`-backed
 * {@link NodeAbsoluteFileSystem} (BBV §7 `FileSystemAdapter`), mirroring
 * tests/node-child-process-runner.test.ts: the REAL adapter runs against a real
 * temp directory, so path handling, recursive-mkdir-on-write, the
 * missing-file-is-not-an-error delete contract, and the Result error mapping
 * are verified against actual `node:fs` behaviour rather than a fake.
 *
 * The adapter imports the `FileSystemAdapter` VALUE from "obsidian" (the shared
 * test stub only provides Notice/setIcon), so the module is mocked here with a
 * minimal stand-in — which also lets `getVaultBasePath` exercise both branches
 * without a real Obsidian runtime.
 */

vi.mock("obsidian", () => ({
  FileSystemAdapter: class {
    basePath = "/stub/vault/base";
    getBasePath(): string {
      return this.basePath;
    }
  },
}));

// App is only consulted for `vault.adapter`; everything else is irrelevant.
const appWith = (adapter: unknown): App => ({ vault: { adapter } }) as unknown as App;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nafs-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fs = () => new NodeAbsoluteFileSystem(appWith({}));

describe("NodeAbsoluteFileSystem (real fs, tmpdir)", () => {
  it("writeAbsolute creates missing parent directories and readAbsolute round-trips the content", async () => {
    const target = join(dir, "deep", "nested", "report.json");
    const content = '{"status":"passed"}\nline two — ümlauts';

    const written = await fs().writeAbsolute(target, content);
    expect(written.ok).toBe(true);

    const read = await fs().readAbsolute(target);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toBe(content);
  });

  it("existsAbsolute reports true for a real file and false for a missing path", async () => {
    const target = join(dir, "present.txt");
    await writeFile(target, "x", "utf8");

    expect(await fs().existsAbsolute(target)).toBe(true);
    expect(await fs().existsAbsolute(join(dir, "absent.txt"))).toBe(false);
  });

  it("readAbsolute maps a missing file to REPORT_NOT_FOUND with the path in the message", async () => {
    const missing = join(dir, "no-such-report.json");
    const result = await fs().readAbsolute(missing);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("REPORT_NOT_FOUND");
    expect(result.error.message).toContain(missing);
  });

  it("deleteAbsolute removes a file, and deleting a missing file is NOT an error", async () => {
    const target = join(dir, "doomed.txt");
    await writeFile(target, "x", "utf8");

    const first = await fs().deleteAbsolute(target);
    expect(first.ok).toBe(true);
    expect(await fs().existsAbsolute(target)).toBe(false);

    // Port contract: a missing file is not an error (rm with force).
    const second = await fs().deleteAbsolute(target);
    expect(second.ok).toBe(true);
  });

  it("listAbsolute returns immediate child entry names, and [] for a missing directory", async () => {
    await fs().writeAbsolute(join(dir, "a.txt"), "a");
    await fs().writeAbsolute(join(dir, "sub", "b.txt"), "b");

    const entries = await fs().listAbsolute(dir);
    // Immediate children only — the nested b.txt shows up as its directory.
    expect(entries.sort()).toEqual(["a.txt", "sub"]);

    expect(await fs().listAbsolute(join(dir, "does-not-exist"))).toEqual([]);
  });
});

describe("NodeAbsoluteFileSystem.getVaultBasePath", () => {
  it("returns the adapter base path when the vault adapter is a FileSystemAdapter", async () => {
    const { FileSystemAdapter } = await import("obsidian");
    const adapter = new FileSystemAdapter();
    const result = await new NodeAbsoluteFileSystem(appWith(adapter)).getVaultBasePath();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("/stub/vault/base");
  });

  it("returns INIT_FAILED when the adapter is not a FileSystemAdapter (mobile)", async () => {
    const result = await new NodeAbsoluteFileSystem(
      appWith({ notA: "fs-adapter" }),
    ).getVaultBasePath();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INIT_FAILED");
  });
});
