---
type: design-spec
title: V2 Foundational ADRs (proposal §9 Phase 2 item 2.4)
date: 2026-06-13
status: approved
related:
  - "[[2026-06-11 V2 Research and Proposal]]"
  - "[[0004-use-playwright-as-browser-automation-engine]]"
  - "[[0005-use-markdown-evidence]]"
  - "[[0007-runtime-eventbus-not-event-sourcing]]"
  - "[[0010-restrict-custom-shell-commands]]"
  - "[[0014-v1-auth-transport-is-environment-variables]]"
  - "[[0016-evidence-partitioned-by-year-month]]"
  - "[[0018-at-most-one-active-test-run]]"
---

# V2 Foundational ADRs — Design Spec

Captures the five hard-to-reverse decisions of proposal §9 Phase 2 item 2.4,
brainstormed and approved 2026-06-13. Each section below becomes an accepted
ADR file (ADR-0021…0025) during execution; this spec records the decision,
the alternatives weighed, and the consequences so the ADRs can be written
directly from it. It also records two scope decisions the brainstorm
surfaced (the beta principle and the 2.1/2.2 machinery scope).

Per the project's ADR discipline these decisions **precede** the
implementation of Phase 2 items 2.1–2.3 and the Phase 3 playwright-bdd
migration.

## Cross-cutting principle: pre-announcement beta, no backwards-compat

The plugin is in pre-announcement beta (V1 released via BRAT to early
adopters; no community-marketplace submission, no public announcement). The
project may **break compatibility freely** until announcement: no migration
shims, no deprecated read-paths, no data-preservation obligations for
existing beta installs. This principle governs every decision below — most
sharply the credential cut-over (ADR-0024) and the deferral of migration
machinery (scope decision §7).

## Sequencing

Dependency order (also the recommended authoring order):

