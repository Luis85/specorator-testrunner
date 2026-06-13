import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
// @ts-expect-error — plain ESM helper module, no type declarations
import { parseFlags, extractTableColumn } from "../scripts/lib/migrate-utils.mjs";
// @ts-expect-error — plain ESM helper module, no type declarations
import { collectMarkdownFiles } from "../scripts/lib/migrate-utils.mjs";

const SPEC = {
  "--prds-path": { key: "prdsPath", default: "PRDs" },
  "--force": { key: "force", default: false, boolean: true },
};

describe("parseFlags", () => {
  it("applies defaults when no flags are passed", () => {
    expect(parseFlags([], SPEC)).toEqual({ prdsPath: "PRDs", force: false });
  });

  it("reads value flags and sets boolean flags", () => {
    expect(parseFlags(["--prds-path", "Docs/PRDs", "--force"], SPEC)).toEqual({
      prdsPath: "Docs/PRDs",
      force: true,
    });
  });

  it("throws on an unknown flag", () => {
    expect(() => parseFlags(["--nope"], SPEC)).toThrow(/Unknown argument/);
  });

  it("throws when a value flag is missing its value", () => {
    expect(() => parseFlags(["--prds-path"], SPEC)).toThrow(/requires a value/);
  });
});

describe("extractTableColumn", () => {
  const body = [
    "## Goals",
    "",
    "| ID | Goal |",
    "| --- | --- |",
    "| G1 | Ship the dashboard |",
    "| G2 | Track KPIs |",
    "",
    "## Non Goals",
    "",
    "| ID | Non Goal |",
    "| --- | --- |",
    "| NG1 | Historical analytics |",
    "",
    "## Other",
    "Not a table.",
  ].join("\n");

  it("extracts the descriptive column under the matching heading", () => {
    expect(extractTableColumn(body, /Goals/)).toEqual(["Ship the dashboard", "Track KPIs"]);
  });

  it("scopes extraction to the first matching section's table", () => {
    expect(extractTableColumn(body, /Non Goals/)).toEqual(["Historical analytics"]);
  });

  it("returns an empty array when no matching table is found", () => {
    expect(extractTableColumn(body, /Missing/)).toEqual([]);
  });
});

describe("collectMarkdownFiles", () => {
  it("collects .md notes recursively and skips non-markdown files", () => {
    const root = mkdtempSync(join(tmpdir(), "uc-scan-"));
    try {
      writeFileSync(join(root, "UC-001.md"), "x");
      writeFileSync(join(root, "notes.txt"), "x");
      mkdirSync(join(root, "auth", "nested"), { recursive: true });
      writeFileSync(join(root, "auth", "UC-002.md"), "x");
      writeFileSync(join(root, "auth", "nested", "UC-003.md"), "x");

      const relative = collectMarkdownFiles(root)
        .map((path: string) =>
          path
            .slice(root.length + 1)
            .split(sep)
            .join("/"),
        )
        .sort();

      expect(relative).toEqual(["UC-001.md", "auth/UC-002.md", "auth/nested/UC-003.md"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
