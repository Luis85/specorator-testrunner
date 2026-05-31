import { describe, expect, it } from "vitest";
import { projectUseCaseRows } from "../src/presentation/views/use-case-rows";
import type { UseCase } from "../src/domain/entities/use-case";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const useCase = (over: Partial<UseCase>): UseCase => ({
  id: "UC-001",
  title: "Demo",
  status: "draft",
  automationStatus: "not-planned",
  featureFiles: [],
  suites: [],
  evidence: [],
  path: vp("Use Cases/UC-001 Demo.md"),
  ...over,
});

describe("projectUseCaseRows", () => {
  it("projects the columns US-017 displays", () => {
    const rows = projectUseCaseRows([
      useCase({
        id: "UC-001",
        title: "Open Example",
        status: "specified",
        automationStatus: "implemented",
      }),
    ]);
    expect(rows).toEqual([
      {
        id: "UC-001",
        title: "Open Example",
        status: "specified",
        automationStatus: "implemented",
        path: vp("Use Cases/UC-001 Demo.md"),
      },
    ]);
  });

  it("preserves input order", () => {
    const rows = projectUseCaseRows([useCase({ id: "UC-002" }), useCase({ id: "UC-001" })]);
    expect(rows.map((r) => r.id)).toEqual(["UC-002", "UC-001"]);
  });
});
