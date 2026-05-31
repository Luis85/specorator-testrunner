import { describe, expect, it } from "vitest";
import { buildUseCaseNote, useCaseFileName } from "../src/application/content/use-case-content";
import { parseNote } from "../src/shared/utils/frontmatter";
import type { UseCase } from "../src/domain/entities/use-case";

const useCase: UseCase = {
  id: "UC-002",
  title: "Checkout with a saved card",
  description: "A returning customer pays with a stored card.",
  status: "draft",
  automationStatus: "not-planned",
  featureFiles: [],
  suites: [],
  evidence: [],
  path: "Use Cases/UC-002 Checkout with a saved card.md",
};

describe("useCaseFileName", () => {
  it("prefixes the id and keeps a readable title", () => {
    expect(useCaseFileName("UC-002", "Checkout with a saved card")).toBe(
      "UC-002 Checkout with a saved card.md",
    );
  });

  it("strips characters disallowed in filenames", () => {
    expect(useCaseFileName("UC-003", 'Pay: card/cash? "now"')).toBe("UC-003 Pay card cash now.md");
  });

  it("falls back to the bare id for an empty title", () => {
    expect(useCaseFileName("UC-004", "   ")).toBe("UC-004.md");
  });
});

describe("buildUseCaseNote", () => {
  it("writes a frontmatter schema the repository can read back", () => {
    const { frontmatter } = parseNote(buildUseCaseNote(useCase));
    expect(frontmatter.type).toBe("use-case");
    expect(frontmatter.id).toBe("UC-002");
    expect(frontmatter.title).toBe("Checkout with a saved card");
    expect(frontmatter.status).toBe("draft");
    expect(frontmatter.automation_status).toBe("not-planned");
  });

  it("omits empty feature/suite arrays and lists populated ones", () => {
    const bare = parseNote(buildUseCaseNote(useCase)).frontmatter;
    expect(bare.feature_files).toBeUndefined();
    expect(bare.suites).toBeUndefined();

    const linked = parseNote(
      buildUseCaseNote({
        ...useCase,
        featureFiles: ["Specifications/features/uc-002.feature"],
        suites: ["smoke"],
      }),
    ).frontmatter;
    expect(linked.feature_files).toEqual(["Specifications/features/uc-002.feature"]);
    expect(linked.suites).toEqual(["smoke"]);
  });
});
