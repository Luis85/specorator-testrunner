import { describe, expect, it } from "vitest";
import {
  featureCountCell,
  filterUseCaseRows,
  projectUseCaseRows,
  type UseCaseRow,
} from "../src/presentation/views/use-case-rows";
import { projectDashboardSnapshot } from "../src/application/services/traceability-service";
import type { FeatureFileEntry } from "../src/application/services/specification-service";
import type { UseCase } from "../src/domain/entities/use-case";
import type { UseCaseKpiFilter } from "../src/presentation/views/dashboard-rows";
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

describe("filterUseCaseRows (E1 PR3 tile filters)", () => {
  // A fixture spanning every automation status AND a spread of business
  // statuses, so each funnel bucket is exercised against rows it must and must
  // not select. No deprecated UC here, so the row counts line up 1:1 with the
  // dashboard snapshot's (which drops deprecated) for the count-parity check.
  const fixture: UseCase[] = [
    useCase({ id: "UC-001", status: "draft", automationStatus: "not-planned" }),
    useCase({ id: "UC-002", status: "specified", automationStatus: "planned" }),
    useCase({ id: "UC-003", status: "ready-for-automation", automationStatus: "missing-steps" }),
    useCase({ id: "UC-004", status: "automated", automationStatus: "implemented" }),
    useCase({ id: "UC-005", status: "automated", automationStatus: "passing" }),
    useCase({ id: "UC-006", status: "verified", automationStatus: "passing" }),
    useCase({ id: "UC-007", status: "automated", automationStatus: "failing" }),
  ];
  const rows: UseCaseRow[] = projectUseCaseRows(fixture, []);
  const idsFor = (filter: UseCaseKpiFilter): string[] =>
    filterUseCaseRows(rows, filter).map((row) => row.id);

  it("returns every row unchanged for 'all' (identity)", () => {
    expect(filterUseCaseRows(rows, "all")).toBe(rows);
  });

  it("selects rows whose business status counts as Specified", () => {
    // SPECIFIED_STATUSES: specified / ready-for-automation / automated / verified.
    expect(idsFor("specified")).toEqual([
      "UC-002",
      "UC-003",
      "UC-004",
      "UC-005",
      "UC-006",
      "UC-007",
    ]);
  });

  it("selects rows whose automation status counts as Automated", () => {
    // AUTOMATED_STATUSES: implemented / passing / failing.
    expect(idsFor("automated")).toEqual(["UC-004", "UC-005", "UC-006", "UC-007"]);
  });

  it("selects only passing rows", () => {
    expect(idsFor("passing")).toEqual(["UC-005", "UC-006"]);
  });

  it("selects only failing rows", () => {
    expect(idsFor("failing")).toEqual(["UC-007"]);
  });

  it("matches the dashboard funnel counts for the same data (no drift)", () => {
    const snapshot = projectDashboardSnapshot(fixture);
    expect(filterUseCaseRows(rows, "all")).toHaveLength(snapshot.totalUseCases);
    expect(filterUseCaseRows(rows, "specified")).toHaveLength(snapshot.specifiedUseCases);
    expect(filterUseCaseRows(rows, "automated")).toHaveLength(snapshot.automatedUseCases);
    expect(filterUseCaseRows(rows, "passing")).toHaveLength(snapshot.passingUseCases);
    expect(filterUseCaseRows(rows, "failing")).toHaveLength(snapshot.failingUseCases);
  });

  it("excludes a deprecated Use Case from the automation buckets (snapshot parity)", () => {
    // A UC deprecated AFTER it was passing: the funnel's passing/automated tiles
    // count active UCs only (ADR-0017), so the explorer filter must drop it too —
    // otherwise "N passing" would drill into N+1 rows.
    const withDeprecated: UseCase[] = [
      ...fixture,
      useCase({ id: "UC-DEP", status: "deprecated", automationStatus: "passing" }),
    ];
    const depRows = projectUseCaseRows(withDeprecated, []);
    const snapshot = projectDashboardSnapshot(withDeprecated);

    // Absent from every automation bucket...
    expect(filterUseCaseRows(depRows, "passing").map((row) => row.id)).not.toContain("UC-DEP");
    expect(filterUseCaseRows(depRows, "automated").map((row) => row.id)).not.toContain("UC-DEP");
    // ...and the bucket counts still equal the snapshot's (active-only) counts.
    expect(filterUseCaseRows(depRows, "passing")).toHaveLength(snapshot.passingUseCases);
    expect(filterUseCaseRows(depRows, "automated")).toHaveLength(snapshot.automatedUseCases);
    expect(filterUseCaseRows(depRows, "specified")).toHaveLength(snapshot.specifiedUseCases);
    // `all` is the unfiltered explorer list, so it intentionally still shows the
    // deprecated UC — one more row than the active-only Total tile counts.
    expect(filterUseCaseRows(depRows, "all")).toHaveLength(depRows.length);
    expect(depRows).toHaveLength(snapshot.totalUseCases + 1);
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
