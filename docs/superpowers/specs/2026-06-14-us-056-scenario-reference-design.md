# US-056 Scenario Reference — Design

- **Story:** [[US-056]] Scenario Reference (EPIC-014, P1, V2.0)
- **Date:** 2026-06-14
- **Status:** Approved (brainstorm)
- **ADR:** [[0022-scenario-identity-and-history-store]] (accepted; this story is its first implementation)
- **Depends on:** [[US-051]] playwright-bdd migration (shipped)
- **Unblocks:** [[US-053]] run a single scenario · [[US-057]] per-scenario run history · [[US-060]] audit-grade evidence stamps

## Problem

V1's unit of identity is the **Feature**. Scenarios have no stable identity, so
runs, history, and evidence can only attach to a whole feature, and the
dashboard leans on the ADR-0017 prior-status "floor" workaround. EPIC-014 turns
the scenario into the unit of identity; US-056 is its foundation: give every
scenario a stable, collision-free **Scenario Reference**, validate that the key
can never collide, and attach that reference to every run-report result so the
later stories (history, flakiness, single-scenario run, evidence) have a
deterministic key to build on.

ADR-0022 is accepted but explicitly "not yet in code." It defers two decisions
to US-056, both resolved here:

1. **Identity mechanism** — name-derived (chosen), not ID write-back.
2. **Outline row key** — content-stable digest (chosen), not positional index.

## Decisions

### D1 — Name-derived identity (no file write-back)

A Scenario Reference is computed purely from the parsed Feature; we do **not**
mutate `.feature` files to stamp synthetic IDs.

- **Plain scenario:** `<featurePath>::<scenarioName>`
- **Outline example row:** `<featurePath>::<scenarioName>::row-<digest>`

This is deterministic because the validation rules (D3) guarantee scenario names
are unique within a Feature and contain no reserved `::`. It honors ADR-0022's
stated semantics — identity is **stable across runs but not across renames**: a
rename mints a new reference and drops prior history once. It keeps `.feature`
files git-clean (P3 Git-friendly, P1 Markdown-first).

**Deviation from the literal AC.** US-056's acceptance criterion reads "stamped
into generated specs (ID write-back, testomat.io pattern)." We consciously do
not do this: accepted ADR-0022 supersedes that phrasing with name-derived
identity. Write-back would make IDs survive renames — contradicting "rename
detaches history" — and would churn user-authored files on every new scenario.
The AC's underlying goal ("report results map back deterministically") is met by
D4 instead.

### D2 — Content-stable Outline row key

`<digest>` is a short deterministic hash of the example row's **canonicalized
content**: the row's cells as `[header, value]` pairs sorted by header name, then
`JSON.stringify`-ed into an unambiguous string (so cell values containing spaces,
`=`, or other separators can never alias one row onto another), hashed with
FNV-1a (32-bit) and rendered as base36.

- **Stable under row reorder and column reorder** — inserting/reordering example
  rows never re-attributes a row's history to a different parameter set, the
  silent mis-attribution ADR-0022 flags for the positional `::row-N` form.
- **Changes only when a value changes** — editing a cell is a genuinely
  different case, so a new key is correct.
- The literal `row-` prefix is retained for visual continuity with ADR-0022's
  `::row-N` shape; only the suffix changes from a position to a content digest.

A non-cryptographic hash is sufficient: the digest only needs determinism and
low collision across the handful of rows in one Outline, and D3 additionally
rejects duplicate rows, so the space is collision-free by construction. FNV-1a
is synchronous (no Web Crypto async, no Node `crypto` dependency in the domain
layer).

### D3 — Validation makes collisions unrepresentable

Three error rules are added to the single shared `structuralIssues()` rule set
(`src/application/content/feature-validation.ts`). Because both the Validate
action (`SpecificationService.validate`) and the Feature Editor's live strip
(`projectValidation`) call this one function, both surfaces inherit the rules.

1. **Duplicate scenario name within a Feature** — two scenarios sharing a name
   would collide on one Scenario Reference and merge distinct history. Error.
2. **Scenario name contains the reserved `::` delimiter** — e.g. a scenario
   literally named `Login::row-1` would forge an Outline row reference. Error.
3. **Duplicate example-row values within one Scenario Outline** — identical rows
   would collide on one content digest. Error. (Considered across all `Examples`
   blocks of the same Outline.)

### D4 — Report → identity resolution (keeps the port pure)

The `ReportParser` port stays pure (`rawContent + ctx → ParsedReport`). The
parser continues to emit `featureUri`, scenario `name`, and the existing
positional row index / element id. A new application-layer step,
`ScenarioIdentityResolver`, enriches each `ScenarioResult` with a `scenarioRef`:

- **Non-outline:** `vaultFeaturePath::name`.
- **Outline row:** align the report's expanded row to the **same-run** parsed
  Feature by index, read that row's cells, compute the content digest →
  `vaultFeaturePath::name::row-<digest>`.

