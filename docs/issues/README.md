# Backlog index

The issue tree lives here as plain notes: **Epics** group **Features** and
**User Stories**; stories link the **Use Cases** (in
[`docs/use-cases/`](../use-cases/)) they realize. Each note carries typed
frontmatter (`type`, `status`, `priority`, `increment`, `epic`,
`depends-on`, …) so the backlog is queryable (e.g. with Obsidian Bases) as
well as readable.

**Key** — *Priority* (from the [V2 proposal](../proposals/2026-06-11%20V2%20Research%20and%20Proposal.md) §6):
P1 = core of V2.0 · P2 = fast follow · P3 = opportunistic.
*Increment* (proposal §8): `pre-V2` → `V2.0` → `V2.1` → `V2.x` → `V2-final`.
For V2 scope, the notes here are canonical; the proposal is the dated
research snapshot behind them.

## V1 epics (shipped)

| Epic | Title |
| --- | --- |
| [[EPIC-001]] | Foundation & Plugin Infrastructure |
| [[EPIC-002]] | Test Hub Initialization |
| [[EPIC-003]] | Test Runner |
| [[EPIC-004]] | Use Case Management |
| [[EPIC-005]] | Specification Management |
| [[EPIC-006]] | Test Suite Management |
| [[EPIC-007]] | Test Execution |
| [[EPIC-008]] | Reporting & Evidence |
| [[EPIC-009]] | Dashboard |
| [[EPIC-010]] | CI/CD |
| [[EPIC-011]] | Documentation |
| [[EPIC-012]] | Quality Assurance |

V1 covers [[US-001]]…[[US-050]], FEAT-001…FEAT-028, and UC-001…UC-024.

## V2 epics (proposed)

| Epic | Title | Priority | Stories |
| --- | --- | --- | --- |
| [[EPIC-013]] | Playwright-Native Runner | P1, foundation | US-051…055, US-080 (+ [[FEAT-029]]: US-090…092) |
| [[EPIC-014]] | Scenario Identity, History & Flakiness | P1 | US-056…059 |
| [[EPIC-015]] | Audit-Grade Evidence & Release Readiness | P1 | US-060…066 |
| [[EPIC-016]] | Agent Integration via Local MCP | last on the roadmap | US-067…071, US-089 |
| [[EPIC-017]] | Discovery & Non-Technical Collaboration | P2 | US-072…075, US-081…083 (+ [[FEAT-030]]: US-093) |
| [[EPIC-018]] | Obsidian-Native Experience | P2 | US-076…078 |
| [[EPIC-019]] | Interop & Open Formats | P2–P3 | US-079 (+ [[FEAT-031]]: US-094/095, [[FEAT-032]]: US-096) |
| [[EPIC-020]] | Trust, Security & CI Depth | P2–P3 | US-084…088 |

## V2 roadmap by increment

Sequencing per proposal §8; the pre-V2 implementation plan (§9) — debt
cleanup, versioning/migration foundations, and the V2 ADRs — precedes all
of it and ends with the runner migration.

### pre-V2 (§9 Phase 3 — the bridge into V2)

- [[US-051]] Migrate the runner to playwright-bdd
- [[US-052]] Typed step definitions

### V2.0 — the headline release

- [[US-053]] Run a single scenario · [[US-054]] Parallel execution &
  retries · [[US-055]] Browser matrix · [[US-080]] Open Playwright UI mode
  & trace viewer
- [[US-056]] Scenario Reference · [[US-057]] Per-scenario run history
- [[US-060]] Audit-grade evidence stamps

### V2.1 — fast follow

- [[US-058]] Flakiness score & quarantine · [[US-059]] Failure triage view
- [[US-061]] Traceability matrix · [[US-062]] Release readiness ·
  [[US-063]] Release sign-off · [[US-064]] Client report export ·
  [[US-065]] Audit export bundle · [[US-066]] Evidence retention sweep
- [[US-081]] Step Library · [[US-082]] Use Case Editor · [[US-083]] Linked
  entity notes
- [[US-076]] Bases-friendly metadata · [[US-078]] Vault & chrome hygiene
- [[US-084]] Credential storage · [[US-085]] storageState · [[US-086]]
  Sharded CI
- [[US-079]] Cucumber Messages + Allure/JUnit export

### V2.x — opportunistic

- [[US-072]] Example Map notes · [[US-073]] Generate scenarios from an
  Example Map · [[US-074]] Scenario quality lint · [[US-075]] Checklist
  on-ramp
- [[US-077]] Mobile read-only degradation
- [[US-087]] Multi-environment CI matrix · [[US-088]] GitLab CI provider
- Drafted feature stories (on acceptance): [[US-090]]/[[US-091]]/[[US-092]]
  (FEAT-029) · [[US-093]] (FEAT-030) · [[US-094]]/[[US-095]] (FEAT-031) ·
  [[US-096]] (FEAT-032)

### V2-final — last roadmap item

- [[US-067]] Local MCP server · [[US-068]] Agent context generation ·
  [[US-069]] Step implementation via MCP · [[US-070]] Failure triage via
  MCP · [[US-071]] Repair-time healing via MCP · [[US-089]] Installable
  agent skills

## Required new ADRs (proposal §8)

1. playwright-bdd adoption (supersedes parts of ADR-0004/AD-6/AD-7)
2. Scenario identity & history store
3. Opt-in local MCP exposure; no in-plugin AI runtime
4. Credential storage (supersedes AD-9)
5. Browser matrix default (supersedes AD-5)
