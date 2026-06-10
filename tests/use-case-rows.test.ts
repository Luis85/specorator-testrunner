import { describe, expect, it } from "vitest";
import { featureCountCell, projectUseCaseRows } from "../src/presentation/views/use-case-rows";
import type { FeatureFileEntry } from "../src/application/services/specification-service";
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

const entry = (path: string): FeatureFileEntry => ({
  path: vp(path),
  label: path.replace(/^Features\//, ""),
});

describe("projectUseCaseRows", () => {
  it("projects the columns US-017 displays", () => {
    const rows = projectUseCaseRows(
      [
        useCase({
          id: "UC-001",
          title: "Open Example",
          status: "specified",
          automationStatus: "implemented",
        }),
      ],
      [],
    );
    expect(rows).toEqual([
      {
        id: "UC-001",
        title: "Open Example",
        status: "specified",
        automationStatus: "implemented",
        featureCount: 0,
        path: vp("Use Cases/UC-001 Demo.md"),
      },
    ]);
  });

  it("preserves input order", () => {
    const rows = projectUseCaseRows([useCase({ id: "UC-002" }), useCase({ id: "UC-001" })], []);
    expect(rows.map((r) => r.id)).toEqual(["UC-002", "UC-001"]);
  });

  it("counts Features by the ADR-0012 filename back-reference (Wave F)", () => {
    const rows = projectUseCaseRows(
      [useCase({ id: "UC-001" }), useCase({ id: "UC-002" })],
      [
        entry("Features/UC-001-happy-path.feature"),
        entry("Features/UC-001-edge-cases.feature"),
        entry("Features/UC-002-happy-path.feature"),
        entry("Features/orphan.feature"), // no UC prefix — counts for nobody
      ],
    );
    expect(rows.map((r) => r.featureCount)).toEqual([2, 1]);
  });

  it("projects featureCount null when the Feature listing is unavailable", () => {
    const rows = projectUseCaseRows([useCase({ id: "UC-001" })], null);
    expect(rows[0].featureCount).toBeNull();
  });
});

describe("featureCountCell (Wave F)", () => {
  it("shows the count plainly when Features exist", () => {
    expect(featureCountCell(3)).toEqual({ text: "3", status: null, tooltip: null });
  });

  it("accents zero with a warning nudging towards generation", () => {
    expect(featureCountCell(0)).toEqual({
      text: "0",
      status: "warning",
      tooltip: "No Feature Specifications yet — open the Use Case to generate one.",
    });
  });

  it("shows an em dash (unknown, not zero) when the listing failed", () => {
    expect(featureCountCell(null)).toEqual({
      text: "—",
      status: null,
      tooltip: "Feature Specifications could not be listed.",
    });
  });
});
