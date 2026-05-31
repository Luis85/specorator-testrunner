import { describe, expect, it } from "vitest";
import { buildFrontmatter, buildNote } from "../src/shared/utils/frontmatter";
import { joinVaultPath, relativeVaultPath } from "../src/shared/utils/vault-path";

describe("buildFrontmatter", () => {
  it("serialises scalars and arrays in declaration order", () => {
    const fm = buildFrontmatter({
      type: "test-suite",
      id: "smoke",
      enabled: true,
      suites: ["smoke", "regression"],
    });
    expect(fm).toBe(
      ["---", "type: test-suite", "id: smoke", "enabled: true", "suites:", "  - smoke", "  - regression", "---"].join(
        "\n",
      ),
    );
  });

  it("omits undefined fields and renders empty arrays inline", () => {
    const fm = buildFrontmatter({ a: undefined, b: [] });
    expect(fm).toBe(["---", "b: []", "---"].join("\n"));
  });

  it("quotes values that would otherwise be ambiguous YAML", () => {
    const fm = buildFrontmatter({ expr: "@smoke and not @wip", n: "123" });
    expect(fm).toContain('expr: "@smoke and not @wip"');
    expect(fm).toContain('n: "123"');
  });

  it("buildNote joins frontmatter and body", () => {
    const note = buildNote({ id: "x" }, "# Title\n");
    expect(note.startsWith("---\nid: x\n---\n\n# Title")).toBe(true);
  });
});

describe("joinVaultPath", () => {
  it("joins, collapses duplicate slashes, and drops empty segments", () => {
    expect(joinVaultPath("Test Hub", "Getting Started.md")).toBe("Test Hub/Getting Started.md");
    expect(joinVaultPath("a/", "/b", "", "c")).toBe("a/b/c");
  });
});

describe("relativeVaultPath", () => {
  it("computes the path from the runner folder to the feature folder", () => {
    expect(relativeVaultPath(".testrunner", "Specifications/features")).toBe(
      "../Specifications/features",
    );
    expect(relativeVaultPath("Tools/.testrunner", "Specs/features")).toBe("../../Specs/features");
  });

  it("handles a shared ancestor and identical paths", () => {
    expect(relativeVaultPath("a/b", "a/c")).toBe("../c");
    expect(relativeVaultPath("a", "a")).toBe(".");
  });
});
