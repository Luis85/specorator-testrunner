import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs migration helper, no type declarations
import { domainFromFrontmatter, groupByDomain } from "../scripts/lib/uc-domains.mjs";

describe("groupByDomain", () => {
  it("groups ids by domain, sorted by count desc then domain asc", () => {
    expect(
      groupByDomain([
        { id: "UC-1", domain: "A" },
        { id: "UC-2", domain: "B" },
        { id: "UC-3", domain: "B" },
      ]),
    ).toEqual([
      { domain: "B", ids: ["UC-2", "UC-3"] },
      { domain: "A", ids: ["UC-1"] },
    ]);
  });

  it("breaks ties on equal counts by domain name ascending", () => {
    expect(
      groupByDomain([
        { id: "UC-1", domain: "Zebra" },
        { id: "UC-2", domain: "Apple" },
      ]),
    ).toEqual([
      { domain: "Apple", ids: ["UC-2"] },
      { domain: "Zebra", ids: ["UC-1"] },
    ]);
  });
});

describe("domainFromFrontmatter", () => {
  it("extracts the domain value from a note's frontmatter", () => {
    const note = ["---", "id: UC-001", "domain: Installation", "---", "", "# UC-001"].join("\n");
    expect(domainFromFrontmatter(note)).toBe("Installation");
  });

  it("returns an empty string when domain is absent", () => {
    expect(domainFromFrontmatter("---\nid: UC-001\n---\n")).toBe("");
  });
});