0021 (runner) → 0025 (browser matrix, rides on Playwright projects) →
0022 (scenario history, needs the runner's Cucumber Messages output) →
0024 (credentials, independent) → 0023 (MCP, last; reads the stabilized
spec/evidence/history surfaces).

---

## 1. ADR-0021 — Adopt playwright-bdd as the execution engine

**Decision.** Replace cucumber-js-as-runner with **playwright-bdd**: Gherkin
compiles to native `@playwright/test` tests with typed step definitions,
Playwright traces, parallel execution, retries, and sharding. playwright-bdd
is the **sole generated runner**. cucumber-JSON import is retained **only
through the migration window** (per US-052) and removed once the swap is
stable.

**Supply-chain posture.** playwright-bdd is effectively a single-maintainer
project (`vitalets/playwright-bdd`); Microsoft declined to own Cucumber
support ("not planned"); Cucumber calls cucumber-js-as-runner the legacy
path. The mitigation is **structural, not a second runner**: nothing in the
plugin depends on playwright-bdd directly except the generated `.testrunner`
templates. All report ingestion goes through the **ReportParser port (item
2.3)**, so a future runner replacement is a new parser implementation plus
new templates — not a plugin rewrite.

**Considered alternatives.**
- *Permanent parser-port insulation with cucumber-JSON kept as a second
  supported parser forever.* Rejected as default posture: the port already
  provides the insulation; keeping a second parser permanently adds
  maintenance for a hedge the port covers.
- *Dual-runner (ship cucumber-js-as-runner as a selectable supported
  runner).* Rejected: doubles the runner surface, CI matrix, and template
  maintenance, and re-litigates the very migration the bet exists to make.

**Consequences.**
- Supersedes ADR-0004 (Playwright-as-library + cucumber-js-as-runner) and
  lifts AD-6 (`parallel: 0`) and AD-7.
- The generated `.testrunner` gains a playwright-bdd config and typed step
  stubs (US-051/US-052); regex step-matching heuristics are subsumed by
  playwright-bdd's own diagnostics.
- The ReportParser port (2.3) is a hard dependency of this ADR; its first
  implementation wraps the current cucumber-JSON parser, with Cucumber
  Messages added per ADR-0022.

---

## 2. ADR-0025 — Default browser matrix

**Decision.** The generated `.testrunner` ships **Chromium-only by default**.
Firefox and WebKit are a **one-line opt-in** via Playwright projects.

**Rationale.** playwright-bdd makes multi-browser a config concern (Playwright
projects), so the *capability* is free; the decision is only the default. The
Phase-0 lesson stands: browser downloads are the dominant first-run and CI
cost (the per-OS Chromium cache in the e2e-smoke gate exists for exactly this
reason). A Chromium-only default honors the local-first, respect-the-user's-
machine ethos and keeps first-run light; teams lift to multi-browser
deliberately when a Suite needs it.

**Considered alternatives.**
- *Chromium + WebKit default.* WebKit is the asymmetric value (Safari/iOS
  engine, cheap nowhere else). Rejected as default: ~2× install/CI weight for
  coverage most beta users will not exercise on day one; available as opt-in.
- *All three default.* Rejected: ~3× browser install (Phase-0 caching pain ×
  OS × CI leg), slowest first run, for coverage users can add in one line.

**Consequences.**
- Lifts AD-5 (Chromium-only) from a hard constraint to a default.
- US-055 (browser matrix) ships the opt-in mechanism and documents the
  install-cost trade; the e2e-smoke gate continues to cache per-OS browser
  downloads.

---

## 3. ADR-0022 — Scenario identity & history store

**Decision — identity.** The natural key is the **Scenario Reference**
(already sketched in CONTEXT.md): `<featurePath>::<scenarioName>`, with
`::row-<index>` for a Scenario Outline example. Stable across runs; **not**
stable across renames — a rename mints a new identity and drops prior history
once (accepted, per CONTEXT.md). This activates the currently-deferred
Scenario Reference concept and gives EPIC-014 its unit of identity below the
Feature. Because the key is name-based, scenario names must be unique within a
Feature; the collision is closed by validation (a duplicate-name
`structuralIssues` error, TD-003), not by a positional disambiguator — raised
by the codex review on PR #38.

**Decision — report format.** The runner emits **Cucumber Messages** (the
NDJSON message stream), not just cucumber-JSON. JSON is lossy for outline-row
and retry granularity that per-scenario history and flakiness require. The
ReportParser port (2.3) gains a Cucumber Messages implementation alongside the
JSON one.

**Decision — durable store.** **Evidence notes are the single durable
source.** The year-month-partitioned Evidence notes (ADR-0016), enriched by
EPIC-015 (US-060 audit-grade evidence stamps) to carry per-scenario results,
are the authoritative per-run record. **Scenario history, flakiness scores,
quarantine state, Feature-frontmatter rollups, and any NDJSON analytics index
are all rebuildable projections over the Evidence notes** — never an
independent source of truth.

**Reconciliation with ADR-0007.** ADR-0007 ("events are not persisted; the
Markdown is the durable record") is **honored, not amended**. The reserved
NDJSON event log option (ADR-0007 §16) is *not* activated as an authoritative
store; any NDJSON history index is a derived cache rebuildable from the
Markdown evidence at any time.

**Considered alternatives.**
- *Activate the reserved NDJSON log as a co-equal authoritative store.*
  Rejected: introduces a second durable record with a versioned schema to
  keep consistent with the Markdown, amends ADR-0007, and (given the beta
  principle and the deferral of migration machinery) buys durability the
  project does not yet need.
- *Dedicated structured store (SQLite / single history db).* Rejected: least
  Obsidian-native, poor git-diff story, breaks the everything-is-Markdown-in-
  the-vault principle (ADR-0005).
- *Bounded frontmatter rollup as the record (no deep history).* Rejected:
  lossy — caps the flakiness window and prevents re-derivation after a
  scoring change.

**Consequences.**
- **EPIC-014 depends on EPIC-015**: per-scenario evidence stamps (US-060)
  must land before or with per-scenario history (US-057). Sequence
  accordingly in the V2 epic plan.
- Flakiness scoring (US-058) and the history view (US-057) are projection
  builders over Evidence notes; they can be recomputed wholesale, which means
  scoring changes don't require a data migration.
- The Feature-frontmatter rollup participates in the `schemaVersion` story
  (scope §7) as a derived, regenerable field — not a hand-migrated one.

---

## 4. ADR-0024 — Credential storage via Obsidian `secretStorage`

**Decision.** Adopt Obsidian's first-party secret storage. The plugin
persists only the **secret name** per Environment auth key in settings; the
**value** lives in Obsidian's machine-local, non-synced `app.secretStorage`,
entered by the user through the `SecretComponent` UI. At run time the plugin
calls `app.secretStorage.get(name)` and injects the value into the runner
subprocess environment.

**Transport unchanged.** ADR-0014 is untouched: the plugin still injects
per-Environment key/value pairs as env vars; the user's steps read
`process.env.*`; CI still reads the same keys from `secrets.E2E_*`. This ADR
changes **only storage at rest** — the value `get()` returns feeds the exact
same `{ BASE_URL, ...auth.env }` spawn environment as today.

**Why first-party over the alternatives.** `app.secretStorage` dominates the
options weighed during brainstorming: it gives in-app UX (`SecretComponent`)
*and* the "plugin never persists plaintext" privacy property *and* machine-
local-not-synced semantics (right for credentials) *and* marketplace-clean
status — without the `require('electron')` safeStorage reach-around or the
cross-platform variance, both of which become Obsidian's concern.

**Considered alternatives.**
- *`.env`-only (plugin stores only key names; values in a git-ignored
  `.testrunner/.env`).* Same privacy property but worse UX (no in-app entry,
  user manages a file). Superseded by `secretStorage`, which keeps in-app
  entry.
- *Electron `safeStorage` directly (ciphertext in `data.json`).* Rejected:
  accessibility from an Obsidian plugin renderer is unverified, Linux
  libsecret may be absent, cross-platform variance to own — all of which
  `secretStorage` abstracts.
- *Encrypted-at-rest in `data.json` with a plugin-managed key/passphrase.*
  Rejected: reintroduces key management (a key in `data.json` is theater; a
  passphrase is per-session friction).

**Migration.** None. Per the beta principle, existing V1 plaintext `auth.env`
values in `data.json` are dropped on the cut-over; users re-enter via
`SecretComponent`. No import path, no deprecated read.

**Consequences.**
- Retires SDD AD-9 (plaintext credentials in plugin data).
- `SutAuth` changes shape: `env: Record<string, string>` (name→value) becomes
  name→secret-name references resolved through `secretStorage` at spawn time.
  `EnvironmentValidationService` validates that referenced secrets exist.
- **Verify-at-build:** the `minAppVersion` that `app.secretStorage` /
  `SecretComponent` require (likely a `manifest.json` bump — feeds the
  manifest-version stamp in scope §7); and that retrieval works on desktop,
  where runs happen (mobile is read-only per EPIC-018, so desktop-only secret
  access is acceptable). The exact at-rest encryption guarantee should be
  confirmed before making a strong written security claim; the load-bearing
  properties (no plaintext in `data.json`/git, machine-local, not synced,
  first-party) hold regardless.

---

## 5. ADR-0023 — Opt-in local MCP exposure; no in-plugin AI runtime

**Decision — non-goal (codified).** The plugin ships **no in-plugin AI**: no
chat UI, no bundled or BYO-API-key model calls, no plugin-generated AI
content, and no runtime-AI test steps (Momentic-style runtime interpretation
is out — determinism is the product's moat). All AI work happens through the
user's own agents.

**Decision — the one AI surface.** A single **opt-in, in-plugin localhost
HTTP/SSE MCP server** that the user explicitly activates. It runs inside the
plugin (Obsidian must be open) so it can route through live plugin services.
Trust controls are mandatory and scale with the exposure boundary:
**token-based auth, localhost-only binding, and explicit per-session opt-in.**

**Decision — exposure boundary: read + write + execute.**
- *Read:* specs, evidence, scenario history, flakiness, traceability,
  readiness as MCP resources/tools.
- *Write:* create/update Feature specs and step definitions **through the
  plugin**, forced through the same structural validation as the editor
  (TD-003 `structuralIssues`, the one-argument/escaped-pipe Gherkin rules) so
  an agent cannot persist invalid Gherkin.
- *Execute:* trigger runs through the **single-run coordinator (ADR-0018)**
  and read results/traces — the full agentic loop (write a spec, run it, read
  the trace, iterate).

**Considered alternatives.**
- *Standalone `.testrunner` stdio server (agent-spawned, reads vault files).*
  Rejected for hosting: cannot see live plugin state or route through the
  single-run coordinator/validation, so it could not safely offer the execute
  boundary chosen here.
- *Read-only boundary.* Rejected: forgoes the authoring + agentic-loop value
  that is the point of EPIC-016; the chosen guardrails (validation-gated
  writes, coordinator-gated runs, auth) make write+execute defensible.
- *Read + write (no execute).* Rejected as the target, though it is the
  natural intermediate milestone (see consequences).

**Consequences.**
- This is the **largest trust surface** in the plugin. It leans hard on
  ADR-0010 (command-safety allowlist) for any execute path and on the auth
  handshake; the localhost port is an attack surface that the token + binding
  must contain.
- EPIC-016 remains **deliberately last** on the V2 roadmap so the spec,
  evidence, and history surfaces it exposes have stabilized first. A
  read → read+write → execute staging within EPIC-016 is the recommended
  build order, each stage gated on its guardrails being in place.
- Writes reuse the application-layer validation (`structuralIssues`, Gherkin
  parse/serialize), not a parallel path — keeping the MCP a thin, validated
  façade over existing services.

---

## 6. New-ADR register entries

Five ADRs to author (accepted) during execution, in sequencing order:

| New ADR | Title | Supersedes / amends |
| --- | --- | --- |
| ADR-0021 | Adopt playwright-bdd as the execution engine | supersedes ADR-0004; lifts AD-6, AD-7 |
| ADR-0025 | Default browser matrix (Chromium-only) | lifts AD-5 |
| ADR-0022 | Scenario identity & history store | honors ADR-0007; builds on ADR-0016, ADR-0005 |
| ADR-0024 | Credential storage via Obsidian secretStorage | retires SDD AD-9; keeps ADR-0014 transport |
| ADR-0023 | Opt-in local MCP exposure; no in-plugin AI runtime | leans on ADR-0010, ADR-0018 |

(Numbering follows the proposal §2.4 listing order; authoring follows the
dependency order in §Sequencing.)

## 7. Scope decision — Phase 2 migration/upgrade machinery (items 2.1/2.2)

Given the beta principle, Phase 2 builds the **cheap forward-looking version
fields now and defers the heavy machinery**:

- **Now:** add `schemaVersion` to `data.json` and a `version` to the
  `.testrunner` manifest. On a version mismatch, regenerate/reset with a clear
  report. The manifest version is needed regardless — Phase 3's playwright-bdd
  migration uses it to detect old `.testrunner` projects.
- **Deferred to a pre-announcement hardening phase:** item 2.1's tested
  migration-step framework and item 2.2's repair-driven *non-destructive*
  guided upgrades. Their value is protecting existing user data, which the
  beta principle says we do not owe yet.

This keeps Phase 2 focused on: the five ADRs (2.4), the ReportParser port
(2.3), and the two version stamps — and it is the spec's recommended scope
for the Phase 2 implementation plan.

## 8. Open verify-at-build items (carried into the plan)

- `app.secretStorage` / `SecretComponent` required `minAppVersion` (→ manifest
  bump, feeds §7's manifest version) and desktop-only retrieval confirmation
  (ADR-0024).
- The at-rest encryption guarantee of `secretStorage` before any strong
  written security claim (ADR-0024).
- Cucumber Messages output wiring from the playwright-bdd config and its
  ReportParser implementation (ADR-0021/0022).