Positional alignment is used only to join a report row to a feature row **within
a single run**, where order is identical by construction. The value stored is
the content digest, so reordering rows **between** runs still attaches history
correctly. This is why US-056 needs no Cucumber Messages parser; that is only
required later for retry-level granularity (US-058).

**Path canonicalization.** The report's `featureUri` is runner-relative (e.g.
`features/UC-001-x.feature`); the spec lives at a vault-relative path (e.g.
`Specifications/features/UC-001-x.feature`). The resolver translates the report
path to the canonical vault-relative feature path so both sides of the reference
agree. This single canonical form is what makes the mapping deterministic.

**Graceful degradation.** If the report's row count and the feature's row count
disagree (tag filtering, partial expansion, a parse failure), unmatched report
rows fall back to a provisional positional key with a logged warning; unmatched
feature rows simply have no result this run. The resolver never throws.

### D5 — Rename advisory (advisory-only this round)

On Feature save / validate, diff the prior on-disk scenario-name set against the
edited set; if a name disappeared, surface an **advisory** ValidationItem —
*"Renaming a scenario starts its history fresh; prior run history and quarantine
state won't carry over."* It is advisory, not a blocking error, and reuses the
editor's existing validation surface. It is intentionally minimal because the
history store it warns about lands in US-057; the warning's value scales with
that store.

## Architecture & components

```
domain/value-objects/scenario-reference.ts   (new, pure)
  rowDigest(cells)                -> base36 FNV-1a digest of canonical row
  scenarioRef(featurePath, name)  -> "<path>::<name>"
  outlineRowRef(path, name, cells)-> "<path>::<name>::row-<digest>"
  parseScenarioReference(ref)     -> { featurePath, scenarioName, rowDigest? }
  featureScenarioRefs(feature)    -> ScenarioRefEntry[]   (uses isScenarioOutline)

application/content/feature-validation.ts     (extend structuralIssues)
  + duplicate-scenario-name rule
  + reserved-"::"-in-name rule
  + duplicate-outline-row rule

application/services/scenario-identity-resolver.ts   (new)
  resolveScenarioReferences(parsedReport, loadFeature) -> ParsedReport
    enriched with scenarioRef per ScenarioResult; owns path canonicalization

application/ports/report-parser.ts            (extend type)
  ScenarioResult gains  scenarioRef?: string   (set by resolver, not parser)

presentation/views/feature-editor-format.ts   (rename advisory seam)
application/services/specification-service.ts  (wire resolver into import path /
                                                surface advisory in validate)
CONTEXT.md                                     (Scenario Reference: deferred ->
                                                implemented; record D1/D2/D5)
```

## Data flow

1. **Authoring:** user edits a `.feature`. `structuralIssues()` enforces D3 on
   both Validate and the live editor strip; D5 advises on rename.
2. **Identity at parse time:** `featureScenarioRefs(parseFeature(...))` yields
   the canonical references — the authoritative source (D1/D2).
3. **Run + import:** `CucumberJsonReportParser` parses the report;
   `ScenarioIdentityResolver` enriches each result with its `scenarioRef` by
   resolving against the same-run feature (D4).
4. **Downstream (future stories):** US-057 keys history on `scenarioRef`;
   US-053 targets a run by `parseScenarioReference`; US-060 stamps it into
   evidence.

## Testing (TDD)

- **Domain:** `rowDigest` determinism, row-reorder & column-reorder stability,
  value-change sensitivity; `scenarioRef` / `outlineRowRef` formatting;
  `parseScenarioReference` round-trip; `featureScenarioRefs` over plain +
  outline + multi-Examples features.
- **Validation:** duplicate name, reserved `::`, duplicate outline row — each
  error; well-formed feature stays clean; existing rules unaffected.
- **Resolver:** non-outline ref; outline ref with content digest; row-count
  mismatch fallback + warning; path canonicalization (runner-relative ->
  vault-relative).
- **Rename advisory:** name removed -> advisory; pure add/edit-of-steps -> none.

Coverage stays within the existing thresholds (vitest: 93% stmts/lines/funcs,
80% branches). Follows the established patterns in
`tests/feature-validation.test.ts` and `tests/cucumber-json-report-parser.test.ts`.

## Out of scope (deferred, with owners)

- Per-scenario history store / NDJSON projection, and ADR-0017 "floor" removal —
  **US-057**.
- Single-scenario **run** execution and `scenario` scope in Test Console —
  **US-053**.
- Per-scenario evidence enrichment — **US-060** (consumes `scenarioRef`).
- Cucumber Messages parser (retry-level granularity) and flakiness/quarantine —
  **US-058 / US-059**.

US-056 stops at: identity is **computed, validated collision-free, and
deterministically attached to every report result**.
